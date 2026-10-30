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
    ids=list(re.finditer(r'Plan\s*ID\s*:\s*([SHR]\d{4})\s*-\s*(\d{3})\s*-\s*(\d{1,3})',text,re.I))
    if not ids: raise ValueError('No Medicare plan IDs were readable. Use the Medicare results page or its printout.')
    found=[]; warnings=[]
    for index,match in enumerate(ids):
        block=text[match.end():ids[index+1].start() if index+1<len(ids) else len(text)]
        total=re.search(r'Total\s+Drug\s*(?:&|and|\+)\s*Premium\s+Cost\s*\(\s*for\s+(20\d{2})\s*\)',block,re.I)
        premium=re.search(r'Monthly\s+Premium',block,re.I)
        pid=f'{match[1].upper()}-{match[2]}-{match[3].zfill(3)}'
        if not total or not premium:
            warnings.append(f'{pid}: missing or unreadable total/premium; skipped.'); continue
        total_section=re.split(r'Monthly\s+Premium|Other\s+Costs|Plan\s+Benefits|Pharmacies|Estimated\s+total\s+drug',block[total.end():],maxsplit=1,flags=re.I)[0]
        total_amounts=re.findall(r'\$\s*([\d,]+\.\d{2})',total_section)
        premium_section=re.split(r'Includes\s*:|Pharmacies|Drugs',block[premium.end():],maxsplit=1,flags=re.I)[0]
        premium_amounts=re.findall(r'\$\s*([\d,]+\.\d{2})',premium_section)
        if len(total_amounts)!=1 or len(premium_amounts)!=1:
            warnings.append(f'{pid}: ambiguous amounts; skipped.'); continue
        if int(total[1])!=year: raise ValueError(f'This document contains {total[1]} costs. The selected enrollment year is {year}. Import rejected.')
        total_value=Decimal(total_amounts[0].replace(',','')); monthly=Decimal(premium_amounts[0].replace(',',''))
        if total_value < monthly*12-Decimal('.02') or total_value>1000000 or monthly>100000:
            warnings.append(f'{pid}: inconsistent amounts; skipped.'); continue
        deductible=re.search(r'Deductible\s*\$\s*([\d,]+\.\d{2})',block,re.I)
        maximum_section=re.search(r'Maximum\s+you\s+pay\s+for\s+health\s+services\s*(.*?)(?:Plan\s+Benefits|Copays|Drugs|$)',block,re.I|re.S)
        maximum=re.search(r'\$\s*([\d,]+(?:\.\d{2})?)\s+In-network',maximum_section[1],re.I) if maximum_section else None
        primary=re.search(r'Primary\s+doctor\s*:\s*([^\n]+)',block,re.I)
        specialist=re.search(r'Specialist\s*:\s*([^\n]+)',block,re.I)
        found.append({'id':pid,'annual_total':float(total_value),'monthly_premium':float(monthly),'annual_drugs':float(max(Decimal(0),total_value-monthly*12)), 'deductible':float(deductible[1].replace(',','')) if deductible else None,'medical_max':float(maximum[1].replace(',','')) if maximum else None,'primary_copay':primary[1].strip()[:80] if primary else None,'specialist_copay':specialist[1].strip()[:80] if specialist else None,'no_drug_coverage':bool(re.search(r'Includes\s*:\s*Only\s+health\s+coverage',block,re.I))})
    # Multiple differing appearances are ambiguous, not last-one-wins.
    unique={}
    for quote in found:
        if quote['id'] in unique and quote!=unique[quote['id']]: raise ValueError('Conflicting totals for the same plan. Import a single comparison.')
        unique[quote['id']]=quote
    if not unique: raise ValueError('No complete annual totals could be read. Try pasting the results text.')
    return list(unique.values()), warnings


def extract_document(body):
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
    return text,ocr


def merge_documents(documents,year):
    combined={};warnings=[];used_ocr=False;documents_read=0;expected_counts=set()
    for index,document in enumerate(documents):
        try:
            text,ocr=extract_document(document)
            quotes,notes=parse_quotes(text,year)
            for count in re.findall(r'Showing\s+[\d,]+\s*to\s*[\d,]+\s*of\s*([\d,]+)',text,re.I):expected_counts.add(int(count.replace(',','')))
        except ValueError as error:
            # Never hide a conflicting year amongst otherwise valid pages.
            if 'Import rejected' in str(error): raise
            warnings.append(f'File {index+1}: {error}');continue
        for quote in quotes:
            previous=combined.get(quote['id'])
            if previous and any(previous[k]!=quote[k] for k in ['annual_total','monthly_premium']):
                raise ValueError('Two files disagree on a plan price. Use files from the same Medicare comparison.')
            combined[quote['id']]=quote
        warnings.extend(notes);used_ocr |= ocr;documents_read+=1
    if not combined: raise ValueError('No readable plan totals were found in these files.')
    if len(expected_counts)>1:raise ValueError('These files show different search totals. Use pages from the same Medicare comparison.')
    if expected_counts and len(combined)<max(expected_counts):warnings.insert(0,f"Read {len(combined)} of {max(expected_counts)} plans. Add the remaining result pages for a complete comparison.")
    return list(combined.values()),warnings,used_ocr,documents_read


def import_quotes(body):
    if not isinstance(body,dict): raise ValueError('Choose a PDF or paste results text.')
    documents=body.get('documents',[body])
    if not isinstance(documents,list) or not 1<=len(documents)<=60: raise ValueError('Use a collection of 1–60 result pages.')
    year=enrollment_context()['year']
    quotes,warnings,ocr,documents_read=merge_documents(documents,year)
    source=data.metadata(year)
    if not source: raise ValueError('Wait for CMS data to finish loading before importing.')
    with closing(data.connect(year)) as db:
        known={r['id']:r['name'] for r in db.execute('SELECT id,name FROM plans')}
        if db.execute("SELECT name FROM sqlite_master WHERE name='ma_plans'").fetchone():
            known.update({r['id']:r['name'] for r in db.execute('SELECT id,name FROM ma_plans')})
    validated=[];excluded=0
    for quote in quotes:
        if quote.get('no_drug_coverage'):excluded+=1;continue
        if quote['id'] not in known: warnings.append(f"{quote['id']}: not found in the current CMS plan list; skipped."); continue
        validated.append({**quote,'name':known[quote['id']]})
    if excluded:warnings.append(f'{excluded} plans without drug coverage were left out.')
    if not validated: raise ValueError('The document does not match any plans in the current CMS dataset.')
    return {'year':year,'quotes':validated,'warnings':warnings,'ocr':ocr,'documents_read':documents_read,'review_required':True,'captured_at':data.now(),'source':'Medicare Plan Finder printout (user-supplied; not authenticated)','context_required':'Confirm the same location, medications, quantities, days supply, assistance and pharmacies. The results printout does not establish these inputs.'}
