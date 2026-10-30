var extensionApi = globalThis.browser || globalThis.chrome;
function deliver(capture){window.postMessage({type:'medicarecorsair-capture',capture},location.origin);}
extensionApi.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==extensionApi.runtime.id)return;
 if(message.type==='corsair-capture'){deliver(message.capture);respond({received:true});}
 if(['medicarecorsair-account-status','medicarecorsair-account-capture','medicarecorsair-guest-prompt'].includes(message.type)){window.postMessage(message,location.origin);respond({received:true});}
});
let activeRequest=null,sessionPort=null;
window.addEventListener('pagehide',()=>{if(activeRequest)extensionApi.runtime.sendMessage({type:'medicarecorsair-account-cancel',requestId:activeRequest}).catch(()=>{});sessionPort?.disconnect();sessionPort=null;});
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin)return;
 const message=event.data;
 if(!['medicarecorsair-account-start','medicarecorsair-account-cancel','medicarecorsair-guest-answer','medicarecorsair-open-medicare'].includes(message?.type)||typeof message.requestId!=='string'||message.requestId.length>80)return;
 if(message.type==='medicarecorsair-account-start'){
  sessionPort?.disconnect();sessionPort=extensionApi.runtime.connect({name:'corsair-dashboard'});activeRequest=message.requestId;
 }
 if(message.type==='medicarecorsair-account-cancel'&&activeRequest===message.requestId){activeRequest=null;sessionPort?.disconnect();sessionPort=null;}
 extensionApi.runtime.sendMessage({type:message.type,requestId:message.requestId,year:message.year,mode:message.mode,profile:message.mode==='guest'?message.profile:undefined,choice:message.choice,query:message.query}).then(response=>{
  if(response?.ok===false)window.postMessage({type:'medicarecorsair-account-status',requestId:message.requestId,text:response.error},location.origin);
 }).catch(()=>window.postMessage({type:'medicarecorsair-account-status',requestId:message.requestId,text:'Reload the extension using the desktop app, then refresh this page.'},location.origin));
});
window.addEventListener('message',event=>{if(event.source!==window || event.origin!==location.origin || event.data?.type!=='medicarecorsair-ready')return;window.postMessage({type:'medicarecorsair-extension-ready',capabilities:['guest-autofill','account-collection']},location.origin);});
