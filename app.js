'use strict';
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
try { localStorage.removeItem('medicarecorsair-profile-v2'); } catch {}
const defaults = () => ({ state:'', zip:'', medications:[], coverage:'', goals:[], currentPlan:'', pharmacy:'', providers:'', assistance:'unsure', otherCoverage:'unsure' });
const profile = defaults();
let currentStatus = null, comparison = null, chosen = null, quotes = {}, compareVersion = 0, searchVersion = 0, sourceIdentity = null;
let pendingSavedState = '';
let pendingImport = null;
let setupStep=-1,guideStep=0,guideMode='extension',guidePage=1,queuedCapture=null,guestAutofillAvailable=false;
const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const external = (text, url, className = '') => { const el = node('a', className, text); el.href = url; el.target = '_blank'; el.rel = 'noopener noreferrer'; return el; };
async function api(path, body) {
  const target = location.origin === 'https://medicarecorsair.netlify.app' && path.startsWith('/api/') ? `http://127.0.0.1:8000${path}` : path;
  let response;
  try { response = await fetch(target, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('Open the MedicareCorsair desktop app and keep it open, then try again.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('Start the app with python server.py to connect its data service.'); }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function fingerprint() { return JSON.stringify(['context-v3',currentStatus?.enrollment.year, currentStatus?.source?.url, currentStatus?.source?.modified, profile.state,profile.zip,profile.coverage,profile.assistance,profile.pharmacy, profile.medications.map(m => [m.rxcui, m.quantity, m.days]).sort()]); }
function save() {}
function restore() {}
function supportedCoverage(){return ['original','advantage'].includes(profile.coverage);}
function updateButton() { $('#compare').disabled = !supportedCoverage() || !currentStatus?.source || currentStatus.source.year !== currentStatus.enrollment.year; $('#compare').textContent='Get Medicare prices'; }
function renderMeds() {
  $('#med-count').textContent = profile.medications.length; $('#med-list').replaceChildren();
  if (!profile.medications.length) $('#med-list').append(node('p', 'hint', 'None added.'));
  profile.medications.forEach((med, i) => {
    const row = node('div', 'med'), copy = node('div');
    copy.append(node('strong', '', med.name), node('small', '', `${med.quantity} units every ${med.days} days`));
    const remove = node('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${med.name}`);
    remove.addEventListener('click', () => { profile.medications.splice(i, 1); changed(); renderMeds(); }); row.append(copy, remove); $('#med-list').append(row);
  }); updateButton();
}
function changed() {
  save(); compareVersion++;
  if (comparison) { comparison = null; $('#comparison').hidden = true; $('#results-empty').hidden = false; $('#profile-message').textContent = 'Your list changed. Updating your comparison…'; }
  if (profile.state && currentStatus?.source) runComparison();
  if(queuedCapture&&supportedCoverage()&&profile.state&&profile.medications.length){const capture=queuedCapture;queuedCapture=null;readDocuments({documents:capture.documents});}
}
async function loadStates() {
  const result = await api('/api/states');
  if (!result.states.length) { $('#state').disabled = true; $('#state').replaceChildren(new Option('Waiting for enrollment-year data…', '')); return; }
  const previous = profile.state || pendingSavedState;
  $('#state').replaceChildren(new Option('Choose your state or territory', ''));
  result.states.forEach(s => $('#state').append(new Option(s, s)));
  $('#state').disabled = false;
  if (result.states.includes(previous)) { $('#state').value = previous; profile.state = previous; pendingSavedState = ''; }
  updateButton();
}
async function refreshStatus() {
  try {
    const status = await api('/api/status'); const previousYear = currentStatus?.enrollment.year;
    currentStatus = status;
    $('#enrollment-title').textContent = status.enrollment.message;
    $('#deadline').textContent = status.enrollment.deadline ? '· Choose by December 7' : '';
    $('#year').textContent = `${status.enrollment.year} COVERAGE`;
    $('#sync-summary').textContent = status.sync.error ? 'Update failed · details' : status.sync.running ? 'Updating data…' : status.source ? `CMS ${status.source.modified}` : 'Loading plan data…';
    const identity = status.source ? status.source.url + status.source.modified : '';
    $('#sync-title').textContent = status.sync.running ? status.sync.phase : status.sync.error ? 'Update needs attention' : status.source ? `${status.source.plan_count} plans, automatically collected` : 'Preparing your plan data';
    const checked = status.sync.checked_at ? new Date(status.sync.checked_at).toLocaleString() : 'not yet complete';
    $('#sync-description').textContent = status.sync.error ? `${status.sync.error} Last successful check: ${checked}. The service will retry automatically.` : `Checks every ${status.interval_hours} hours. Last successful check: ${checked}.`;
    $('#refresh').disabled = status.sync.running;
    if (status.source) {
      const age = (Date.now() - Date.parse(status.source.modified)) / 86400000;
      $('#source-detail').textContent = `${status.source.year} benefit year · CMS release ${status.source.modified}. ${status.source.plan_count} stand-alone plans and ${status.source.formulary_rows.toLocaleString()} formulary rows indexed.${age > 45 ? ' This is the latest available release, but it is more than 45 days old. Verify changes with the plan.' : ''}`;
      $('#source-link').href = status.source.page;
    }
    $('#finder-source').href = `https://www.medicare.gov/plan-compare/?year=${status.enrollment.year}&lang=en`;
    $('#price-finder').href = $('#finder-source').href;
    $('#pharmacy-help').href=$('#finder-source').href;
    if (previousYear && previousYear !== status.enrollment.year) { comparison = null; quotes = {}; $('#comparison').hidden = true; $('#results-empty').hidden = false; save(); toast('The enrollment year changed. Refreshing your plans and clearing older estimates.'); }
    if (sourceIdentity !== identity || $('#state').disabled) {
      const hadSource = sourceIdentity !== null; sourceIdentity = identity; await loadStates();
      if (status.source && profile.state && (hadSource || profile.medications.length)) await runComparison();
    }
    updateButton();
  } catch (error) { $('#sync-summary').textContent = 'Open the desktop app'; $('#sync-title').textContent = 'Data service unavailable'; $('#sync-description').textContent = error.message; $('#refresh').disabled = false; }
}
$('#state').addEventListener('change', () => { profile.state = $('#state').value; updateButton(); changed(); });
$('#search-form').addEventListener('submit', async event => {
  event.preventDefault();clearTimeout(drugSearchTimer); const version = ++searchVersion; $('#drug-results').replaceChildren(); $('#add-form').hidden = true; chosen = null;
  $('#search-message').textContent = 'Looking up exact strengths and forms in RxNorm…';
  try {
    const result = await api(`/api/drugs?q=${encodeURIComponent($('#drug-search').value.trim())}`);
    if (version !== searchVersion) return;
    $('#search-message').textContent = result.results.length ? 'Choose your exact strength and form.' : 'No matches. Try a generic or shorter name.';
    result.results.forEach(drug => {
      const button = node('button', 'drug-choice', drug.name); button.type = 'button'; button.append(node('small', '', drug.brand ? 'Brand product' : 'Generic product'));
      button.addEventListener('click', () => { chosen = drug; $('#chosen-drug').textContent = drug.name; $('#drug-results').replaceChildren(); $('#search-message').textContent = 'Check the quantity and days supply on your label.'; $('#add-form').hidden = false; $('#quantity').focus(); });
      $('#drug-results').append(button);
    });
  } catch (error) { if (version === searchVersion) $('#search-message').textContent = error.message; }
});
let drugSearchTimer;
$('#drug-search').addEventListener('input',()=>{
 clearTimeout(drugSearchTimer);searchVersion++;$('#drug-results').replaceChildren();$('#add-form').hidden=true;chosen=null;
 if($('#drug-search').value.trim().length<2){$('#search-message').textContent='';return;}
 drugSearchTimer=setTimeout(()=>$('#search-form').requestSubmit(),450);
});
$('#add-form').addEventListener('submit', event => {
  event.preventDefault(); if (!chosen) return;
  if (profile.medications.length >= 30) return toast('You can compare up to 30 medications.');
  if (profile.medications.some(m => m.rxcui === chosen.rxcui)) return toast('That exact medication is already in your list. Remove it first to change the quantity.');
  profile.medications.push({ ...chosen, quantity: Number($('#quantity').value), days: Number($('#days').value) });
  chosen = null; $('#add-form').hidden = true; $('#drug-search').value = ''; $('#search-message').textContent = ''; renderMeds(); changed();
});

$('#compare').addEventListener('click',openCapture);
async function runComparison() {
  if (!profile.state || !currentStatus?.source || !supportedCoverage()) return;
  if(profile.coverage==='advantage'){
    $('#profile-message').textContent='';
    const saved=Object.entries(quotes).filter(([id,q])=>/^[HR]/.test(id)&&currentQuote(id)&&typeof q.planName==='string');
    comparison={year:currentStatus.enrollment.year,state:profile.state,source:currentStatus.source,scope:'advantage',plans:saved.map(([id,q])=>({id,name:q.planName,premium:q.monthlyPremium,annual_premium:q.monthlyPremium*12,deductible:q.deductible,medical_max:q.medicalMax,primary_copay:q.primaryCopay,specialist_copay:q.specialistCopay,medications:[],listed_count:0,restriction_count:0,finder_url:$('#finder-source').href}))};
    $('#results-empty').hidden=!!saved.length;$('#comparison').hidden=!saved.length;
    if(saved.length){$('#sort').value='quote';renderPlans();}
    flushCapture();
    updateButton();return;
  }
  const version = ++compareVersion; $('#profile-message').textContent = 'Checking your medications against CMS drug lists…';
  try {
    const response = await api('/api/compare', {state:profile.state,medications:profile.medications});
    if (version !== compareVersion) return;
    const firstRender = !comparison;
    comparison = response; $('#comparison').hidden = false; $('#results-empty').hidden = true;
    if (firstRender && response.plans.some(p => currentQuote(p.id))) $('#sort').value = 'quote';
    $('#profile-message').textContent = ''; renderPlans();
    flushCapture();
  } catch (error) { if (version === compareVersion) $('#profile-message').textContent = error.message; }
}
function currentQuote(id) { const quote = quotes[id]; return quote && quote.fingerprint === fingerprint() && Number.isFinite(quote.drugCost) && quote.drugCost >= 0 ? quote : null; }
function quotedTotal(plan) { const quote = currentQuote(plan.id); return quote ? quote.annualTotal ?? plan.annual_premium + quote.drugCost : Infinity; }
function shareText(rule) {
  if (!rule) return 'Not offered / unavailable';
  let value = rule.type === 'copay' ? money(rule.amount) + ' copay' : Math.round(rule.amount * 10000) / 100 + '% coinsurance';
  if (Number(rule.minimum) > 0) value += ` · min ${money(Number(rule.minimum))}`;
  if (Number(rule.maximum) > 0) value += ` · max ${money(Number(rule.maximum))}`;
  return value + (rule.deductible_applies ? ' · deductible applies' : ' · no tier deductible');
}
function medDetails(med) {
  const section = node('div', 'drug-detail'); section.append(node('h4', '', med.name));
  section.append(node('p', 'drug-meta', med.listed ? `Listed · Tier ${med.tiers.join(', ')} · ${med.quantity} units / ${med.days} days` : 'Not found in the basic drug list for this exact product. Check indication coverage, exceptions, and the plan formulary.'));
  med.restrictions.forEach(flag => section.append(node('span', 'restriction', flag)));
  if (med.quantity_limits.length) section.append(node('p', 'hint', 'CMS quantity limits: ' + [...new Set(med.quantity_limits.map(l => `${l.amount} units per ${l.days} days`))].join('; ') + '. Confirm the unit on the plan formulary.'));
  med.indications.forEach(d => section.append(node('p', 'hint', `Indication: ${d}`)));
  if (med.cost_sharing.length) {
    section.append(node('p', 'hint', `Initial-coverage cost-sharing rules for a ${med.days}-day fill. Network status and drug price are not verified. Quantity limits and exceptions can change what applies.`));
    const wrap = node('div', 'table-wrap'), table = node('table', 'cost-table'), head = node('thead'), row = node('tr');
    ['Tier', 'Preferred retail', 'Standard retail', 'Preferred mail'].forEach(t => { const th = node('th', '', t); th.scope = 'col'; row.append(th); }); head.append(row); table.append(head);
    const tbody = node('tbody'); med.cost_sharing.forEach(cost => { const tr = node('tr'); [cost.tier, shareText(cost.preferred), shareText(cost.standard), shareText(cost.mail)].forEach(v => tr.append(node('td', '', String(v)))); tbody.append(tr); }); table.append(tbody); wrap.append(table); section.append(wrap);
  } else if (med.listed) section.append(node('p', 'hint', 'No initial-coverage cost rule was found for this days supply. Check the plan finder.'));
  return section;
}
function planCard(plan) {
  const quote = currentQuote(plan.id), monthly = quote?.monthlyPremium ?? plan.premium, annualPremium = Math.round(monthly * 1200) / 100;
  const card = node('article', 'plan'), head = node('div', 'plan-head'), title = node('div'), price = node('div', 'premium');
  title.append(node('h3', '', plan.name), node('p', 'plan-id', plan.id.slice(0,9)));
  const allListed = profile.medications.length && plan.listed_count === profile.medications.length;
  if (profile.medications.length && profile.coverage!=='advantage') title.append(node('span', `match-badge${allListed ? '' : ' partial'}`, `${plan.listed_count}/${profile.medications.length} medications listed`));
  price.append(node('strong', '', money(monthly)), node('small', '', 'monthly plan premium')); head.append(title, price); card.append(head);
  const metrics = node('div', 'plan-metrics');
  [['Annual premium', money(annualPremium)], [profile.coverage==='advantage'?'In-network medical limit':'Drug deductible', profile.coverage==='advantage'?(Number.isFinite(plan.medical_max)?money(plan.medical_max):'Check plan'):(Number.isFinite(plan.deductible)?money(plan.deductible):'Check plan')], [quote ? quote.kind === 'import' ? 'Drug + premium / year' : 'Total with entered estimate' : 'Annual total', quote ? money(quotedTotal(plan)) : 'Needs drug prices']].forEach(([label, value], i) => { const cell = node('div'); cell.append(node('span', '', label), node('strong', i === 2 && !quote ? 'unknown' : '', value)); metrics.append(cell); }); card.append(metrics);
  if (quote?.kind === 'import') card.append(node('p', 'hint quote-source', `Medicare results · reviewed ${new Date(quote.date).toLocaleDateString()}`));
  const detail = node('details'), summary = node('summary', '', 'View coverage & costs'); detail.append(summary);
  if (plan.provider) detail.append(node('p', 'hint', plan.provider));
  if (!plan.medications.length && profile.coverage!=='advantage') detail.append(node('p', 'hint', 'Add your medications to check coverage and cost-sharing rules automatically.'));
  plan.medications.forEach(m => detail.append(medDetails(m)));
  if(profile.coverage==='advantage'){
    detail.append(node('p','hint','Also check medical copays, doctors, hospitals, and the medical out-of-pocket limit.'));
    if(plan.primary_copay)detail.append(node('p','hint',`Primary care: ${plan.primary_copay}`));
    if(plan.specialist_copay)detail.append(node('p','hint',`Specialist: ${plan.specialist_copay}`));
    if(profile.providers)detail.append(node('p','hint',`Keep: ${profile.providers}`));
    detail.append(external('Check this plan in Medicare ↗',plan.finder_url));
  }
  const manual = node('div', 'manual-step'), heading = node('h4', '', 'Annual drug cost'); manual.append(heading);
  manual.append(external(`Open Medicare Plan Finder for ${comparison.year} ↗`, plan.finder_url));
  manual.append(node('p', '', `Search for ${plan.id.slice(0,9)}. Use this medication list, the same quantities, and your pharmacy. Verify the pharmacy network. Enter only the estimated annual drug out-of-pocket cost below; the premium is already included above.`));
  const label = node('label', '', 'Estimated annual drug cost ($)'); label.htmlFor = `quote-${plan.id}`; manual.append(label);
  const controls = node('form', 'quote-controls'), input = node('input'); input.type = 'number'; input.id = label.htmlFor; input.min = '0'; input.max = '1000000'; input.step = '.01'; input.required = true; input.placeholder = 'Drug costs only'; if (quote) input.value = quote.drugCost;
  const add = node('button', 'button secondary', 'Save estimate'); add.type = 'submit'; controls.append(input, add);
  controls.addEventListener('submit', e => { e.preventDefault(); if (!controls.reportValidity()) return; quotes[plan.id] = { kind:'manual', planName:plan.name, monthlyPremium:monthly, annualTotal:annualPremium+Number(input.value), deductible:plan.deductible, medicalMax:plan.medical_max, primaryCopay:plan.primary_copay, specialistCopay:plan.specialist_copay, drugCost:Number(input.value), fingerprint:fingerprint(), date:new Date().toISOString() }; save(); renderPlans(); toast('Estimate saved for this medication list and coverage year.'); }); manual.append(controls);
  if (quote) {
    manual.append(node('p', 'quote-date', `${quote.kind === 'import' ? 'Imported and reviewed' : 'Entered'} ${new Date(quote.date).toLocaleDateString()}. Not independently verified. Excludes income surcharges, penalties, and other medical costs.`));
    const remove = node('button', 'plain', 'Remove estimate'); remove.addEventListener('click', () => { delete quotes[plan.id]; save(); if(profile.coverage==='advantage')runComparison();else renderPlans(); }); manual.append(remove);
  }
  detail.append(manual); card.append(detail); return card;
}
function renderPlans() {
  if (!comparison) return;
  let plans = [...comparison.plans]; const mode = $('#sort').value;
  if ($('#covered-only').checked && profile.coverage!=='advantage') plans = plans.filter(p => p.listed_count === profile.medications.length);
  if (mode === 'premium') plans.sort((a,b) => a.premium - b.premium);
  if (mode === 'quote') plans.sort((a,b) => quotedTotal(a) - quotedTotal(b) || (a.medical_max??Infinity)-(b.medical_max??Infinity));
  $('#ranking-note').textContent = mode === 'quote' ? 'Annual drug + premium estimates. Missing estimates appear last.' : mode === 'premium' ? 'Premium only; annual drug costs are not included.' : 'Plans listing your medications first, then lowest premium. Check restrictions in plan details.';
  $('#result-count').textContent = `${plans.length} plans shown`; $('#plan-list').replaceChildren(...plans.map(planCard)); $('#no-matches').hidden = !!plans.length;
  const all = comparison.plans.filter(p => profile.medications.length && p.listed_count === profile.medications.length).length;
  $('#summary').textContent = `${comparison.plans.length} plans${profile.state?' in '+profile.state:''}${profile.medications.length && profile.coverage!=='advantage' ? ' · ' + all + ' list all your medications' : ''}`;
  renderDecision();
}
function renderDecision() {
  const box = $('#decision'); box.replaceChildren();
  const complete = comparison.plans.filter(p => currentQuote(p.id));
  if (complete.length) {
    complete.sort((a,b) => quotedTotal(a) - quotedTotal(b) || (a.medical_max??Infinity)-(b.medical_max??Infinity));
    const winner = complete[0], quote = currentQuote(winner.id), total = quotedTotal(winner), premium = (quote.monthlyPremium ?? winner.premium) * 12;
    const tied=complete.filter(p=>Math.abs(quotedTotal(p)-total)<.01).length;
    box.append(node('h3', '', tied>1?`${tied} plans share the lowest drug + premium estimate`:profile.coverage==='advantage'?'Lowest drug + premium estimate':quote.kind === 'import' ? 'Lowest annual estimate in your import' : 'Lowest entered annual estimate'), node('strong', '', tied>1?`${money(total)}/year · compare ${profile.coverage==='advantage'?'the health benefits':'coverage details'} below`:`${winner.name} · ${money(total)}/year`), node('p', '', `${money(premium)} in premiums + ${money(quote.drugCost)} in estimated drug costs.${complete[1]&&tied===1 ? ' ' + money(quotedTotal(complete[1]) - total) + ' less than the next estimate.' : ''}${comparison.plans.length > complete.length ? ' ' + (comparison.plans.length - complete.length) + ' plans still need estimates.' : ''}`));
    if(profile.coverage==='advantage')box.append(node('p','','Medical costs and provider networks still need checking.'));
    if (quote.kind === 'import') box.append(node('p', '', `For ${quote.pharmacies}.`));
  } else {
    box.append(node('h3', '', 'Cheapest overall: still needs drug prices'));
    let candidates = comparison.plans.filter(p => p.listed_count === profile.medications.length);
    candidates.sort((a,b) => a.premium - b.premium);
    if (candidates.length) {
      const candidate = candidates[0];
      box.append(node('strong', '', `Lowest premium${profile.medications.length ? ' matching your list' : ''}: ${candidate.name}`));
      box.append(node('p', '', `${money(candidate.premium)}/month${profile.medications.length ? ' · Lists all ' + profile.medications.length + ' medications' : ''}${candidate.restriction_count ? ' · ' + candidate.restriction_count + ' coverage restriction' + (candidate.restriction_count === 1 ? '' : 's') + ' to check' : ''}. Drug costs could change which plan is cheapest.`));
    } else box.append(node('p', '', 'No plan lists every medication in your list. Review coverage details before comparing prices.'));
  }
}
$('#sort').addEventListener('change', renderPlans); $('#covered-only').addEventListener('change', renderPlans);
$('#refresh').addEventListener('click', async () => { try { await api('/api/sync', {}); toast('Checking CMS for newer data…'); setTimeout(refreshStatus, 1000); } catch (error) { toast(error.message); } });
$('#reset').addEventListener('click', () => {
  if (!confirm('Clear your medication list, estimates, and saved information from this browser?')) return;
  compareVersion++; searchVersion++; Object.assign(profile,defaults()); quotes = {}; comparison = null; chosen = null; pendingSavedState = ''; clearAccount();save(); $('#state').value = ''; $('#comparison').hidden = true; $('#results-empty').hidden = false; $('#add-form').hidden = true; $('#drug-results').replaceChildren(); $('#drug-search').value = ''; $('#search-message').textContent = ''; $('#profile-message').textContent = ''; renderMeds();setupStep=-1;showSetup();toast('Your information has been cleared.');
});

$('#sync-summary').addEventListener('click', () => { $('#sources').open = true; });
// Short intake and assisted capture.
function field(label,key,{options,placeholder='',required=false}={}) {
  const wrap=node('div','setup-field'),id='setup-'+key,lab=node('label','',label);lab.htmlFor=id;
  const input=node(options?'select':'input');input.id=id;
  if(options)options.forEach(([value,text])=>input.append(new Option(text,value)));
  else{input.type='text';input.autocomplete='off';input.maxLength=500;input.placeholder=placeholder;}
  input.required=required;input.value=profile[key]||'';input.addEventListener('input',()=>profile[key]=input.value);
  wrap.append(lab,input);return wrap;
}
function showSetup(){
  $('#setup-view').hidden=false;$('#workspace-view').hidden=true;
  $('#account-view').hidden=true;
  if(setupStep===-1){
    $('#setup-step').textContent='Getting started';$('#setup-back').hidden=true;$('#setup-next').hidden=true;
    $('#setup-title').textContent='Are you logged into Medicare.gov in this browser?';
    const content=$('#setup-content');content.replaceChildren();
    for(const [label,yes] of [['Yes, use my Medicare info',true],['No / not sure',false]]){
      const button=node('button','coverage-choice',label);button.type='button';
      button.addEventListener('click',()=>{if(yes)showAccount();else{setupStep=0;showSetup();}});content.append(button);
    }
    $('#setup-title').focus();return;
  }
  $('#setup-step').textContent=`${setupStep===0?1:2} of 2`;$('#setup-back').hidden=false;
  const content=$('#setup-content');content.replaceChildren();$('#setup-next').disabled=false;$('#setup-next').hidden=setupStep===0;
  const titles=['What coverage do you have?','','','Help with Medicare costs'];
  $('#setup-title').textContent=titles[setupStep];$('#setup-next').textContent=setupStep===3?'Start comparing':'Continue';
  if(setupStep===0){
    const choices=[['original','Original Medicare','Parts A & B, with or without Medigap'],['advantage','Medicare Advantage','Part C, often with drug coverage'],['employer','Employer or retiree coverage','Through work or a former employer'],['unsure','I’m not sure','We’ll help you check']];
    choices.forEach(([value,title,desc])=>{const button=node('button','coverage-choice');button.type='button';button.append(node('strong','',title),node('span','',desc));button.setAttribute('aria-pressed',String(profile.coverage===value));button.addEventListener('click',()=>{profile.coverage=value;if(!supportedCoverage())showWorkspace();else{setupStep=3;showSetup();}});content.append(button);});
  }else{
    content.append(field('Program','assistance',{required:true,options:[['','Choose an answer'],['none','None'],['medicaid','Medicaid'],['extra_help','Extra Help'],['ssi','Supplemental Security Income'],['msp','Medicare Savings Program']]}));
    content.append(external('Check help with drug costs ↗','https://www.medicare.gov/basics/costs/help/drug-costs','small-link'));
  }
  $('#setup-title').focus();
}
function showWorkspace(){
  $('#setup-view').hidden=true;$('#account-view').hidden=true;$('#workspace-view').hidden=false;
  $('#zip').value=profile.zip;$('#pharmacy').value=profile.pharmacy;updateButton();
  const advantage=profile.coverage==='advantage',supported=supportedCoverage();
  $('.profile').hidden=!supported;
  $('#sort option[value="match"]').hidden=advantage;
  if(advantage&&$('#sort').value==='match')$('#sort').value='quote';
  $('#page-title').textContent=advantage?'Compare health & drug plans':supported?'Compare drug plans':'Your Medicare setup';
  $('#scope-note').textContent=advantage?'Part C: compare drug + premium prices, then check doctors and medical benefits.':supported?'Separate Part D drug plans.':'';
  $('#covered-only').closest('label').hidden=advantage;$('#open-import').hidden=true;$('#manual-import').hidden=!supported;
  $('#coverage-route').hidden=supported;$('#coverage-route').replaceChildren();
  if(!supported){const route=$('#coverage-route');route.append(node('h3','',profile.coverage==='employer'?'Check your existing benefits first':'Let’s identify your coverage'),node('p','hint',profile.coverage==='employer'?'Your benefits administrator can confirm how Medicare fits your coverage.':'Check your plan cards or Medicare account. Then update your setup.'),external('View my Medicare coverage ↗','https://www.medicare.gov/account/login'),external('Find free local help ↗','https://www.shiphelp.org/'));$('#results-empty').hidden=true;$('#comparison').hidden=true;}
  else {$('#results-empty').querySelector('h3').textContent='Add your medications.';$('#results-empty').querySelector('p').textContent=guestAutofillAvailable?'Then get Medicare prices. We’ll enter your details for you.':'Then use the guided Medicare import. Automatic entry needs the updated extension.';if(profile.state)runComparison();}
  if(queuedCapture&&supported&&profile.medications.length){const capture=queuedCapture;queuedCapture=null;readDocuments(capture);}
}
$('#setup-back').addEventListener('click',()=>{setupStep=setupStep===3?0:-1;showSetup();});
$('#setup-next').addEventListener('click',()=>{if(![...$('#setup-content').querySelectorAll('input,select')].every(input=>input.reportValidity()))return;if(setupStep<3){setupStep++;showSetup();}else{save();compareVersion++;comparison=null;$('#comparison').hidden=true;showWorkspace();}});
$('#edit-setup').addEventListener('click',()=>{setupStep=-1;showSetup();});
$('#zip').addEventListener('change',()=>{profile.zip=$('#zip').value.trim();changed();});
$('#pharmacy').addEventListener('change',()=>{profile.pharmacy=$('#pharmacy').value.trim();changed();});
$('#zip').addEventListener('input',()=>{profile.zip=$('#zip').value.trim();save();});
$('#pharmacy').addEventListener('input',()=>{profile.pharmacy=$('#pharmacy').value.trim();save();});
function renderGuide(){
 const area=$('#guide-content');area.replaceChildren();$('#guide-back').hidden=guideStep===0;$('#guide-next').hidden=false;$('#guide-next').textContent='Continue';$('#import-load').hidden=true;
 const heading=text=>area.append(node('h3','guide-title',text));
 const action=(text,handler)=>{const button=node('button','button secondary',text);button.type='button';button.addEventListener('click',handler);area.append(button);};
 const year=currentStatus?.enrollment.year||'';
 if(guideStep===0){
  heading('How would you like to bring in prices?');$('#guide-next').hidden=true;
  action('Browser extension · collects every page',()=>{guideMode='extension';guideStep=1;renderGuide();});
  action('PDF walkthrough',()=>{guideMode='pdf';guideStep=1;guidePage=1;renderGuide();});
  action('I already have result files',()=>{guideMode='pdf';guideStep=4;renderGuide();});
 }else if(guideStep===1&&guideMode==='extension'){
  heading('Your extension is ready.');
  area.append(node('p','hint','Use Medicare and MedicareCorsair in this same browser.'));
  $('#guide-next').textContent='Continue';
 }else if((guideStep===1&&guideMode==='pdf')||(guideStep===2&&guideMode==='extension')){
  heading('Set up your Medicare comparison.');
  area.append(node('p','hint',`${year} coverage · ${profile.coverage==='advantage'?'Medicare Advantage with drug coverage':'Drug plan (Part D)'} · ZIP ${profile.zip||'enter your ZIP'}`));
  area.append(external('Open Medicare Plan Finder ↗',$('#finder-source').href,'button primary'));
  area.append(node('p','hint',`Add your medications, help with costs, and pharmacies.${profile.coverage==='advantage'?' Add the doctors and hospitals you want to keep, too.':''}`));
  $('#guide-next').textContent='Medicare is showing page 1';
 }else if(guideMode==='extension'){
  heading('Collect all pages in one step.');area.append(node('p','hint','In the Medicare tab, open MedicareCorsair’s extension → Collect and send all pages.'));
  action('Use PDFs instead',()=>{guideMode='pdf';guideStep=2;renderGuide();});$('#guide-next').hidden=true;
 }else if(guideStep===2){
  heading(`Save result page ${guidePage}.`);area.append(node('p','hint',`${guidePage>1?'In Medicare, click Next. Then use the printer icon':'Use Medicare’s printer icon'} → Save as PDF → save all print pages as “Medicare-page-${guidePage}.pdf”.`));
  area.append(node('p','hint','One result page may print onto several PDF pages. Save them together.'));$('#guide-next').textContent='Saved this result page';
 }else if(guideStep===3){
  heading('Does Medicare show a Next page?');$('#guide-next').hidden=true;
  action('Yes · save the next results page',()=>{guidePage++;guideStep=2;renderGuide();});
  action('No · upload my files',()=>{guideStep=4;renderGuide();});
  area.append(node('p','hint',`${guidePage} result page${guidePage===1?'':'s'} saved. Use Medicare’s Next link, below the plans, before printing again.`));
 }else{
  heading('Upload all result files together.');area.append(node('p','hint','Select every saved results file. Duplicate plans are removed automatically.'));$('#guide-next').hidden=true;$('#import-load').hidden=false;
 }
}
function validateGuest(){
 if(!supportedCoverage())return toast('Choose your coverage type first.');
 if(!$('#zip').reportValidity()||!$('#pharmacy').reportValidity())return;
 if(!profile.medications.length)return toast('Add your medications first.');
 if(!profile.assistance||profile.assistance==='unsure'){toast('Choose whether you get help with Medicare costs.');setupStep=3;showSetup();return;}
 return true;
}
function openCapture(){if(!guestAutofillAvailable)return openManualCapture();if(validateGuest())showAccount('guest');}
function openManualCapture(){
 if(!validateGuest())return;
 if(!profile.state){$('#state').hidden=false;$('label[for="state"]').hidden=false;$('#state').focus();toast('Choose your state to match the plans in your PDFs.');return;}
 guideStep=0;$('#import-review').hidden=true;$('#import-message').textContent='';$('#capture-guide').hidden=false;renderGuide();$('#import-dialog').showModal();
}
$('#open-import').addEventListener('click',openCapture);
$('#manual-import').addEventListener('click',openManualCapture);
$('#guide-back').addEventListener('click',()=>{guideStep=Math.max(0,guideStep-1);renderGuide();});
$('#guide-next').addEventListener('click',()=>{guideStep++;renderGuide();});
$('#close-import').addEventListener('click',()=>$('#import-dialog').close());
$('#import-file').addEventListener('change',()=>{$('#files-summary').textContent=`${$('#import-file').files.length} file(s) selected`;});
async function fileDocument(file){
 if(file.size>8*1024*1024)throw new Error('Each file must be smaller than 8 MB.');
 if(file.name.toLowerCase().endsWith('.pdf')){
  const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});return {pdf:encoded};
 }
 const text=await file.text();
 if(file.name.toLowerCase().endsWith('.json')){const capture=JSON.parse(text);if(!Array.isArray(capture.documents))throw new Error('This file is not a MedicareCorsair collection.');return capture.documents;}
 return {text};
}
async function readDocuments(payload){
 pendingImport=null;$('#import-review').hidden=true;$('#read-import').disabled=true;$('#import-message').textContent='Reading locally… Image PDFs may take a minute.';
 if(!$('#import-dialog').open)$('#import-dialog').showModal();
 const context=fingerprint();
 try{
  const result=await api('/api/import-quotes',payload);
  if(context!==fingerprint())throw new Error('Your setup changed. Please read these files again.');
  if(profile.coverage==='advantage')result.quotes=result.quotes.filter(q=>/^[HR]/.test(q.id));
  else{const ids=new Set(comparison?.plans.map(p=>p.id)||[]);result.quotes=result.quotes.filter(q=>ids.has(q.id));}
  if(!result.quotes.length)throw new Error('These plans don’t match your coverage type and location. Check your Medicare search.');
  pendingImport={...result,fingerprint:context};$('#capture-guide').hidden=true;$('#import-load').hidden=true;
  const table=$('#import-table');table.replaceChildren();const head=node('tr');
  ['Plan','Monthly premium','Drug + premium / year'].forEach(label=>{const th=node('th','',label);th.scope='col';head.append(th);});table.append(head);
  result.quotes.forEach(q=>{const row=node('tr');[q.name,money(q.monthly_premium),money(q.annual_total)].forEach(v=>row.append(node('td','',v)));table.append(row);});
  $('#import-message').textContent=`${result.quotes.length} plans read for ${result.year}.${result.ocr?' Check OCR amounts against your printouts.':''}`;
  $('#import-warnings').textContent=result.warnings.join(' ');$('#confirm-import').checked=false;$('#import-context').value=profile.pharmacy;$('#import-review').hidden=false;
 }catch(error){$('#import-message').textContent=error.message;$('#capture-guide').hidden=false;guideMode='pdf';guideStep=4;renderGuide();}
 finally{$('#read-import').disabled=false;}
}
$('#import-load').addEventListener('submit',async e=>{
 e.preventDefault();try{
  const files=[...$('#import-file').files];if(files.length>15)throw new Error('Choose up to 15 files at once.');
  if(files.reduce((sum,f)=>sum+f.size,0)>20*1024*1024)throw new Error('Choose files totaling less than 20 MB.');
  const documents=files.length?(await Promise.all(files.map(fileDocument))).flat():[{text:$('#import-text').value}];await readDocuments({documents});
 }catch(error){$('#import-message').textContent=error.message;}
});
$('#import-review').addEventListener('submit',e=>{
 e.preventDefault();if(!pendingImport||!$('#import-review').reportValidity())return;
 if(pendingImport.fingerprint!==fingerprint()){$('#import-message').textContent='Your setup changed. Read the files again.';return;}
 const pharmacies=$('#import-context').value.trim();if(!pharmacies)return;
 if(profile.coverage==='advantage'){
  comparison={year:pendingImport.year,state:profile.state,source:currentStatus.source,scope:'advantage',plans:pendingImport.quotes.map(q=>({id:q.id,name:q.name,premium:q.monthly_premium,annual_premium:q.monthly_premium*12,deductible:q.deductible,medical_max:q.medical_max,primary_copay:q.primary_copay,specialist_copay:q.specialist_copay,medications:[],listed_count:0,restriction_count:0,finder_url:$('#finder-source').href}))};
 }
  pendingImport.quotes.forEach(q=>{quotes[q.id]={kind:'import',planName:q.name,deductible:q.deductible,medicalMax:q.medical_max,primaryCopay:q.primary_copay,specialistCopay:q.specialist_copay,drugCost:q.annual_drugs,annualTotal:q.annual_total,monthlyPremium:q.monthly_premium,pharmacies,date:pendingImport.captured_at,fingerprint:fingerprint()};});
 save();$('#comparison').hidden=false;$('#results-empty').hidden=true;$('#sort').value='quote';renderPlans();$('#import-dialog').close();toast(`${pendingImport.quotes.length} annual estimates imported.`);
});
function flushCapture(){if(queuedCapture&&supportedCoverage()&&profile.state&&profile.medications.length&&currentStatus?.source){const capture=queuedCapture;queuedCapture=null;readDocuments({documents:capture.documents});}}
// Account comparisons use Medicare's inputs, not a second local questionnaire.
let accountRequest=null,accountMode='account',accountResult=null,promptSearchState={first:'',last:'',pharmacy:''};
function showAccount(mode='account'){
 accountMode=mode;
 $('#setup-view').hidden=true;$('#workspace-view').hidden=true;$('#account-view').hidden=false;
 $('#account-title').textContent=mode==='guest'?'Getting your Medicare prices':'Use your Medicare info';
 $('#account-guest').textContent=mode==='guest'?'Back to my details':'Use the questionnaire instead';
 $('#account-note').textContent=mode==='guest'?'We’ll enter your details, confirm exact pharmacy locations with you, and collect every results page.':'Check your saved drugs and pharmacies in Medicare. We’ll collect every results page and bring you back. No password is shared with this app.';
 $('#account-title').focus();
 $('#account-start').click();
}
function clearAccount(){
 if(accountRequest)window.postMessage({type:'medicarecorsair-account-cancel',requestId:accountRequest},location.origin);
 accountRequest=null;accountResult=null;$('#guest-prompt').replaceChildren();$('#account-start').hidden=false;$('#account-start').disabled=false;$('#account-results').hidden=true;$('#account-plans').replaceChildren();$('#account-summary').replaceChildren();$('#account-warnings').textContent='';$('#account-confirm').checked=false;
 $('#account-open').hidden=true;
 promptSearchState={first:'',last:'',pharmacy:profile.pharmacy};
}
$('#account-guest').addEventListener('click',()=>{clearAccount();if(accountMode==='guest')showWorkspace();else{setupStep=0;showSetup();}});
$('#account-open').addEventListener('click',()=>{if(accountRequest)window.postMessage({type:'medicarecorsair-open-medicare',requestId:accountRequest},location.origin);});
$('#account-start').addEventListener('click',async()=>{
 clearAccount();accountRequest=crypto.randomUUID();const requestId=accountRequest;
 $('#account-status').textContent='Opening Medicare…';$('#account-start').disabled=true;
 try{
  const status=await api('/api/status');if(accountRequest!==requestId)return;
  window.postMessage({type:'medicarecorsair-account-start',requestId,year:status.enrollment.year,mode:accountMode,profile:accountMode==='guest'?structuredClone(profile):undefined},location.origin);
  // Older installed extensions do not support automatic collection yet.
  setTimeout(()=>{if(accountRequest===requestId&&$('#account-status').textContent==='Opening Medicare…'){
   $('#account-status').textContent='Update the extension using the desktop app, then try again.';$('#account-start').disabled=false;
  }},8000);
 }catch(error){if(accountRequest===requestId){$('#account-status').textContent=error.message;$('#account-start').disabled=false;}}
});
function renderAccountSummary(){
 const confirmed=$('#account-confirm').checked,summary=$('#account-summary');$('#account-plans').hidden=!confirmed;
 $('#account-confirm').closest('label').querySelector('span').textContent=confirmed?'Search confirmed':'These Medicare results use my correct location, drugs, quantities, help with costs, and pharmacies.';
 summary.replaceChildren();
 if(!confirmed||!accountResult){summary.append(node('h2','','Confirm your Medicare search'));return;}
 const {plans,types}=accountResult,winner=plans[0],tied=plans.filter(q=>q.annual_total===winner.annual_total).length;
 summary.append(node('h2','',tied>1?`${tied} plans share the lowest drug + premium estimate`:'Lowest drug + premium estimate'),node('strong','account-best',`${money(winner.annual_total)}/year`));
 if(tied===1)summary.append(node('p','',winner.name),node('p','hint',`${money(winner.monthly_premium*12)} premiums + ${money(winner.annual_drugs)} drugs per year`));
 if(types.has('Medicare Advantage'))summary.append(node('p','hint','Check doctors and medical benefits before choosing.'));
}
$('#account-confirm').addEventListener('change',renderAccountSummary);
window.addEventListener('message',async event=>{
 if(event.source!==window||event.origin!==location.origin||!accountRequest||event.data?.requestId!==accountRequest)return;
 const message=event.data;
 if(message.type==='medicarecorsair-guest-prompt'){
  $('#account-status').textContent=message.title;$('#account-start').hidden=true;
  const area=$('#guest-prompt');area.replaceChildren();
  const answer=(choice,query)=>{
   window.postMessage({type:'medicarecorsair-guest-answer',requestId:accountRequest,choice,query},location.origin);
   area.replaceChildren();$('#account-start').hidden=false;$('#account-status').textContent='Continuing in Medicare…';
  };
  const grid=node('div','guest-choices');const selected=new Set();
  let submit;
  if(message.search){
   const form=node('form','search-control'),isProvider=/doctor/i.test(message.title),input=node('input');input.type='search';input.placeholder=isProvider?'Last name':'Pharmacy name';input.setAttribute('aria-label',isProvider?'Doctor last name':'Search pharmacy locations');input.autocomplete='off';input.maxLength=isProvider?70:200;input.required=!isProvider;input.value=isProvider?promptSearchState.last:promptSearchState.pharmacy;
   let first;
   if(isProvider){first=node('input');first.type='text';first.placeholder='First name';first.setAttribute('aria-label','Doctor first name');first.maxLength=70;first.autocomplete='off';first.value=promptSearchState.first;form.append(first);}
   const search=node('button','','Search');search.type='submit';form.append(input,search);form.addEventListener('submit',event=>{event.preventDefault();input.setCustomValidity(isProvider&&!input.value.trim()&&!first.value.trim()?'Enter a first or last name.':'');if(form.reportValidity()){if(isProvider){promptSearchState.first=first.value.trim();promptSearchState.last=input.value.trim();}else promptSearchState.pharmacy=input.value.trim();answer('__search',isProvider?JSON.stringify({first:promptSearchState.first,last:promptSearchState.last}):promptSearchState.pharmacy);}});area.append(form);
  }
  for(const choice of message.choices){
   if(choice.id==='__search')continue;
   if(message.multiple){
    const label=node('label','guest-choice checkbox'),box=node('input');box.type='checkbox';box.addEventListener('change',()=>{
     if(box.checked&&selected.size>=5){box.checked=false;return toast('Choose up to 5 pharmacies.');}
     if(box.checked)selected.add(choice.id);else selected.delete(choice.id);submit.disabled=!selected.size;
    });label.append(box,node('span','',choice.label));grid.append(label);
   }else{const button=node('button','coverage-choice',choice.label);button.type='button';button.addEventListener('click',()=>answer(choice.id));grid.append(button);}
  }
  area.append(grid);
  if(message.multiple){submit=node('button','button primary','Use selected pharmacies');submit.type='button';submit.disabled=true;submit.addEventListener('click',()=>answer([...selected]));area.append(submit);}
  return;
 }
 if(message.type==='medicarecorsair-account-status'){$('#account-status').textContent=message.text;$('#account-start').disabled=false;if(message.failed){$('#guest-prompt').replaceChildren();$('#account-start').hidden=false;$('#account-open').hidden=false;}return;}
 if(message.type!=='medicarecorsair-account-capture'||!Array.isArray(message.capture?.documents))return;
 const requestId=accountRequest;$('#account-status').textContent='Reading your Medicare prices…';
 try{
  const result=await api('/api/import-quotes',{documents:message.capture.documents});if(accountRequest!==requestId)return;
  const plans=[...result.quotes].sort((a,b)=>a.annual_total-b.annual_total||a.id.localeCompare(b.id));
  const types=new Set(plans.map(q=>q.id.startsWith('S')?'Part D':'Medicare Advantage'));
  if(types.size!==1)throw new Error('Choose one plan type in Medicare, then collect again.');
  $('#guest-prompt').replaceChildren();$('#account-start').hidden=false;$('#account-title').textContent='Your Medicare prices';$('#account-start').textContent='Refresh Medicare prices';
  $('#account-open').hidden=false;
  $('#account-status').textContent=`${plans.length} ${[...types][0]} plans · ${result.year} coverage`;
  $('#account-warnings').textContent=result.warnings.join(' ');
  accountResult={plans,types};$('#account-note').textContent=`Medicare.gov estimates · checked ${new Date(message.capture.captured_at||result.captured_at).toLocaleDateString()}`;
  const list=$('#account-plans');list.replaceChildren();list.hidden=true;$('#account-confirm').checked=false;
  plans.forEach(q=>{
   const card=node('article','plan');card.append(node('h3','',q.name),node('p','plan-id',q.id),node('strong','',`${money(q.annual_total)}/year · drugs + premiums`),node('p','hint',`${money(q.monthly_premium)}/month premium`));
   if(!q.id.startsWith('S')){card.append(node('p','hint',`In-network medical limit: ${Number.isFinite(q.medical_max)?money(q.medical_max):'Check plan'}`));if(q.primary_copay||q.specialist_copay)card.append(node('p','hint',`Primary doctor: ${q.primary_copay||'Check plan'} · Specialist: ${q.specialist_copay||'Check plan'}`));}
   list.append(card);
  });
  renderAccountSummary();$('#account-results').hidden=false;$('#account-confirm').focus();
 }catch(error){if(accountRequest===requestId)$('#account-status').textContent=error.message;}
 finally{if(accountRequest===requestId)$('#account-start').disabled=false;}
});
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin||event.data?.type!=='medicarecorsair-capture')return;
 const capture=event.data.capture;if(!capture||!Array.isArray(capture.documents))return;
 if(!supportedCoverage()||!profile.state||!profile.medications.length){queuedCapture=capture;toast('Your Medicare results arrived. Finish your setup and medication list to review them.');return;}
 readDocuments({documents:capture.documents});
});
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin||event.data?.type!=='medicarecorsair-extension-ready')return;
 guestAutofillAvailable=!!event.data.capabilities?.includes('guest-autofill');
 $('#install-view').hidden=true;$('#app-flow').hidden=false;
});
function updateInstallChoice(){
 const os=$('#install-os').value, browser=$('#install-browser').value, ready=os&&browser&&browser!=='safari';
 const download=$('#install-download');download.hidden=!ready;$('#download-walkthrough').hidden=!ready;
 $('#mac-chip-help').hidden=!os.startsWith('mac');
 if(!os||!browser){$('#install-guidance').textContent='Choose your computer and browser.';return;}
 if(browser==='safari'){$('#install-guidance').textContent='Safari is not supported. Choose Edge, Chrome, or Firefox.';return;}
 const isMac=os.startsWith('mac'),name={chrome:'Chrome',edge:'Edge',firefox:'Firefox'}[browser];
 download.href=`https://github.com/cristonj/MedicareCorsair/releases/latest/download/${os==='mac-intel'?'MedicareCorsair-macOS-Intel.zip':isMac?'MedicareCorsair-macOS.zip':'MedicareCorsair.exe'}`;
 download.textContent=`Download for ${isMac?'Mac':'Windows'} ↓`;
 $('#install-guidance').textContent=`Download, open the app, then choose ${name}.${browser==='firefox'?' Firefox setup is temporary.':''}`;
}
let downloadGuideVersion=0;
async function renderDownloadCards(){
 updateInstallChoice();const version=++downloadGuideVersion;
 const os=$('#install-os').value,browser=$('#install-browser').value;
 if(!os||!browser||browser==='safari')return;
 try{
  const response=await fetch('/setup-guides.json');if(!response.ok)throw new Error();const guides=await response.json();
  if(version!==downloadGuideVersion)return;
  const cards=os==='windows'?guides[browser].downloadCards:guides.macCards.map((card,index)=>index===2?{...card,image:browser+'-extensions.png'}:card);
  $('#download-cards').replaceChildren(...cards.map(card=>{
   const article=node('article','download-card'),heading=node('h2','',card.title);
   const link=node('a');link.href='/assets/setup/'+card.image;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','Enlarge screenshot: '+card.title);
   const picture=node('img');picture.src=link.href;picture.alt=card.title+' — example browser screenshot';link.append(picture);
   article.append(heading,link,node('p','',card.text));return article;
  }));
 }catch{$('#install-guidance').textContent='Could not load the pictures. Refresh this page and try again.';}
}
$('#install-os').addEventListener('change',renderDownloadCards);$('#install-browser').addEventListener('change',renderDownloadCards);
$('#check-install').addEventListener('click',()=>location.reload());
document.querySelectorAll('input, textarea').forEach(input=>input.setAttribute('autocomplete','off'));
restore();renderMeds();if(profile.coverage)showWorkspace();else showSetup();refreshStatus();setInterval(refreshStatus,30000);
window.postMessage({type:'medicarecorsair-ready'},location.origin);
