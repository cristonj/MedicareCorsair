/* Form automation only: no private APIs, credentials, account storage, or enrollment.
   All input and progress live in RAM and disappear when the initiating page closes. */
function corsairNormalize(value){return String(value).toLowerCase().normalize('NFKC').replace(/[’']/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
function corsairDrugParts(med){
 const brand=med.name.match(/\[([^\]]+)\]/)?.[1];
 const duration=med.name.match(/\b(?:12|24)\s*HR\b/i)?.[0]||'';
 const name=med.name.replace(/\[[^\]]+\]/g,'').replace(/^\d+\s*HR\s+/i,'').trim();
 const firstStrength=name.search(/\b\d+(?:\.\d+)?\s*(?:MG|MCG|G|UNT|ML|MEQ|%)/i);
 const ingredients=name.replace(/\b\d+(?:\.\d+)?\s*(?:MG|MCG|G|UNT|ML|MEQ|%)(?:\s*\/\s*\d*(?:\.\d+)?\s*(?:ML|G))?/gi,'').split(/\b(?:Oral|Topical|Ophthalmic|Otic|Injectable|Inhalation|Nasal|Rectal|Vaginal|Sublingual|Transdermal|Buccal)\b/i)[0].replace(/\b(?:Extended Release|Delayed Release|Chewable|Disintegrating)\b/gi,'').replace(/\s+/g,' ').trim();
 return {search:brand||name.slice(0,firstStrength<0?name.length:firstStrength).trim(),name:brand||ingredients,dose:firstStrength<0?'':`${duration} ${name.slice(firstStrength)}`.trim()};
}
function corsairDose(value){return corsairNormalize(value).replace(/\boral\b/g,'').replace(/\s+/g,'');}
function corsairDoseCompatible(wanted,offered){
 const strengths=s=>[...s.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|meq|unt|%)/g)].map(m=>Number(m[1])+m[2]).sort().join('|');
 const form=s=>s.toLowerCase().match(/tablet|capsule|solution|suspension|cream|ointment|gel|spray|patch|inhaler|powder|injection|syringe|pen|drops/)?.[0];
 if(!strengths(wanted)||strengths(wanted)!==strengths(offered)||!form(wanted)||form(wanted)!==form(offered))return false;
 for(const qualifier of [/extended\s*release|\bER\b|\bXR\b/i,/delayed\s*release|\bDR\b/i,/disintegrating|\bODT\b/i,/chewable/i,/12\s*(?:hr|hour)/i,/24\s*(?:hr|hour)/i])if(qualifier.test(wanted)!==qualifier.test(offered))return false;
 return true;
}
function startGuestComparison(requestId,profile){
 if(location.origin!=='https://www.medicare.gov'||!location.pathname.startsWith('/plan-compare/'))return;
 if(globalThis.__corsairGuestRequest===requestId)return;
 globalThis.__corsairGuestRequest=requestId;
 globalThis.__corsairGuestTask=(async()=>{
  const main=()=>document.querySelector('#mct-app-main')||document.querySelector('main');
  const text=el=>el?.innerText||el?.textContent||'';
  const visible=el=>el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const all=(selector,scope=main())=>[...(scope?.querySelectorAll(selector)||[])].filter(visible);
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function poll(){
   if(globalThis.__corsairGuestRequest!==requestId)throw new Error('Comparison canceled.');
   if(location.origin!=='https://www.medicare.gov'||!location.pathname.startsWith('/plan-compare/')||/\/(?:enroll|enrollment|apply|application|checkout)(?:[/?#-]|$)/i.test(location.hash))throw new Error('The Medicare page changed. Automation stopped without selecting or enrolling in a plan.');
   const reply=await extensionApi.runtime.sendMessage({type:'accountPoll',requestId});
   if(!reply?.ok)throw new Error('Comparison canceled. Return to MedicareCorsair to start again.');
   return reply;
  }
  async function status(value){await extensionApi.runtime.sendMessage({type:'captureProgress',requestId,value});}
  async function wait(test,description,limit=150){
   for(let i=0;i<limit;i++){if(i%8===0)await poll();const result=test();if(result)return result;await pause(200);}
   throw new Error(`Medicare didn’t finish ${description}. Your entries are still in Medicare. Try again or use the PDF option.`);
  }
  function button(label){return all('button,a').find(el=>corsairNormalize(text(el))===corsairNormalize(label)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');}
  async function click(el){if(!el||el.disabled)throw new Error('A required Medicare control is unavailable.');await poll();el.scrollIntoView({block:'center'});el.click();await pause(300);}
  function input(el,value){
   if(!el)throw new Error('A required Medicare field is unavailable.');
   el.focus();
   const setter=Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;
   setter.call(el,String(value));el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}));el.dispatchEvent(new Event('change',{bubbles:true}));
   const key=String(value).slice(-1);el.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true}));
  }
  async function ask(title,choices,{multiple=false,search=false}={}){
   const sent=await extensionApi.runtime.sendMessage({type:'guestPrompt',requestId,title,choices:choices.map(c=>({id:c.id,label:c.label})),multiple,search});
   if(!sent?.ok)throw new Error('Could not show the question in MedicareCorsair.');
   for(let i=0;i<900;i++){const reply=await poll();if(reply.answer!==undefined)return reply.answer;await pause(1000);}
   throw new Error('The question timed out. Start again from MedicareCorsair.');
  }
  function optionLabel(el){return text(el).trim();}
  async function choose(options,wanted,title){
   const exact=options.filter(el=>corsairNormalize(optionLabel(el))===corsairNormalize(wanted));
   if(exact.length===1){await click(exact[0]);return optionLabel(exact[0]);}
   if(!options.length)throw new Error(`Medicare has no choices for ${title}.`);
   const choices=options.map((el,i)=>({id:String(i),label:optionLabel(el)}));
   const answer=await ask(title,choices);const selected=options[Number(answer.choice)];
   if(!selected?.isConnected)throw new Error('Medicare’s choices changed. Try again.');
   await click(selected);return optionLabel(selected);
  }
  async function selectDose(med){
   const control=await wait(()=>document.getElementById('drug-select-dosage'),'loading the drug strength');
   await click(control);
   const options=await wait(()=>{const a=all('[role="option"]');return a.length?a:null;},'loading dosage choices');
   const choices=options.filter(el=>!/^select /i.test(optionLabel(el)));
   const exact=choices.filter(el=>corsairDose(optionLabel(el))===corsairDose(corsairDrugParts(med).dose));
   let dose;
   if(exact.length===1){dose=optionLabel(exact[0]);await click(exact[0]);}
   else{
    const compatible=choices.filter(el=>corsairDoseCompatible(corsairDrugParts(med).dose,optionLabel(el)));
    if(!compatible.length)throw new Error(`Medicare has no matching strength and form for ${med.name}. No different drug was substituted.`);
    dose=await choose(compatible,'',`Confirm the Medicare label for ${med.name}`);
   }
   await wait(()=>corsairDose(text(document.getElementById('drug-select-dosage'))).startsWith(corsairDose(dose)),'applying the strength');
   return dose;
  }
  let countyAnswer=null;
  async function chooseCounty(){
   const radios=all('input[type="radio"]').filter(el=>/^\d{5}$/.test(el.id));
   if(radios.length&&(!countyAnswer||!radios.some(el=>el.id===countyAnswer&&el.checked))){
    const answer=radios.length===1?{choice:'0'}:await ask('Which county do you live in?',radios.map((el,i)=>({id:String(i),label:labelled(el)})));
    const selected=radios[Number(answer.choice)];await click(selected);countyAnswer=selected.id;
   }
   const selects=all('select').filter(el=>/county/i.test((el.labels?.[0]?.textContent||'')+' '+el.name+' '+el.id));
   for(const select of selects){
    const options=[...select.options].filter(o=>o.value&&!o.disabled);
    if(!options.length)continue;
    if(countyAnswer===select.value)continue;
    const answer=options.length===1?{choice:'0'}:await ask('Which county do you live in?',options.map((o,i)=>({id:String(i),label:o.textContent})));
    select.value=options[Number(answer.choice)].value;countyAnswer=select.value;select.dispatchEvent(new Event('change',{bubbles:true}));await pause(400);
   }
  }
  function labelled(el){return el.labels?.[0]?.textContent?.trim()||el.getAttribute('aria-label')||el.value;}
  async function requiredAnswers(){
   const radios=all('input[type="radio"]').filter(el=>!el.checked);
   const groups=[...new Set(radios.map(el=>el.name))];
   for(const name of groups){
    const group=all('input[type="radio"]').filter(el=>el.name===name);
    if(group.some(el=>el.checked))continue;
    const title=text(group[0].closest('fieldset')?.querySelector('legend'))||text(main()?.querySelector('h1,h2'))||'Choose the answer that applies to you';
    const answer=await ask(title,group.map((el,i)=>({id:String(i),label:labelled(el)})));await click(group[Number(answer.choice)]);
   }
  }
  async function providers(){
   let added=Number(text(main()).match(/You have\s+(\d+)\s+saved provider/i)?.[1]||0),nextAnswer=null,choices=[{id:button('Start comparing plans')?'done':'skip',label:button('Start comparing plans')?'Use the providers already selected in Medicare':'Skip doctor check for now'},{id:'__search',label:'Search by doctor name'}];
   for(let attempt=0;attempt<20;attempt++){
    const answer=nextAnswer||await ask(added?'Add another doctor, or continue?':'Which doctors should Medicare check?',choices,{search:true});nextAnswer=null;
    if(answer.choice==='skip'||answer.choice==='done'){
     const next=button('Start comparing plans')||button(added?'Continue':'Skip adding providers')||button('See plans')||button('View plans');
     if(!next)throw new Error('The Medicare provider Continue control was not available.');await click(next);return;
    }
    if(answer.choice==='__search'){
     let query;try{query=JSON.parse(answer.query);}catch{throw new Error('Enter a doctor’s first or last name.');}
     if(!query.first&&!query.last)throw new Error('Enter a doctor’s first or last name.');
     if(button('Add another provider'))await click(button('Add another provider'));
     await wait(()=>all('input').some(el=>/provider last name/i.test(labelled(el))),'opening provider search');
     const fields=all('input');
     const first=fields.find(el=>/provider first name/i.test(labelled(el))),last=fields.find(el=>/provider last name/i.test(labelled(el)));
     if(!first||!last)throw new Error('Medicare changed its provider search fields. No provider was selected.');
     input(first,query.first||'');input(last,query.last||'');await pause(700);
     const exact=all('[role="option"]').find(el=>corsairNormalize(optionLabel(el))===corsairNormalize(query.last||query.first));if(exact)await click(exact);else last.blur();
     await click(await wait(()=>button('Search'),'searching for your doctor'));await pause(1500);
     await wait(()=>!/\bLoading\b/i.test(text(main())),'loading doctor matches');
     const addButtons=all('button').filter(el=>/^add provider\s/i.test(el.getAttribute('aria-label')||text(el)));
     choices=addButtons.map((el,i)=>({id:'provider-'+i,label:(el.getAttribute('aria-label')||text(el)).replace(/^add provider\s*/i,'').trim()}));
     const selected=await ask(choices.length?'Choose your exact doctor':'No matching doctors. Search again or skip.',[...choices,{id:added?'done':'skip',label:added?'Continue to plan prices':'Skip doctor check for now'},{id:'__search',label:'Search another doctor'}],{search:true});
     if(selected.choice==='__search'){
      nextAnswer=selected;
      continue;
     }
     if(selected.choice==='skip'||selected.choice==='done'){
      const next=button('Start comparing plans')||button(added?'Continue':'Skip adding providers')||button('See plans')||button('View plans');await click(next);return;
     }
     const index=Number(String(selected.choice).replace('provider-','')),selectedButton=addButtons[index];
     if(!selectedButton?.isConnected)throw new Error('The provider list changed. No provider was selected.');
     await click(selectedButton);await wait(()=>button('Start comparing plans'),'verifying the added provider');added++;
     choices=[{id:'done',label:'Continue to plan prices'},{id:'__search',label:'Search another doctor'}];
     if(added>=5){await click(await wait(()=>button('Start comparing plans')||button('Continue')||button('See plans')||button('View plans'),'continuing with your doctors'));return;}
    }
   }
   throw new Error('Doctor selection timed out. No plan was selected or enrolled.');
  }
  try{
   await status('Opening your Medicare comparison…');
   let year=(await poll()).year;
   await wait(()=>main(),'opening Plan Finder');
   if(all('a,button',document).some(el=>/^(log out|sign out)$/i.test(text(el).trim()))){
    await extensionApi.runtime.sendMessage({type:'guestUseAccount',requestId});return;
   }
   await wait(()=>all('input').find(el=>/^zipcode-/i.test(el.id)),'opening the ZIP form');
   const yearRadio=document.getElementById(year===new Date().getFullYear()?'coverage-year-current-year':'coverage-year-next-year');
   if(!yearRadio)throw new Error('Medicare is not offering the requested enrollment year yet.');
   await click(yearRadio);const zip=await wait(()=>all('input').find(el=>/^zipcode-/i.test(el.id)),'loading the selected year');input(zip,profile.zip);zip.blur();await pause(1500);
   await wait(()=>!/\bLoading\b/i.test(text(main())),'looking up your ZIP code',300);await chooseCounty();
   await click(await wait(()=>button('Continue'),'finding the ZIP Continue button'));
   // Multi-county ZIPs may ask for the county after submitting the ZIP.
   for(let i=0;i<3&&!document.getElementById('what-coverage-pdp');i++){
    await pause(500);await chooseCounty();
    if(/county/i.test(text(main()))){await requiredAnswers();const next=button('Continue');if(next)await click(next);}
   }
   const plan=await wait(()=>document.getElementById(profile.coverage==='advantage'?'what-coverage-mapd':'what-coverage-pdp')||(/ZIP code not found/i.test(text(main()))?'zip-error':false),'loading plan types');
   if(plan==='zip-error')throw new Error('Medicare couldn’t verify your ZIP code. Check it in the Medicare tab, then try again.');
   await click(plan);await click(await wait(()=>button('Find plans'),'finding the plan search button'));
   const radio=label=>all('input[type="radio"]').find(el=>corsairNormalize(labelled(el)).startsWith(corsairNormalize(label)));
   const assistance={medicaid:'Medicaid',ssi:'Supplemental Security Income',msp:'Medicare Savings Program',extra_help:'Extra Help',none:'I don’t get help from any of these programs'}[profile.assistance];
   await click(await wait(()=>radio(assistance),'loading help with costs'));
   await click(await wait(()=>button('Continue'),'continuing from help with costs'));
   const drugListReady=()=>/Add your drugs|Review your drug list/i.test(text(main()));
   for(let i=0;i<6&&!radio('Yes, include drug costs')&&!drugListReady();i++){
    await pause(500);if(radio('Yes, include drug costs')||drugListReady())break;
    if(location.hash.includes('extra-help')){await requiredAnswers();const next=button('Continue');if(next)await click(next);}
   }
   const drugQuestion=await wait(()=>radio('Yes, include drug costs')||drugListReady(),'opening your prescription comparison');
   if(drugQuestion!==true){
    await click(drugQuestion);
    await click(await wait(()=>button('Continue'),'continuing to the drug list'));
   }
   await wait(()=>/Add your drugs|Review your drug list/i.test(text(main())),'opening your drug list');
   // Reuse exact guest entries; never silently retain a different previous list.
   const verified=[];
   const rowMatches=(row,v)=>corsairNormalize(text(row)).includes(corsairNormalize(v.name))&&corsairDose(text(row)).includes(corsairDose(v.dose))&&new RegExp(`Quantity\\s*${String(v.quantity).replace('.','\\.')}\\s*(?:•|Frequency)`,'i').test(text(row))&&corsairNormalize(text(row)).includes(corsairNormalize(v.frequency));
   const previousRows=all('li').filter(el=>/Quantity[\s\S]*Frequency/i.test(text(el)));
   const descriptions=profile.medications.map(m=>({name:corsairDrugParts(m).name,dose:corsairDrugParts(m).dose,quantity:m.quantity,frequency:{30:'Every month',60:'Every 2 months',90:'Every 3 months'}[m.days]}));
   const previousMatches=previousRows.map(row=>descriptions.map((v,i)=>rowMatches(row,v)?i:-1).filter(i=>i>=0));
   const reused=new Set();
   if(previousRows.length&&previousMatches.every(matches=>matches.length===1)&&new Set(previousMatches.flat()).size===previousRows.length){
    for(const [index]of previousMatches){reused.add(index);verified.push(descriptions[index]);}
   }else if(previousRows.length){
    const answer=await ask('Medicare has a previous guest drug list. Replace it with your Corsair list?',[{id:'replace',label:'Use the drugs I entered in Corsair'},{id:'stop',label:'Stop — keep the Medicare list'}]);
    if(answer.choice!=='replace')throw new Error('Stopped without changing the existing drug list. Choose the signed-in path to use Medicare’s list.');
    if(!all('a,button',document).some(el=>/^log in$/i.test(text(el).trim())))throw new Error('An account may be signed in. Use the saved-info path instead.');
    for(let i=0;i<30;i++){
     const remove=all('button').find(el=>/^remove\s/i.test(el.getAttribute('aria-label')||text(el)));if(!remove)break;
     await click(remove);if(button('Remove'))await click(button('Remove'));await pause(500);
    }
   }
   for(const [index,med]of profile.medications.entries()){
    if(reused.has(index))continue;
    await status(`Adding medication ${index+1} of ${profile.medications.length}…`);
    if(button('Add another drug'))await click(button('Add another drug'));
    const search=await wait(()=>all('input').find(el=>/^autocomplete--/.test(el.id)),'opening medication search');
    const parts=corsairDrugParts(med);input(search,parts.search);await pause(700);
    const options=await wait(()=>{const a=all('[role="option"]');return a.length?a:null;},'finding medication matches');
    const expectedIngredients=parts.name.split('/').map(s=>corsairNormalize(s).split(' ')[0]);
    const relevant=options.filter(el=>{const ingredients=optionLabel(el).split('/').map(s=>corsairNormalize(s).split(' ')[0]);return ingredients.length===expectedIngredients.length&&expectedIngredients.every((v,i)=>ingredients[i]===v);});
    if(!relevant.length)throw new Error(`Medicare did not find a matching drug name for ${med.name}. No different medication was substituted.`);
    const selectedName=await choose(relevant,parts.name,`Confirm the Medicare drug name for ${med.name}`);
    await click(await wait(()=>button('Add'),'opening the selected drug'));
    const dose=await selectDose(med);
    await click(await wait(()=>document.getElementById('drug-select-frequency'),'loading refill frequency'));
    const frequency={30:'Every month',60:'Every 2 months',90:'Every 3 months'}[med.days];
    await choose(await wait(()=>{const a=all('[role="option"]');return a.length?a:null;},'loading refill choices'),frequency,'How often do you refill this drug?');
    const quantity=await wait(()=>document.getElementById('drug-select-quantity'),'loading fill quantity');
    input(quantity,med.quantity);quantity.blur();await pause(400);
    if(Number(quantity.value)!==med.quantity)throw new Error('Medicare did not accept the fill quantity. Check it in Medicare before continuing.');
    await click(await wait(()=>button('Add to my drug list'),'adding the configured drug'));
    await wait(()=>/Review your drug list/i.test(text(main())),'checking the updated drug list');
    verified.push({name:selectedName,dose,quantity:med.quantity,frequency});
    const rows=all('li').filter(el=>/Quantity[\s\S]*Frequency/i.test(text(el)));
    if(rows.length!==verified.length)throw new Error('The Medicare drug list has unexpected entries. No prices were collected.');
    for(const v of verified){
     if(!rows.some(row=>rowMatches(row,v)))throw new Error('The Medicare drug strength, quantity, or refill frequency did not match. No prices were collected.');
    }
   }
   await click(await wait(()=>button('Continue'),'continuing to pharmacies'));
   await wait(()=>document.getElementById('mct-pharmacy-search-form'),'opening pharmacy search');
   let pharmacyQuery=profile.pharmacy;
   const selectedPharmacies=[];
   for(let attempt=0;attempt<30;attempt++){
    await status('Finding your pharmacy locations…');
    const form=document.getElementById('mct-pharmacy-search-form');
    const pharmacy=all('input',form).find(el=>/pharmacy name/i.test(labelled(el)));
    if(pharmacy){input(pharmacy,/^mail[ -]?order$/i.test(pharmacyQuery)?'':pharmacyQuery);await click(button('Find pharmacies'));await pause(1500);}
    const rows=all('li[id]').filter(el=>/^\d{10}$/.test(el.id));
    const choices=rows.map(el=>{
     const name=text(el.querySelector('h2,h3,h4')).trim(),raw=text(el);
     const address=(name?raw.slice(raw.indexOf(name)+name.length).replaceAll(name,''):raw).replace(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/g,'').replace(/,?\s*(Add|Remove)\s*$/i,'').trim();
     return {id:el.id,label:name?`${name}\n${address}`:address};
    });
    const mail=all('input[type="checkbox"]').find(el=>/mail.order/i.test(labelled(el)));
    if(mail)choices.unshift({id:'mailorder',label:'Mail-order pharmacy'});
    choices.push({id:'__search',label:'Search another pharmacy name'});
    const answer=await ask('Which pharmacy locations will you use?',choices,{multiple:true,search:true});
    if(answer.choice==='__search'){pharmacyQuery=answer.query;continue;}
    const ids=Array.isArray(answer.choice)?answer.choice:[answer.choice];
    if(!ids.length||ids.length>5)throw new Error('Choose between 1 and 5 pharmacy locations.');
    // Clear preselected guest pharmacies, then select exactly the confirmed set.
    for(const box of all('input[type="checkbox"]').filter(el=>el.checked))await click(box);
    for(const id of ids){
     const box=id==='mailorder'?mail:document.getElementById('checkbox_pharmacy-'+id);
     if(!box)throw new Error('The pharmacy list changed. Search again.');await click(box);
     await wait(()=>box.checked,'selecting your pharmacy');selectedPharmacies.push(choices.find(c=>c.id===id).label);
    }
    if(document.getElementById('pharmacy-selection-footer'))await wait(()=>Number(text(document.getElementById('pharmacy-selection-footer')).match(/(\d+)\s+of\s+5\s+selected/i)?.[1])===ids.length,'verifying the selected pharmacy count');
    break;
   }
   if(!selectedPharmacies.length)throw new Error('No pharmacies were selected. Start again and choose a location.');
   await status('Getting Medicare’s plan prices…');
   await click(await wait(()=>button('Continue'),'continuing to plan prices'));
   const providerStep=()=>/\/(?:manage-)?providers(?:\?|$)/.test(location.hash);
   await wait(()=>providerStep()||location.hash.includes('/search-results'),'opening the next Medicare step',300);
   if(providerStep())await providers();
   await wait(()=>location.hash.includes('/search-results')&&/Plan\s*ID\s*:/i.test(text(main())),'loading Medicare prices',300);
   const params=new URLSearchParams(location.hash.split('?')[1]||'');
   if(Number(params.get('year'))!==year||params.get('zip')!==profile.zip||params.get('plan_type')!==(profile.coverage==='advantage'?'PLAN_TYPE_MAPD':'PLAN_TYPE_PDP'))throw new Error('Medicare returned a different year, ZIP, or plan type. No results were applied.');
   await collectMedicareResults(requestId);
  }catch(error){await extensionApi.runtime.sendMessage({type:'accountError',requestId,error:error.message}).catch(()=>{});}
  finally{profile=null;if(globalThis.__corsairGuestRequest===requestId)globalThis.__corsairGuestRequest=null;}
 })();
}
