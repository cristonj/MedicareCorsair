const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const script=fs.readFileSync('extension/collector.js','utf8');
function fixture({start=0,stuck=false,noNext=false}={}){
 let index=start;const captures=[],progress=[];
 const pages=['Showing 1 to 2 of 4 plans\nPlan ID: S0001-001-0\nPlan ID: S0001-002-0','Showing 3 to 4 of 4 plans\nPlan ID: S0001-003-0\nPlan ID: S0001-004-0'];
 const button=(label,move)=>({disabled:false,getClientRects:()=>[{}],getAttribute:key=>key==='aria-label'?label:null,click:move});
 const body={get innerText(){return pages[index];}};
 const context=vm.createContext({location:{origin:'https://www.medicare.gov',href:'https://www.medicare.gov/plan-compare/#/search-results',hash:'#/search-results'},document:{body,querySelectorAll:()=>[...(index? [button('Previous Page',()=>{index--})]:[]),...(!index&&!noNext?[button('Next Page',()=>{if(!stuck)index++})]:[])]},getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>{fn();return 1},chrome:{runtime:{sendMessage:async m=>{if(m.type==='captureComplete')captures.push(m.capture);else progress.push(m.value);return {ok:true};}}}});
 vm.runInContext(script,context);return {run:()=>context.collectMedicareResults(),captures,progress};
}
test('collects every page, starting from a later page',async()=>{const f=fixture({start:1});const result=await f.run();assert.equal(result.count,4);assert.equal(result.pages,2);assert.equal(f.captures.length,1);assert.equal(f.captures[0].documents.length,2);});
test('does not deliver partial data when pagination stalls',async()=>{const f=fixture({stuck:true});await assert.rejects(f.run(),/did not load/);assert.equal(f.captures.length,0);});
test('does not deliver partial data when next-page control is missing',async()=>{const f=fixture({noNext:true});await assert.rejects(f.run(),/next-page control/);assert.equal(f.captures.length,0);});
test('extension access is confined to dashboards and Medicare Plan Finder',()=>{const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));assert.deepEqual(manifest.host_permissions,['http://127.0.0.1:8000/*','http://localhost:8000/*','https://medicarecorsair.netlify.app/*','https://www.medicare.gov/plan-compare/*']);assert(!manifest.permissions.includes('cookies'));assert(!manifest.permissions.includes('webRequest'));});

test('dashboard handshake announces extension without exposing a saved capture',async()=>{
 const handlers={};const messages=[];const window={postMessage:(message,origin)=>messages.push({message,origin}),addEventListener:(type,fn)=>{handlers[type]=fn;}};
 const runtime={onMessage:{addListener:()=>{}},sendMessage:async()=>{throw new Error('unexpected capture access');}};
 const context=vm.createContext({window,location:{origin:'https://medicarecorsair.netlify.app',hash:''},chrome:{runtime}});
 vm.runInContext(fs.readFileSync('extension/bridge.js','utf8'),context);
 await handlers.message({source:window,origin:'https://medicarecorsair.netlify.app',data:{type:'medicarecorsair-ready'}});
 assert.equal(messages.length,1);assert.equal(messages[0].message.type,'medicarecorsair-extension-ready');
 await handlers.message({source:window,origin:'https://other.example',data:{type:'medicarecorsair-ready'}});
 assert.equal(messages.length,1);
});

