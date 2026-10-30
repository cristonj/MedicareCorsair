chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(message.type==='captureProgress'){chrome.storage.session.set({captureProgress:message.value}).then(()=>respond({ok:true}));return true;}
 if(message.type==='captureComplete'){chrome.storage.session.set({capture:message.capture,captureProgress:`Collected all ${message.capture.expected} plans`}).then(()=>respond({ok:true}));return true;}
 if(message.type==='getCapture'){chrome.storage.session.get('capture').then(({capture})=>respond({capture}));return true;}
});
