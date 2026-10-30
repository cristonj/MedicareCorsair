var extensionApi = globalThis.browser || globalThis.chrome;
// Remove captures left by older releases. New captures are sent directly, never stored.
extensionApi.storage.session.remove(['capture','captureProgress']).catch(()=>{});
// Routing only, in RAM. No health profile, cookies, or credentials are read.
const accountJobs=new Map();
const medicareTabs=new Map(); // Tab routing only; never contains a health profile.
const dashboardPorts=new Map();
const dashboard=url=>{try{const u=new URL(url);return ['https://medicarecorsair.netlify.app','http://127.0.0.1:8000','http://localhost:8000'].includes(u.origin);}catch{return false;}};
extensionApi.runtime.onConnect.addListener(port=>{
 if(port.name!=='corsair-dashboard'||!port.sender?.tab?.id||!dashboard(port.sender.url)){port.disconnect();return;}
 const source=port.sender.tab.id;dashboardPorts.set(source,port);
 port.onDisconnect.addListener(()=>{
  if(dashboardPorts.get(source)!==port)return;
  dashboardPorts.delete(source);for(const [id,job]of accountJobs)if(job.source===source)accountJobs.delete(id);for(const [id,tab]of medicareTabs)if(tab.source===source)medicareTabs.delete(id);
 });
});
async function accountStatus(job,text,failed=false){
 if(failed)medicareTabs.set(job.requestId,{source:job.source,medicare:job.medicare});
 await extensionApi.tabs.sendMessage(job.source,{type:'medicarecorsair-account-status',requestId:job.requestId,text,failed});
 if(failed)await focusTab(job.source);
}
async function focusTab(id){
 const tab=await extensionApi.tabs.update(id,{active:true});
 if(Number.isInteger(tab?.windowId)&&extensionApi.windows?.update)await extensionApi.windows.update(tab.windowId,{focused:true});
}
async function watchAccount(job){
 if(job.profile){
  await extensionApi.scripting.executeScript({target:{tabId:job.medicare},files:['collector.js','guest.js']});
  await extensionApi.scripting.executeScript({target:{tabId:job.medicare},func:(requestId,profile)=>startGuestComparison(requestId,profile),args:[job.requestId,job.profile]});
 }else{
  await extensionApi.scripting.executeScript({target:{tabId:job.medicare},files:['collector.js','account.js']});
  await extensionApi.scripting.executeScript({target:{tabId:job.medicare},func:requestId=>watchMedicareAccount(requestId),args:[job.requestId]});
 }
}
function checkedGuestProfile(p){
 if(!p||!/^\d{5}$/.test(p.zip)||!['original','advantage'].includes(p.coverage)||!['none','medicaid','extra_help','ssi','msp'].includes(p.assistance))throw new Error('Complete your ZIP, coverage, and help with costs first.');
 if(typeof p.pharmacy!=='string'||p.pharmacy.length>200||!p.pharmacy.trim())throw new Error('Enter a pharmacy name or choose mail order.');
 if(!Array.isArray(p.medications)||!p.medications.length||p.medications.length>30)throw new Error('Add your exact medications first.');
 const medications=p.medications.map(m=>{
  if(!m||typeof m.name!=='string'||m.name.length>240||!/^\d{1,10}$/.test(String(m.rxcui))||!Number.isFinite(m.quantity)||m.quantity<=0||m.quantity>100000||![30,60,90].includes(m.days))throw new Error('Check each medication’s strength, quantity, and days supply.');
  return {name:m.name,rxcui:String(m.rxcui),quantity:m.quantity,days:m.days,brand:!!m.brand};
 });
 return {zip:p.zip,coverage:p.coverage,assistance:p.assistance,pharmacy:p.pharmacy.trim(),medications};
}
extensionApi.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==extensionApi.runtime.id)return;
 const isStart=message.type==='medicarecorsair-account-start',isCancel=message.type==='medicarecorsair-account-cancel';
 if(message.type==='medicarecorsair-open-medicare'){
  const tab=medicareTabs.get(message.requestId);
  if(!tab||sender.tab?.id!==tab.source||!dashboard(sender.url)){respond({ok:false,error:'The Medicare tab is no longer available. Refresh the prices to open it again.'});return;}
  (async()=>{
   if(tab.url){const url=new URL(tab.url);if(url.origin==='https://www.medicare.gov'&&url.pathname.startsWith('/plan-compare/'))await extensionApi.tabs.update(tab.medicare,{url:tab.url.replace(/([?&])page=\d+/g,'$1page=1')});}
   await focusTab(tab.medicare);return {ok:true};
  })().then(respond,error=>respond({ok:false,error:error.message}));return true;
 }
 if(message.type==='medicarecorsair-guest-answer'){
  const job=accountJobs.get(message.requestId);
  const chosen=Array.isArray(message.choice)?message.choice:[message.choice];
  if(!job||sender.tab?.id!==job.source||!dashboard(sender.url)||!chosen.length||chosen.length>5||!chosen.every(id=>job.choices?.includes(id))||new Set(chosen).size!==chosen.length){respond({ok:false});return;}
  if(message.choice==='__search'&&(typeof message.query!=='string'||!message.query.trim()||message.query.length>200)){respond({ok:false,error:'Enter a pharmacy name.'});return;}
  job.answer={choice:message.choice,query:message.query};job.choices=null;
  focusTab(job.medicare).then(()=>respond({ok:true}),()=>respond({ok:false}));return true;
 }
 if(isStart||isCancel){
  if(!sender.tab?.id||!dashboard(sender.url)||typeof message.requestId!=='string'||message.requestId.length>80)return;
  (async()=>{
   for(const [id,job]of accountJobs)if(job.source===sender.tab.id&&(!isCancel||id===message.requestId))accountJobs.delete(id);
   for(const [id,tab]of medicareTabs)if(tab.source===sender.tab.id&&(!isCancel||id===message.requestId))medicareTabs.delete(id);
   if(isCancel)return {ok:true};
   const owner=dashboardPorts.get(sender.tab.id);
   if(!owner)throw new Error('Refresh MedicareCorsair, then try again.');
   if(!Number.isInteger(message.year)||message.year<2026||message.year>2100)throw new Error('Wait for the enrollment year, then try again.');
   const job={source:sender.tab.id,requestId:message.requestId,year:message.year,started:Date.now(),profile:message.mode==='guest'?checkedGuestProfile(message.profile):null};
   // A fresh Plan Finder tab shares this browser's existing Medicare session.
   const tab=await extensionApi.tabs.create({url:`https://www.medicare.gov/plan-compare/?year=${job.year}&lang=en`,...(Number.isInteger(sender.tab.windowId)?{windowId:sender.tab.windowId}:{})});
   if(dashboardPorts.get(sender.tab.id)!==owner)throw new Error('The comparison page closed before Medicare opened.');
   job.medicare=tab.id;accountJobs.set(job.requestId,job);
   await accountStatus(job,job.profile?'Entering your details in Medicare…':'Check your saved drugs and pharmacies in Medicare. We’ll bring you back when the plans are ready.');
   if(tab.status==='complete')await watchAccount(job);
   return {ok:true};
  })().then(respond,error=>respond({ok:false,error:error.message}));return true;
 }
 if(!message.requestId||!['accountPoll','accountError','captureProgress','captureComplete','guestPrompt','guestUseAccount'].includes(message.type))return;
 const job=accountJobs.get(message.requestId);
 if(!job||sender.tab?.id!==job.medicare){respond({ok:false});return;}
 (async()=>{
  const source=await extensionApi.tabs.get(job.source);
  if(!dashboard(source.url)||Date.now()-job.started>30*60*1000)throw new Error('Comparison expired. Return to MedicareCorsair and try again.');
  if(message.type==='accountPoll'){const answer=job.answer;delete job.answer;return {ok:true,year:job.year,answer};}
  if(message.type==='guestUseAccount'){
   job.profile=null;await accountStatus(job,'Medicare is signed in. Using the saved Medicare information instead.');await watchAccount(job);return {ok:true};
  }
  if(message.type==='guestPrompt'){
   if(!Array.isArray(message.choices)||message.choices.length>100||!message.choices.length)throw new Error('No matching choices were available.');
   job.choices=message.choices.map(c=>c.id);delete job.answer;
   await extensionApi.tabs.sendMessage(job.source,{type:'medicarecorsair-guest-prompt',requestId:job.requestId,title:message.title,choices:message.choices,multiple:!!message.multiple,search:!!message.search});
   await focusTab(job.source);return {ok:true};
  }
  if(message.type==='accountError'){await accountStatus(job,message.error,true);accountJobs.delete(job.requestId);return {ok:true};}
  if(message.type==='captureProgress'){await accountStatus(job,message.value);return {ok:true};}
  if(!Array.isArray(message.capture?.documents))throw new Error('No readable Medicare results.');
  await extensionApi.tabs.sendMessage(job.source,{type:'medicarecorsair-account-capture',requestId:job.requestId,capture:message.capture});
  medicareTabs.set(job.requestId,{source:job.source,medicare:job.medicare,url:message.capture.source_url});
  accountJobs.delete(job.requestId);await focusTab(job.source);return {ok:true};
 })().then(respond,async error=>{accountJobs.delete(job.requestId);await accountStatus(job,error.message,true).catch(()=>{});respond({ok:false,error:error.message});});return true;
});
extensionApi.tabs.onUpdated.addListener((id,change)=>{
 if(change.status!=='complete')return;
 const job=[...accountJobs.values()].find(job=>job.medicare===id);
 if(job)watchAccount(job).catch(()=>accountStatus(job,'Finish any sign-in on Medicare.gov. Return here and try again if collection does not start.').catch(()=>{}));
});
extensionApi.tabs.onRemoved.addListener(id=>{for(const [key,tab]of medicareTabs)if(tab.source===id||tab.medicare===id)medicareTabs.delete(key);for(const [key,job]of accountJobs)if(job.source===id||job.medicare===id){accountJobs.delete(key);if(job.source!==id)accountStatus(job,'The Medicare tab was closed. Try again when you’re ready.').catch(()=>{});}});
extensionApi.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==extensionApi.runtime.id || message.type!=='captureComplete'||message.requestId)return;
 (async()=>{
  const routed=[...medicareTabs.entries()].find(([,tab])=>tab.medicare===sender.tab?.id);
  if(routed){const [requestId,tab]=routed;await extensionApi.tabs.sendMessage(tab.source,{type:'medicarecorsair-account-capture',requestId,capture:message.capture});await focusTab(tab.source);return {ok:true};}
  const tabs=await extensionApi.tabs.query({url:['https://medicarecorsair.netlify.app/*','http://127.0.0.1:8000/*','http://localhost:8000/*']});
  if(!tabs.length)throw new Error('Open MedicareCorsair in this browser first.');
  if(tabs.length>1)throw new Error('More than one MedicareCorsair page is open. Keep the intended comparison open and close the others before collecting.');
  await extensionApi.tabs.sendMessage(tabs[0].id,{type:'corsair-capture',capture:message.capture});
  await extensionApi.tabs.update(tabs[0].id,{active:true});
  return {ok:true};
 })().then(respond,error=>respond({ok:false,error:error.message}));
 return true;
});
