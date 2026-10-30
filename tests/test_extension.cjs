const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const script=fs.readFileSync('extension/collector.js','utf8');
function fixture({start=0,stuck=false,noNext=false}={}){
 let index=start;const captures=[],progress=[];
 const pages=['Showing 1 to 2 of 4 plans\nPlan ID: S0001-001-0\nPlan ID: S0001-002-0','Showing 3 to 4 of 4 plans\nPlan ID: S0001-003-0\nPlan ID: S0001-004-0'];
 const button=(label,move)=>({disabled:false,getClientRects:()=>[{}],getAttribute:key=>key==='aria-label'?label:null,click:move});
 const body={get innerText(){return pages[index];}};
 const context=vm.createContext({location:{origin:'https://www.medicare.gov',href:'https://www.medicare.gov/plan-compare/#/search-results',hash:'#/search-results'},document:{body,querySelectorAll:()=>[...(index? [button('Previous Page',()=>{index--})]:[]),...(!index&&!noNext?[button('Next Page',()=>{if(!stuck)index++})]:[])]},getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>{fn();return 1},chrome:{runtime:{sendMessage:async m=>{if(m.type==='captureComplete')captures.push(m.capture);else progress.push(m.value);}}}});
 vm.runInContext(script,context);return {run:()=>context.collectMedicareResults(),captures,progress};
}
test('collects every page, starting from a later page',async()=>{const f=fixture({start:1});const result=await f.run();assert.equal(result.count,4);assert.equal(result.pages,2);assert.equal(f.captures.length,1);assert.equal(f.captures[0].documents.length,2);});
test('does not deliver partial data when pagination stalls',async()=>{const f=fixture({stuck:true});await assert.rejects(f.run(),/did not load/);assert.equal(f.captures.length,0);});
test('does not deliver partial data when next-page control is missing',async()=>{const f=fixture({noNext:true});await assert.rejects(f.run(),/next-page control/);assert.equal(f.captures.length,0);});
test('extension access is confined to the active tab and local app',()=>{const manifest=JSON.parse(fs.readFileSync('extension/manifest.json','utf8'));assert.deepEqual(manifest.host_permissions,['http://127.0.0.1:8000/*','http://localhost:8000/*']);assert(!manifest.permissions.includes('cookies'));assert(!manifest.permissions.includes('webRequest'));});
