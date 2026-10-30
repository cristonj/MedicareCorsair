const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function app(capabilities=['guest-autofill']){
 const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://medicarecorsair.netlify.app/',runScripts:'outside-only'}),w=dom.window,messages=[],requests=[];
 w.postMessage=message=>messages.push(message);w.structuredClone=structuredClone;w.setInterval=()=>0;
 w.setTimeout=(fn,delay)=>delay===450?setImmediate(fn):0;w.clearTimeout=clearImmediate;
 w.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.endsWith('/api/status')?{enrollment:{year:2027,message:'2027 coverage'},sync:{},source:{year:2027,url:'cms',modified:'2026-10-29',page:'https://data.cms.gov/',plan_count:10,formulary_rows:100}}:url.endsWith('/api/states')?{states:['IL']}:url.endsWith('/api/import-quotes')?{year:2027,warnings:[],captured_at:'2026-10-30T00:00:00Z',quotes:[{id:'S0001-001-000',name:'Sample plan',annual_total:63.6,monthly_premium:5.3,annual_drugs:0}]}:{results:[{rxcui:'617318',name:'atorvastatin 20 MG Oral Tablet',brand:false}]}};};
 const Storage=w.Storage;Storage.prototype.setItem=()=>{throw new Error('Profiles must never be persisted.');};
 w.eval(fs.readFileSync('app.js','utf8'));await tick();await tick();
 const $=selector=>w.document.querySelector(selector);
 const send=data=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:w.location.origin,data}));
 const enter=(selector,value)=>{const el=$(selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));return el;};
 send({type:'medicarecorsair-extension-ready',capabilities});
 return {w,$,send,enter,messages,requests};
}
test('guest intake asks two required questions, autocompletes drugs, and sends one in-memory profile',async()=>{
 const f=await app();try{
  f.$('#setup-content').children[1].click(); // No / not sure
  f.$('#setup-content').children[0].click(); // Original Medicare
  assert.equal(f.$('#setup-step').textContent,'2 of 2');
  assert(f.$('#setup-assistance').required);assert.equal(f.$('#setup-assistance').value,'');
  f.enter('#setup-assistance','none');f.$('#setup-next').click();
  f.enter('#zip','60601');f.enter('#pharmacy','CVS');f.enter('#drug-search','atorvastatin');
  await tick();await tick();await tick();
  assert(f.$('.drug-choice'));f.$('.drug-choice').click();f.enter('#quantity','90');f.enter('#days','90');f.$('#add-form').requestSubmit();
  f.$('#compare').click();await tick();await tick();
  const start=f.messages.find(m=>m.type==='medicarecorsair-account-start');assert(start);assert.equal(start.mode,'guest');assert.equal(start.profile.zip,'60601');assert.equal(start.profile.assistance,'none');assert.equal(start.profile.medications[0].quantity,90);assert.equal(start.profile.medications[0].days,90);assert.equal(start.profile.state,'');
  f.send({type:'medicarecorsair-guest-prompt',requestId:start.requestId,title:'Which pharmacy locations will you use?',multiple:true,search:true,choices:[{id:'1619074101',label:'CVS #04781 · 205 N Michigan St, Chicago, IL 60601'},{id:'__search',label:'Search'}]});
  const box=f.$('#guest-prompt input[type="checkbox"]');box.click();f.$('#guest-prompt .button.primary').click();
  assert.deepEqual([...f.messages.find(m=>m.type==='medicarecorsair-guest-answer').choice],['1619074101']);
  f.$('#account-guest').click();assert.equal(f.$('#workspace-view').hidden,false);assert.equal(f.$('#zip').value,'60601');assert.match(f.$('#med-list').textContent,/90 units every 90 days/);
  assert(f.messages.some(m=>m.type==='medicarecorsair-account-cancel'));
 }finally{f.w.close();}
});
test('missing ZIP or pharmacy cannot launch automation',async()=>{
 const f=await app();try{f.$('#setup-content').children[1].click();f.$('#setup-content').children[0].click();f.enter('#setup-assistance','none');f.$('#setup-next').click();f.$('#compare').click();await tick();assert(!f.messages.some(m=>m.type==='medicarecorsair-account-start'));}finally{f.w.close();}
});
test('older extensions retain the guided import without starting guest automation',async()=>{
 const f=await app([]);try{assert.equal(f.$('#app-flow').hidden,false);assert.equal(f.$('#install-view').hidden,true);f.$('#setup-content').children[1].click();f.$('#setup-content').children[0].click();f.enter('#setup-assistance','none');f.$('#setup-next').click();f.enter('#zip','60601');f.enter('#pharmacy','CVS');f.enter('#drug-search','atorvastatin');await tick();await tick();await tick();f.$('.drug-choice').click();f.$('#add-form').requestSubmit();f.$('#compare').click();await tick();assert(!f.messages.some(m=>m.type==='medicarecorsair-account-start'));assert.equal(f.$('#state').hidden,false);}finally{f.w.close();}
});
test('confirmed results show one clear lowest estimate and its premium/drug breakdown',async()=>{
 const f=await app();try{
  f.$('#setup-content').children[0].click();await tick();await tick();
  const start=f.messages.find(m=>m.type==='medicarecorsair-account-start');assert(start);
  f.send({type:'medicarecorsair-account-capture',requestId:start.requestId,capture:{documents:[{text:'fabricated test result'}],captured_at:'2026-10-30T00:00:00Z'}});await tick();await tick();
  assert.equal(f.$('#account-plans').hidden,true);f.$('#account-confirm').click();
  assert.equal(f.$('#account-plans').hidden,false);assert.match(f.$('#account-summary').textContent,/Lowest drug \+ premium estimate/);assert.match(f.$('#account-summary').textContent,/\$63\.60 premiums \+ \$0\.00 drugs/);assert(!f.$('#account-summary').textContent.includes('Confirm'));assert.match(f.$('#account-note').textContent,/checked/);
 }finally{f.w.close();}
});
