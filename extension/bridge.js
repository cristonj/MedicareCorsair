var extensionApi = globalThis.browser || globalThis.chrome;
function deliver(capture){window.postMessage({type:'medicarecorsair-capture',capture},location.origin);}
extensionApi.runtime.onMessage.addListener((message,sender,respond)=>{if(sender.id===extensionApi.runtime.id && message.type==='corsair-capture'){deliver(message.capture);respond({received:true});}});
window.addEventListener('message',event=>{if(event.source!==window || event.origin!==location.origin || event.data?.type!=='medicarecorsair-ready')return;window.postMessage({type:'medicarecorsair-extension-ready'},location.origin);});
