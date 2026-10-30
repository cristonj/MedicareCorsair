const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
// Form labels/IDs and the quantity-reset behavior were observed in Plan Finder.
// This exercises real DOM events across screens without private API access.
function guestFixture({tamper=false,county=false,wrongYear=false,existing=false,advantage=false,providerSearch=false}={}){
 const dom=new JSDOM('<header><a>Log in</a></header><main id="mct-app-main"></main>',{url:'https://www.medicare.gov/plan-compare/?year=2027',runScripts:'outside-only'});
 const w=dom.window,d=w.document,main=d.querySelector('main'),messages=[],drugs=[];let answer,selectedName='',dose='',frequency='Every month',captures=0;
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 w.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{}];};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.setTimeout=fn=>setImmediate(fn);w.getComputedStyle=()=>({visibility:'visible'});
 function button(label,fn){const el=d.createElement('button');el.textContent=label;el.onclick=fn;main.append(el);return el;}
 function render(html){main.innerHTML=html;}
 function options(values,select){const menu=d.createElement('ul');for(const value of values){const el=d.createElement('li');el.setAttribute('role','option');el.textContent=value;el.onclick=()=>{menu.remove();select(value);};menu.append(el);}main.append(menu);}
 function configure(){
  dose='40mg tablet';frequency='Every month';render('<h1>Add '+selectedName+'</h1><label>Dosage</label><button id="drug-select-dosage">40mg tablet</button><label>Quantity<input id="drug-select-quantity" value="99"></label><button id="drug-select-frequency">Every month</button>');
  d.querySelector('#drug-select-dosage').onclick=()=>options(['10mg tablet','20mg tablet','40mg tablet'],value=>{dose=value;d.querySelector('#drug-select-dosage').textContent=value;d.querySelector('#drug-select-quantity').value='60';});
  d.querySelector('#drug-select-frequency').onclick=()=>options(['Every month','Every 2 months','Every 3 months'],value=>{frequency=value;d.querySelector('#drug-select-frequency').textContent=value;d.querySelector('#drug-select-quantity').value='180';});
  button('Add to my drug list',()=>{drugs.push({name:selectedName,dose,frequency,quantity:Number(d.querySelector('#drug-select-quantity').value)});review();});
 }
 function search(){
  render('<h1>Add your drugs</h1><input id="autocomplete--45" role="combobox">');
  d.querySelector('input').oninput=e=>{const name=e.target.value;options([name,'unrelated drug'],value=>{selectedName=value;});};
  button('Add',configure);
 }
 function review(){
  render('<h1>Review your drug list</h1><ul></ul>');
  for(const drug of drugs){const li=d.createElement('li');li.textContent=`${drug.name} ${drug.dose}\nQuantity ${tamper?999:drug.quantity} Frequency ${drug.frequency}`;main.querySelector('ul').append(li);}
  button('Add another drug',search);button('Continue',pharmacies);
 }
 function pharmacies(){
  w.location.hash='/pharmacy?year=2027&zip=60601';
  render('<h1>Select pharmacies</h1><form id="mct-pharmacy-search-form"><label>Pharmacy name (optional)<input></label></form><ul><li id="1619074101"><h3>CVS Pharmacy #04781</h3>205 N Michigan St, Chicago, IL 60601<label><input type="checkbox" id="checkbox_pharmacy-1619074101">Add</label></li><li id="1710254131"><h3>Walgreens #15196</h3>151 N State St, Chicago, IL 60601<label><input type="checkbox" id="checkbox_pharmacy-1710254131">Add</label></li></ul>');
  button('Find pharmacies',()=>{});
  button('Continue',()=>{assert(d.querySelector('#checkbox_pharmacy-1619074101').checked);if(advantage)providerForm();else results();});
 }
 function results(){w.location.hash=`/search-results?year=${wrongYear?2026:2027}&zip=60601&plan_type=${advantage?'PLAN_TYPE_MAPD':'PLAN_TYPE_PDP'}`;render('Plan ID: '+(advantage?'H0001':'S0001')+'-001-0');}
 function providerForm(){
  w.location.hash='/providers?year=2027';render('<h1>Add important health care providers</h1><label>Provider first name<input id="provider-first"></label><label>Provider last name<input id="provider-last"></label>');
  button('Search',()=>{assert.equal(d.querySelector('#provider-last').value,'Smith');const add=button('Add provider Sample Smith MD',()=>{w.location.hash='/manage-providers?year=2027';render('<h1>Review your providers</h1><h2>Sample Smith MD</h2><p>You have 1 saved provider.</p>');button('Add another provider',providerForm);button('Start comparing plans',results);});add.setAttribute('aria-label','Add provider Sample Smith MD');});
  button('Skip adding providers',results);
 }
 function costs(){render('<h1>Include drug costs?</h1><label><input type="radio" id="choice--904">Yes, include drug costs</label>');button('Continue',search);}
 function assistance(){w.location.hash='/extra-help';render('<h1>Help with costs</h1><label><input type="radio" id="choice--852">I don’t get help from any of these programs</label>');button('Continue',existing?review:costs);}
 function plan(){render('<h1>What type of plan?</h1><input type="radio" id="what-coverage-pdp"><input type="radio" id="what-coverage-mapd">');button('Find plans',assistance);}
 if(existing)drugs.push({name:'atorvastatin',dose:'20mg tablet',quantity:90,frequency:'Every 3 months'});
 render('<h1>Find plans</h1><input type="radio" id="coverage-year-next-year"><input id="zipcode-test">'+(county==='radio'?'<fieldset><legend>Select your county</legend><label><input type="radio" name="county" id="17031">Cook, IL</label><label><input type="radio" name="county" id="17097">Lake, IL</label></fieldset>':county?'<label for="county">County</label><select id="county"><option value="">Choose</option><option value="17031">Cook</option><option value="17043">DuPage</option></select>':''));
 button('Continue',()=>{assert.equal(d.querySelector('#zipcode-test').value,'60601');if(county==='radio')assert(d.getElementById('17031').checked);else if(county)assert.equal(d.querySelector('#county').value,'17031');plan();});
 w.extensionApi={runtime:{sendMessage:async message=>{
  messages.push(message);
  if(message.type==='accountPoll'){const value=answer;answer=undefined;return {ok:true,year:2027,answer:value};}
  if(message.type==='guestPrompt'){
   if(message.title.includes('county'))answer={choice:'0'};
   else if(message.title.includes('pharmacy'))answer={choice:['1619074101']};
   else if(message.title.includes('Which doctors'))answer=providerSearch?{choice:'__search',query:JSON.stringify({first:'Sample',last:'Smith'})}:{choice:'skip'};
   else if(message.title.includes('exact doctor'))answer={choice:'provider-0'};
   else if(message.title.includes('another doctor'))answer={choice:'done'};
   else throw new Error('Unexpected ambiguity: '+message.title);
  }
  return {ok:true};
 }}};
 w.collectMedicareResults=async id=>{assert.equal(id,'test');captures++;};
 w.eval(fs.readFileSync('extension/guest.js','utf8'));
 const profile={zip:'60601',coverage:advantage?'advantage':'original',assistance:'none',pharmacy:'CVS',medications:[{rxcui:'617318',name:'atorvastatin 20 MG Oral Tablet',quantity:90,days:90},{rxcui:'314076',name:'lisinopril 10 MG Oral Tablet',quantity:30,days:30}]};
 return {w,profile,messages,drugs,get captures(){return captures;},run:async function(){w.startGuestComparison('test',profile);await w.__corsairGuestTask;}};
}
test('guest flow sets exact drugs, refills and quantities after Medicare resets defaults',async()=>{
 const f=guestFixture({county:true});try{await f.run();assert.equal(f.captures,1);assert.deepEqual(f.drugs.map(d=>[d.dose,d.quantity,d.frequency]),[['20mg tablet',90,'Every 3 months'],['10mg tablet',30,'Every month']]);assert(!f.messages.some(m=>m.type==='accountError'));assert(f.messages.some(m=>m.type==='guestPrompt'&&m.title.includes('county')));}finally{f.w.close();}
});
test('return visits reuse matching drugs and handle real FIPS county radio controls',async()=>{
 const f=guestFixture({existing:true,county:'radio'});try{await f.run();assert.equal(f.captures,1);assert.equal(f.drugs.length,2);assert.equal(f.messages.filter(m=>m.type==='guestPrompt'&&m.title.includes('county')).length,1);assert(!f.messages.some(m=>m.type==='guestPrompt'&&m.title.includes('previous')));}finally{f.w.close();}
});
test('a mismatched displayed drug list never proceeds to prices',async()=>{
 const f=guestFixture({tamper:true});try{await f.run();assert.equal(f.captures,0);assert.match(f.messages.find(m=>m.type==='accountError').error,/did not match/);}finally{f.w.close();}
});
test('a wrong-year result is never collected',async()=>{
 const f=guestFixture({wrongYear:true});try{await f.run();assert.equal(f.captures,0);assert.match(f.messages.find(m=>m.type==='accountError').error,/different year/);}finally{f.w.close();}
});
test('extended release is never substituted with a regular tablet',async()=>{
 const f=guestFixture();try{f.profile.medications[0].name='atorvastatin 20 MG Extended Release Oral Tablet';await f.run();assert.equal(f.captures,0);assert.match(f.messages.find(m=>m.type==='accountError').error,/No different drug was substituted/);}finally{f.w.close();}
});
test('Advantage asks explicitly before skipping provider checks',async()=>{
 const f=guestFixture({advantage:true});try{await f.run();assert.equal(f.captures,1);assert(f.messages.some(m=>m.type==='guestPrompt'&&m.title.includes('Which doctors')));}finally{f.w.close();}
});
test('Advantage fills provider names, confirms the exact person, and continues from provider review',async()=>{
 const f=guestFixture({advantage:true,providerSearch:true});try{await f.run();assert.equal(f.captures,1);assert(!f.messages.some(m=>m.type==='accountError'));}finally{f.w.close();}
});
test('automation stops if a user navigates to enrollment',async()=>{
 const f=guestFixture();try{f.w.location.hash='/enroll';await f.run();assert.equal(f.captures,0);assert.match(f.messages.find(m=>m.type==='accountError').error,/without selecting or enrolling/);}finally{f.w.close();}
});
