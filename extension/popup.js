const status=document.querySelector('#status'),collect=document.querySelector('#collect');
async function saved(){const result=await chrome.storage.session.get(['capture','captureProgress']);status.textContent=result.captureProgress||'';if(result.capture){document.querySelector('#send').hidden=false;document.querySelector('#download').hidden=false;}return result.capture;}
document.querySelector('#collect').addEventListener('click',async()=>{
 collect.disabled=true;document.querySelector('#send').hidden=true;document.querySelector('#download').hidden=true;await chrome.storage.session.remove('capture');status.textContent='Reading Medicare results… Keep the Medicare tab open.';
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.url?.startsWith('https://www.medicare.gov/plan-compare/'))throw new Error('Open your Medicare results tab first.');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['collector.js']});
  const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>collectMedicareResults()});
  status.textContent=`Collected ${result[0].result.count} plans across ${result[0].result.pages} page(s).`;
  document.querySelector('#send').hidden=false;document.querySelector('#download').hidden=false;
 }catch(error){status.textContent=error.message;}finally{collect.disabled=false;}
});
document.querySelector('#send').addEventListener('click',async()=>{
 const capture=await saved();if(!capture)return;
 const tabs=await chrome.tabs.query({url:['http://127.0.0.1:8000/*','http://localhost:8000/*']});
 if(tabs.length){try{await chrome.tabs.sendMessage(tabs[0].id,{type:'corsair-capture',capture});await chrome.tabs.update(tabs[0].id,{active:true});status.textContent='Sent. Review the amounts in MedicareCorsair.';}catch{status.textContent='Refresh the MedicareCorsair tab, then send again.';}}
 else await chrome.tabs.create({url:'http://127.0.0.1:8000/#medicare-import'});
});
document.querySelector('#download').addEventListener('click',async()=>{const capture=await saved();if(!capture)return;const url=URL.createObjectURL(new Blob([JSON.stringify(capture)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='medicare-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
chrome.storage.onChanged.addListener(changes=>{if(changes.captureProgress)status.textContent=changes.captureProgress.newValue;});
saved();
