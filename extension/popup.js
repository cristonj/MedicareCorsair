var extensionApi = globalThis.browser || globalThis.chrome;
const status=document.querySelector('#status'),collect=document.querySelector('#collect');
collect.addEventListener('click',async()=>{
 collect.disabled=true;status.textContent='Reading Medicare results… Keep this window open.';
 try{
  const dashboards=await extensionApi.tabs.query({url:['https://medicarecorsair.netlify.app/*','http://127.0.0.1:8000/*','http://localhost:8000/*']});
  if(!dashboards.length)throw new Error('Open MedicareCorsair in this browser first.');
  const [tab]=await extensionApi.tabs.query({active:true,currentWindow:true});
  if(!tab?.url?.startsWith('https://www.medicare.gov/plan-compare/'))throw new Error('Open your Medicare results tab first.');
  await extensionApi.scripting.executeScript({target:{tabId:tab.id},files:['collector.js']});
  const result=await extensionApi.scripting.executeScript({target:{tabId:tab.id},func:()=>collectMedicareResults()});
  status.textContent=`Sent ${result[0].result.count} plans. Review them in MedicareCorsair.`;
 }catch(error){status.textContent=error.message;}finally{collect.disabled=false;}
});
extensionApi.runtime.onMessage.addListener(message=>{if(message.type==='captureProgress')status.textContent=message.value;});