function accountBackground(){
 const listeners=[],sent=[],created=[],injected=[];let tabId=100;
 const extension={storage:{session:{remove:async()=>{}}},runtime:{id:'corsair',onMessage:{addListener:f=>listeners.push(f)}},tabs:{
  query:async()=>[],get:async id=>({id,url:'https://medicarecorsair.netlify.app/'}),
  create:async options=>{const tab={id:++tabId,status:'complete',...options};created.push(tab);return tab;},
  sendMessage:async(id,message)=>{sent.push({id,message});return {received:true};},update:async()=>{},
  onUpdated:{addListener:()=>{}},onRemoved:{addListener:()=>{}}
 },scripting:{executeScript:async options=>{injected.push(options);}}};
 const context=vm.createContext({chrome:extension,URL,Date});vm.runInContext(fs.readFileSync('extension/background.js','utf8'),context);
 const dispatch=(message,tab=7,url='https://medicarecorsair.netlify.app/')=>new Promise(resolve=>{
  let pending=false;for(const listener of listeners){if(listener(message,{id:'corsair',url,tab:{id:tab}},resolve)===true)pending=true;}
  if(!pending)resolve(undefined);
 });
 return {dispatch,sent,created,injected};
}
test('account collection returns to the originating tab, with separate concurrent requests',async()=>{
 const f=accountBackground();
 await f.dispatch({type:'medicarecorsair-account-start',requestId:'one',year:2027},7);
 await f.dispatch({type:'medicarecorsair-account-start',requestId:'two',year:2027},8);
 assert.equal(f.created.length,2);assert.match(f.created[0].url,/year=2027/);
 assert(!f.created[0].url.includes('requestId'));assert.equal(f.injected.length,4);
 assert.equal((await f.dispatch({type:'accountPoll',requestId:'one'},102,'https://www.medicare.gov/plan-compare/')).ok,false);
 const result=await f.dispatch({type:'captureComplete',requestId:'one',capture:{documents:[{text:'sample'}]}},101,'https://www.medicare.gov/plan-compare/');
 assert.equal(result.ok,true);
 const delivered=f.sent.find(x=>x.message.type==='medicarecorsair-account-capture');assert.equal(delivered.id,7);
 assert.equal((await f.dispatch({type:'accountPoll',requestId:'two'},102)).ok,true);
});
test('untrusted sites cannot start jobs and cancellation stops collection',async()=>{
 const f=accountBackground();await f.dispatch({type:'medicarecorsair-account-start',requestId:'x',year:2027},7,'https://evil.example/');assert.equal(f.created.length,0);
 await f.dispatch({type:'medicarecorsair-account-start',requestId:'one',year:2027},7);
 await f.dispatch({type:'medicarecorsair-account-cancel',requestId:'old'},7);
 assert.equal((await f.dispatch({type:'accountPoll',requestId:'one'},101)).ok,true);
 await f.dispatch({type:'medicarecorsair-account-cancel',requestId:'one'},7);
 assert.equal((await f.dispatch({type:'accountPoll',requestId:'one'},101)).ok,false);
});
test('first question offers account path without rendering the questionnaire',()=>{
 const source=fs.readFileSync('app.js','utf8'),elements={};let accountOpened=false;
 const element=()=>({children:[],hidden:false,append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},focus(){},addEventListener(type,fn){this[type]=fn;}});
 const context=vm.createContext({$:id=>elements[id]??=element(),node:(tag,cls,text)=>Object.assign(element(),{textContent:text}),setupStep:-1,showAccount:()=>{accountOpened=true;}});
 vm.runInContext(source.slice(source.indexOf('function showSetup(){'),source.indexOf('function showWorkspace(){')),context);
 context.showSetup();assert.match(elements['#setup-title'].textContent,/logged into Medicare.gov in this browser/);
 const buttons=elements['#setup-content'].children;assert.equal(buttons.length,2);buttons[0].click();assert.equal(accountOpened,true);assert.equal(context.setupStep,-1);
});

test('account watcher collects only matching-year results and stops canceled requests',async()=>{
 for(const [year,active,expected]of [[2027,true,'collected'],[2026,true,'accountError'],[2027,false,'stopped']]){
  const sent=[];let collected=false;
  const context=vm.createContext({URL,URLSearchParams,location:{origin:'https://www.medicare.gov',pathname:'/plan-compare/',href:`https://www.medicare.gov/plan-compare/?year=${year}#/search-results?year=${year}`,hash:`#/search-results?year=${year}`},document:{body:{innerText:'Plan ID: S0001-001-0'}},extensionApi:{runtime:{sendMessage:async message=>{sent.push(message);return {ok:active,year:2027};}}},collectMedicareResults:async id=>{assert.equal(id,'request');collected=true;},setTimeout});
  vm.runInContext(fs.readFileSync('extension/account.js','utf8'),context);context.watchMedicareAccount('request');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(collected,expected==='collected');assert.equal(sent.some(m=>m.type==='accountError'),expected==='accountError');
 }
});
