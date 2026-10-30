var extensionApi = globalThis.browser || globalThis.chrome;
extensionApi.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==extensionApi.runtime.id)return;
 if(message.type==='captureProgress'){extensionApi.storage.session.set({captureProgress:message.value}).then(()=>respond({ok:true}));return true;}
 if(message.type==='captureComplete'){extensionApi.storage.session.set({capture:message.capture,captureProgress:`Collected all ${message.capture.expected} plans`}).then(()=>respond({ok:true}));return true;}
 if(message.type==='getCapture'){extensionApi.storage.session.get('capture').then(({capture})=>respond({capture}));return true;}
});
