var extensionApi = globalThis.browser || globalThis.chrome;
// Remove captures left by older releases. New captures are sent directly, never stored.
extensionApi.storage.session.remove(['capture','captureProgress']).catch(()=>{});
extensionApi.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==extensionApi.runtime.id || message.type!=='captureComplete')return;
 (async()=>{
  const tabs=await extensionApi.tabs.query({url:['https://medicarecorsair.netlify.app/*','http://127.0.0.1:8000/*','http://localhost:8000/*']});
  if(!tabs.length)throw new Error('Open MedicareCorsair in this browser first.');
  await extensionApi.tabs.sendMessage(tabs[0].id,{type:'corsair-capture',capture:message.capture});
  await extensionApi.tabs.update(tabs[0].id,{active:true});
  return {ok:true};
 })().then(respond,error=>respond({ok:false,error:error.message}));
 return true;
});
