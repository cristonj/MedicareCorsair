var extensionApi = globalThis.browser || globalThis.chrome;
/* Visible-page collection only. Never reads cookies, storage, or network headers. */
async function collectMedicareResults(accountRequest) {
  if (location.origin !== 'https://www.medicare.gov' || !location.href.includes('/plan-compare/') || !location.hash.includes('search-results')) throw new Error('Open the Medicare plan results page first.');
  if(globalThis.__medicareCorsairCollecting)throw new Error('A collection is already running on this tab.');
  globalThis.__medicareCorsairCollecting=true;
  try {
  const documents=[], signatures=new Set(); let expected=null;
  const context=()=>location.href.replace(/([?&])page=\d+/g,'$1page=*');const originalContext=context();
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=el=>el && el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
  function snapshot() {
    const text=document.body.innerText;
    const progress=text.match(/Showing\s+([\d,]+)\s+to\s+([\d,]+)\s+of\s+([\d,]+)/i);
    const ids=[...text.matchAll(/Plan\s*ID\s*:\s*([SHR]\d{4}-\d{3}-\d{1,3})/gi)].map(m=>m[1]);
    return {text,progress:progress?.slice(1).map(v=>Number(v.replaceAll(',',''))),ids,signature:ids.join('|')};
  }
  // Start at page one even if the user opened the extension on a later page.
  for(let attempts=0;attempts<60;attempts++) {
    const prev=[...document.querySelectorAll('a,button')].find(el=>visible(el) && /previous page/i.test(el.getAttribute('aria-label')||'') && el.getAttribute('aria-disabled')!=='true' && !el.disabled);
    if (!prev || snapshot().progress?.[0]===1) break;
    const before=snapshot().signature; prev.click();
    let moved=false;for(let tick=0;tick<100;tick++){await delay(150);const s=snapshot();if(s.ids.length && s.signature!==before){moved=true;break;}}
    if(!moved)throw new Error('Could not return to the first results page. Use the PDF walkthrough.');
  }
  for(let page=0;page<60;page++) {
    let current;
    for(let tick=0;tick<100;tick++){current=snapshot();if(current.ids.length && current.progress)break;await delay(150);}
    if(!current?.ids.length || !current.progress)throw new Error('No complete result page was readable.');
    if(context()!==originalContext || (expected!==null&&current.progress[2]!==expected))throw new Error('The Medicare search changed during collection. Start again with one comparison.');
    if(signatures.has(current.signature))throw new Error('Medicare did not advance to a new page. Collection stopped.');
    signatures.add(current.signature);expected=current.progress[2];
    documents.push({text:current.text});
    const progress=await extensionApi.runtime.sendMessage({type:'captureProgress',requestId:accountRequest,value:`Read ${current.progress[1]} of ${expected} plans`});
    if(accountRequest && !progress?.ok)throw new Error('This comparison was canceled or its MedicareCorsair tab was closed.');
    if(current.progress[1]>=expected)break;
    const next=[...document.querySelectorAll('a,button')].find(el=>visible(el) && /next page/i.test(el.getAttribute('aria-label')||'') && el.getAttribute('aria-disabled')!=='true' && !el.disabled);
    if(!next)throw new Error('The next-page control was not found. Use the PDF walkthrough.');
    const before=current.signature;next.click();let moved=false;
    for(let tick=0;tick<120;tick++){await delay(150);const s=snapshot();if(s.ids.length && s.signature!==before){moved=true;break;}}
    if(!moved)throw new Error('The next results page did not load. No partial collection was applied.');
  }
  const unique=new Set(documents.flatMap(d=>[...d.text.matchAll(/Plan\s*ID\s*:\s*([SHR]\d{4}-\d{3}-\d{1,3})/gi)].map(m=>m[1])));
  if(unique.size!==expected)throw new Error(`Read ${unique.size} of ${expected} plans. Use the PDF walkthrough to complete the comparison.`);
  const capture={documents,expected,source_url:location.href,captured_at:new Date().toISOString()};
  const delivered=await extensionApi.runtime.sendMessage({type:'captureComplete',requestId:accountRequest,capture});
  if(!delivered?.ok)throw new Error(delivered?.error || 'Could not send results. Open MedicareCorsair and try again.');
  return {count:expected,pages:documents.length};
  } finally {globalThis.__medicareCorsairCollecting=false;}
}
