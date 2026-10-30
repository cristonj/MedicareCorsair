function deliver(capture){window.postMessage({type:'medicarecorsair-capture',capture},location.origin);}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message.type==='corsair-capture'){deliver(message.capture);respond({received:true});}});
window.addEventListener('message',async event=>{if(event.source!==window || event.origin!==location.origin || event.data?.type!=='medicarecorsair-ready')return;if(location.hash==='#medicare-import'){const {capture}=await chrome.runtime.sendMessage({type:'getCapture'});if(capture)deliver(capture);}});
