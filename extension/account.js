/* Runs only in the Plan Finder tab opened by the dashboard. Never signs in,
   changes saved profile information, selects a plan, or enrolls anyone. */
function watchMedicareAccount(requestId){
 if(location.origin!=='https://www.medicare.gov'||!location.pathname.startsWith('/plan-compare/'))return;
 if(globalThis.__corsairAccountWatch===requestId)return;
 globalThis.__corsairAccountWatch=requestId;
 (async()=>{
  try{
   for(let tick=0;tick<900;tick++){
    if(globalThis.__corsairAccountWatch!==requestId)return;
    const reply=await extensionApi.runtime.sendMessage({type:'accountPoll',requestId});
    if(!reply?.ok)return;
    if(location.hash.includes('/search-results')&&/Plan\s*ID\s*:\s*[SHR]\d{4}-\d{3}/i.test(document.body.innerText)){
     const hashParams=new URLSearchParams(location.hash.split('?')[1]||'');
     const year=Number(hashParams.get('year')||new URL(location.href).searchParams.get('year'));
     if(year!==reply.year)throw new Error(`Choose ${reply.year} coverage in Medicare, then try again.`);
     await collectMedicareResults(requestId);return;
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   throw new Error('Comparison timed out. Return to MedicareCorsair and try again.');
  }catch(error){await extensionApi.runtime.sendMessage({type:'accountError',requestId,error:error.message}).catch(()=>{});}
  finally{if(globalThis.__corsairAccountWatch===requestId)globalThis.__corsairAccountWatch=null;}
 })();
}
