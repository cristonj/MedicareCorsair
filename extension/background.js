var extensionApi = globalThis.browser || globalThis.chrome;
// Remove captures left by older releases. New captures are sent directly, never stored.
extensionApi.storage.session.remove(['capture','captureProgress']).catch(()=>{});
// Routing only, in RAM. No health profile, cookies, or credentials are read.
const accountJobs=new Map();
const dashboard=url=>{try{const u=new URL(url);return ['https://medicarecorsair.netlify.app','http://127.0.0.1:8000','http://localhost:8000'].includes(u.origin);}catch{return false;}};
async function accountStatus(job,text){
 await extensionApi.tabs.sendMessage(job.source,{type:'medicarecorsair-account-status',requestId:job.requestId,text});
}
async function watchAccount(job){
 await extensionApi.scripting.executeScript({target:{tabId:job.medicare},files:['collector.js','account.js']});
 await extensionApi.scripting.executeScript({target:{tabId:job.medicare},func:requestId=>watchMedicareAccount(requestId),args:[job.requestId]});
}
extensionApi.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==extensionApi.runtime.id)return;
 const isStart=message.type==='medicarecorsair-account-start',isCancel=message.type==='medicarecorsair-account-cancel';
 if(isStart||isCancel){
  if(!sender.tab?.id||!dashboard(sender.url)||typeof message.requestId!=='string'||message.requestId.length>80)return;
  (async()=>{
   for(const [id,job]of accountJobs)if(job.source===sender.tab.id&&(!isCancel||id===message.requestId))accountJobs.delete(id);
   if(isCancel)return {ok:true};
   if(!Number.isInteger(message.year)||message.year<2026||message.year>2100)throw new Error('Wait for the enrollment year, then try again.');
   const job={source:sender.tab.id,requestId:message.requestId,year:message.year,started:Date.now()};
   // A fresh Plan Finder tab shares this browser's existing Medicare session.
   const tab=await extensionApi.tabs.create({url:`https://www.medicare.gov/plan-compare/?year=${job.year}&lang=en`});
   job.medicare=tab.id;accountJobs.set(job.requestId,job);
   await accountStatus(job,'Check your saved drugs and pharmacies in Medicare. We’ll bring you back when the plans are ready.');
   if(tab.status==='complete')await watchAccount(job);
   return {ok:true};
  })().then(respond,error=>respond({ok:false,error:error.message}));return true;
 }
 if(!message.requestId||!['accountPoll','accountError','captureProgress','captureComplete'].includes(message.type))return;
 const job=accountJobs.get(message.requestId);
 if(!job||sender.tab?.id!==job.medicare){respond({ok:false});return;}
 (async()=>{
  const source=await extensionApi.tabs.get(job.source);
  if(!dashboard(source.url)||Date.now()-job.started>30*60*1000)throw new Error('Comparison expired. Return to MedicareCorsair and try again.');
  if(message.type==='accountPoll')return {ok:true,year:job.year};
  if(message.type==='accountError'){await accountStatus(job,message.error);accountJobs.delete(job.requestId);return {ok:true};}
  if(message.type==='captureProgress'){await accountStatus(job,message.value);return {ok:true};}
  if(!Array.isArray(message.capture?.documents))throw new Error('No readable Medicare results.');
  await extensionApi.tabs.sendMessage(job.source,{type:'medicarecorsair-account-capture',requestId:job.requestId,capture:message.capture});
  accountJobs.delete(job.requestId);await extensionApi.tabs.update(job.source,{active:true});return {ok:true};
 })().then(respond,async error=>{accountJobs.delete(job.requestId);await accountStatus(job,error.message).catch(()=>{});respond({ok:false,error:error.message});});return true;
});
extensionApi.tabs.onUpdated.addListener((id,change)=>{
 if(change.status!=='complete')return;
 const job=[...accountJobs.values()].find(job=>job.medicare===id);
 if(job)watchAccount(job).catch(()=>accountStatus(job,'Finish any sign-in on Medicare.gov. Return here and try again if collection does not start.').catch(()=>{}));
});
extensionApi.tabs.onRemoved.addListener(id=>{for(const [key,job]of accountJobs)if(job.source===id||job.medicare===id){accountJobs.delete(key);if(job.source!==id)accountStatus(job,'The Medicare tab was closed. Try again when you’re ready.').catch(()=>{});}});
extensionApi.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==extensionApi.runtime.id || message.type!=='captureComplete'||message.requestId)return;
 (async()=>{
  const tabs=await extensionApi.tabs.query({url:['https://medicarecorsair.netlify.app/*','http://127.0.0.1:8000/*','http://localhost:8000/*']});
  if(!tabs.length)throw new Error('Open MedicareCorsair in this browser first.');
  await extensionApi.tabs.sendMessage(tabs[0].id,{type:'corsair-capture',capture:message.capture});
  await extensionApi.tabs.update(tabs[0].id,{active:true});
  return {ok:true};
 })().then(respond,error=>respond({ok:false,error:error.message}));
 return true;
});
