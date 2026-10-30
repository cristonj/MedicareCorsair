"""Read Medicare printouts, never execute HTML or infer a missing price."""
import base64
from contextlib import closing
from decimal import Decimal
from html.parser import HTMLParser
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from . import data
from .calendar import enrollment_context

MAX_BYTES = 8 * 1024 * 1024


class TextOnly(HTMLParser):
    def __init__(self): super().__init__(); self.parts = []; self.ignored = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'): self.ignored += 1
        elif tag in ('p','div','h1','h2','h3','li','br'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style'): self.ignored = max(0,self.ignored-1)
        elif tag in ('p','div','h1','h2','h3','li'): self.parts.append('\n')
    def handle_data(self, value):
        if not self.ignored: self.parts.append(value)


def pdf_text(content):
    try: import pypdfium2 as pdfium
    except ImportError: raise ValueError('PDF support needs the project requirements installed. See README.md.')
    with pdfium.PdfDocument(content) as pdf:
        if not 1 <= len(pdf) <= 20: raise ValueError('Use a PDF of 1–20 pages.')
        texts, images, positions = [], [], []
        with tempfile.TemporaryDirectory(prefix='corsair-import-') as folder:
            for index in range(len(pdf)):
                with closing(pdf[index]) as page:
                    with closing(page.get_textpage()) as textpage: text = textpage.get_text_range()
                    texts.append(text)
                    if len(text.strip()) < 40:
                        # Bound both dimensions before rasterizing untrusted pages.
                        w,h=page.get_size()
                        scale=min(2.5,2200/max(w,h))
                        if min(w,h) <= 0: raise ValueError('Invalid PDF page size.')
                        bitmap=page.render(scale=scale)
                        try:
                            path=Path(folder)/f'page-{index}.png'
                            bitmap.to_pil().save(path)
                        finally: bitmap.close()
                        images.append(str(path)); positions.append(index)
            if images:
                binary=shutil.which('node')
                if not binary: raise ValueError('Image PDFs need Node.js for local OCR.')
                try:
                    result=subprocess.run([binary,str(data.ROOT/'backend'/'ocr.cjs'),*images],capture_output=True,text=True,encoding='utf-8',timeout=240,check=True,cwd=data.ROOT)
                    ocr=json.loads(result.stdout)
                except (subprocess.SubprocessError,ValueError): raise ValueError('Local OCR could not read this PDF. Try copying the result-page text instead.')
                for index,page in zip(positions,ocr): texts[index]=page['text']
            return '\n'.join(texts), bool(images)


def parse_quotes(text, year):
    text=text.replace('\u00a0',' ').replace('\u2013','-').replace('\u2014','-')
    # A common OCR confusion is '$4802-151-0' for 'S4802-151-0'.
    # This correction is limited to the labeled ID; IDs are checked against CMS.
    text=re.sub(r'(Plan\s*ID\s*:\s*)\$(\d{4}\s*-)',r'\1S\2',text,flags=re.I)
    ids=list(re.finditer(r'Plan\s*ID\s*:\s*(S\d{4})\s*-\s*(\d{3})\s*-\s*(\d{1,3})',text,re.I))
    if not ids: raise ValueError('No stand-alone Part D plan IDs were readable. Use the Medicare results page or its printout.')
    found=[]; warnings=[]
    for index,match in enumerate(ids):
        block=text[match.end():ids[index+1].start() if index+1<len(ids) else len(text)]
        total=re.search(r'Total\s+Drug\s*(?:&|and|\+)\s*Premium\s+Cost\s*\(\s*for\s+(20\d{2})\s*\)',block,re.I)
        premium=re.search(r'Monthly\s+Premium',block,re.I)
        pid=f'{match[1].upper()}-{match[2]}-{match[3].zfill(3)}'
        if not total or not premium:
            warnings.append(f'{pid}: missing or unreadable total/premium; skipped.'); continue
        total_amounts=re.findall(r'\$\s*([\d,]+\.\d{2})',block[total.end():premium.start()])
        premium_section=re.split(r'Includes\s*:|Pharmacies|Drugs',block[premium.end():],maxsplit=1,flags=re.I)[0]
        premium_amounts=re.findall(r'\$\s*([\d,]+\.\d{2})',premium_section)
        if len(total_amounts)!=1 or len(premium_amounts)!=1:
            warnings.append(f'{pid}: ambiguous amounts; skipped.'); continue
        if int(total[1])!=year: raise ValueError(f'This document contains {total[1]} costs. The selected enrollment year is {year}. Import rejected.')
        total_value=Decimal(total_amounts[0].replace(',','')); monthly=Decimal(premium_amounts[0].replace(',',''))
        if total_value < monthly*12-Decimal('.02') or total_value>1000000 or monthly>100000:
            warnings.append(f'{pid}: inconsistent amounts; skipped.'); continue
        found.append({'id':pid,'annual_total':float(total_value),'monthly_premium':float(monthly),'annual_drugs':float(max(Decimal(0),total_value-monthly*12))})
    # Multiple differing appearances are ambiguous, not last-one-wins.
    unique={}
    for quote in found:
        if quote['id'] in unique and quote!=unique[quote['id']]: raise ValueError('Conflicting totals for the same plan. Import a single comparison.')
        unique[quote['id']]=quote
    if not unique: raise ValueError('No complete annual totals could be read. Try pasting the results text.')
    return list(unique.values()), warnings


def import_quotes(body):
    if not isinstance(body,dict): raise ValueError('Choose a PDF or paste results text.')
    ocr=False
    if body.get('pdf'):
        try: content=base64.b64decode(body['pdf'],validate=True)
        except (ValueError,TypeError): raise ValueError('Invalid PDF upload.')
        if len(content)>MAX_BYTES or not content.startswith(b'%PDF-'): raise ValueError('Choose a PDF smaller than 8 MB.')
        try: text,ocr=pdf_text(content)
        except ValueError: raise
        except Exception: raise ValueError('The PDF could not be decoded. Try saving a new printout or pasting the results text.')
    else:
        text=body.get('text','')
        if not isinstance(text,str) or len(text)>MAX_BYTES: raise ValueError('The saved page is too large.')
        if '<html' in text.lower() or '<!doctype' in text.lower():
            parser=TextOnly(); parser.feed(text); text=''.join(parser.parts)
    year=enrollment_context()['year']
    quotes,warnings=parse_quotes(text,year)
    source=data.metadata(year)
    if not source: raise ValueError('Wait for CMS data to finish loading before importing.')
    with closing(data.connect(year)) as db:
        known={r['id']:r['name'] for r in db.execute('SELECT id,name FROM plans')}
    validated=[]
    for quote in quotes:
        if quote['id'] not in known: warnings.append(f"{quote['id']}: not found in the current CMS plan list; skipped."); continue
        validated.append({**quote,'name':known[quote['id']]})
    if not validated: raise ValueError('The document does not match any plans in the current CMS dataset.')
    return {'year':year,'quotes':validated,'warnings':warnings,'ocr':ocr,'review_required':True,'captured_at':data.now(),'source':'Medicare Plan Finder printout (user-supplied; not authenticated)','context_required':'Confirm the same location, medications, quantities, days supply, assistance and pharmacies. The results printout does not establish these inputs.'}
