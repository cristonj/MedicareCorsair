'use strict';
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const storageKey = 'medicarecorsair-profile-v2';
const profile = { state: '', medications: [] };
let currentStatus = null, comparison = null, chosen = null, quotes = {}, compareVersion = 0, searchVersion = 0, sourceIdentity = null;
let pendingSavedState = '';
let pendingImport = null;
const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
const external = (text, url, className = '') => { const el = node('a', className, text); el.href = url; el.target = '_blank'; el.rel = 'noopener noreferrer'; return el; };
async function api(path, body) {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let result;
  try { result = await response.json(); } catch { throw new Error('Start the app with python server.py to connect its data service.'); }
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function fingerprint() { return JSON.stringify([currentStatus?.enrollment.year, currentStatus?.source?.url, currentStatus?.source?.modified, profile.state, profile.medications.map(m => [m.rxcui, m.quantity, m.days]).sort()]); }
function save() {
  try { if ($('#remember').checked) localStorage.setItem(storageKey, JSON.stringify({ profile, quotes })); else localStorage.removeItem(storageKey); }
  catch { toast('Browser storage is unavailable. Your entries will stay here until you close or reload the page.'); }
}
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.profile && typeof saved.profile.state === 'string' && Array.isArray(saved.profile.medications)) {
      profile.medications = saved.profile.medications.filter(m => /^\d{1,10}$/.test(m.rxcui) && typeof m.name === 'string' && Number.isFinite(m.quantity) && m.quantity > 0 && [30,60,90].includes(m.days)).slice(0,30);
      pendingSavedState = saved.profile.state; quotes = saved.quotes && typeof saved.quotes === 'object' ? saved.quotes : {}; $('#remember').checked = true;
    }
  } catch { /* Invalid saved data never stops the app. */ }
}
function updateButton() { $('#compare').disabled = !profile.state || !currentStatus?.source || currentStatus.source.year !== currentStatus.enrollment.year; }
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
    $('#import-finder-link').href = $('#finder-source').href;
    if (previousYear && previousYear !== status.enrollment.year) { comparison = null; quotes = {}; $('#comparison').hidden = true; $('#results-empty').hidden = false; save(); toast('The enrollment year changed. Refreshing your plans and clearing older estimates.'); }
    if (sourceIdentity !== identity || $('#state').disabled) {
      const hadSource = sourceIdentity !== null; sourceIdentity = identity; await loadStates();
      if (status.source && profile.state && (hadSource || profile.medications.length)) await runComparison();
    }
    updateButton();
  } catch (error) { $('#sync-summary').textContent = 'Data service unavailable'; $('#sync-title').textContent = 'Data service unavailable'; $('#sync-description').textContent = error.message; $('#refresh').disabled = false; }
}
$('#state').addEventListener('change', () => { profile.state = $('#state').value; updateButton(); changed(); });
$('#search-form').addEventListener('submit', async event => {
  event.preventDefault(); const version = ++searchVersion; $('#drug-results').replaceChildren(); $('#add-form').hidden = true; chosen = null;
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
$('#add-form').addEventListener('submit', event => {
  event.preventDefault(); if (!chosen) return;
  if (profile.medications.length >= 30) return toast('You can compare up to 30 medications.');
  if (profile.medications.some(m => m.rxcui === chosen.rxcui)) return toast('That exact medication is already in your list. Remove it first to change the quantity.');
  profile.medications.push({ ...chosen, quantity: Number($('#quantity').value), days: Number($('#days').value) });
  chosen = null; $('#add-form').hidden = true; $('#drug-search').value = ''; $('#search-message').textContent = ''; renderMeds(); changed();
});
$('#remember').addEventListener('change', save);
$('#compare').addEventListener('click', runComparison);
async function runComparison() {
  if (!profile.state || !currentStatus?.source) return;
  const version = ++compareVersion; $('#profile-message').textContent = 'Checking your medications against CMS drug lists…';
  try {
    const response = await api('/api/compare', profile);
    if (version !== compareVersion) return;
    const firstRender = !comparison;
    comparison = response; $('#comparison').hidden = false; $('#results-empty').hidden = true;
    if (firstRender && response.plans.some(p => currentQuote(p.id))) $('#sort').value = 'quote';
    $('#profile-message').textContent = ''; renderPlans();
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
  if (profile.medications.length) title.append(node('span', `match-badge${allListed ? '' : ' partial'}`, `${plan.listed_count}/${profile.medications.length} medications listed`));
  price.append(node('strong', '', money(monthly)), node('small', '', 'monthly plan premium')); head.append(title, price); card.append(head);
  const metrics = node('div', 'plan-metrics');
  [['Annual premium', money(annualPremium)], ['Drug deductible', money(plan.deductible)], [quote ? quote.kind === 'import' ? 'Imported annual total' : 'Total with entered estimate' : 'Annual total', quote ? money(quotedTotal(plan)) : 'Needs drug prices']].forEach(([label, value], i) => { const cell = node('div'); cell.append(node('span', '', label), node('strong', i === 2 && !quote ? 'unknown' : '', value)); metrics.append(cell); }); card.append(metrics);
  if (quote?.kind === 'import') card.append(node('p', 'hint quote-source', `Medicare printout · reviewed ${new Date(quote.date).toLocaleDateString()}`));
  const detail = node('details'), summary = node('summary', '', 'View coverage & costs'); detail.append(summary);
  detail.append(node('p', 'hint', plan.provider));
  if (!plan.medications.length) detail.append(node('p', 'hint', 'Add your medications to check coverage and cost-sharing rules automatically.'));
  plan.medications.forEach(m => detail.append(medDetails(m)));
  const manual = node('div', 'manual-step'), heading = node('h4', '', 'Annual drug cost'); manual.append(heading);
  manual.append(external(`Open Medicare Plan Finder for ${comparison.year} ↗`, plan.finder_url));
  manual.append(node('p', '', `Search for ${plan.id.slice(0,9)}. Use this medication list, the same quantities, and your pharmacy. Verify the pharmacy network. Enter only the estimated annual drug out-of-pocket cost below; the premium is already included above.`));
  const label = node('label', '', 'Estimated annual drug cost ($)'); label.htmlFor = `quote-${plan.id}`; manual.append(label);
  const controls = node('form', 'quote-controls'), input = node('input'); input.type = 'number'; input.id = label.htmlFor; input.min = '0'; input.max = '1000000'; input.step = '.01'; input.required = true; input.placeholder = 'Drug costs only'; if (quote) input.value = quote.drugCost;
  const add = node('button', 'button secondary', 'Save estimate'); add.type = 'submit'; controls.append(input, add);
  controls.addEventListener('submit', e => { e.preventDefault(); if (!controls.reportValidity()) return; quotes[plan.id] = { drugCost: Number(input.value), fingerprint: fingerprint(), date: new Date().toISOString() }; save(); renderPlans(); toast('Estimate saved for this medication list and coverage year.'); }); manual.append(controls);
  if (quote) {
    manual.append(node('p', 'quote-date', `${quote.kind === 'import' ? 'Imported and reviewed' : 'Entered'} ${new Date(quote.date).toLocaleDateString()}. Not independently verified. Excludes income surcharges, penalties, and other medical costs.`));
    const remove = node('button', 'plain', 'Remove estimate'); remove.addEventListener('click', () => { delete quotes[plan.id]; save(); renderPlans(); }); manual.append(remove);
  }
  detail.append(manual); card.append(detail); return card;
}
function renderPlans() {
  if (!comparison) return;
  let plans = [...comparison.plans]; const mode = $('#sort').value;
  if ($('#covered-only').checked) plans = plans.filter(p => p.listed_count === profile.medications.length);
  if (mode === 'premium') plans.sort((a,b) => a.premium - b.premium);
  if (mode === 'quote') plans.sort((a,b) => quotedTotal(a) - quotedTotal(b));
  $('#ranking-note').textContent = mode === 'quote' ? 'Annual drug + premium estimates. Missing estimates appear last.' : mode === 'premium' ? 'Premium only; annual drug costs are not included.' : 'Plans listing your medications first, then lowest premium. Check restrictions in plan details.';
  $('#result-count').textContent = `${plans.length} plans shown`; $('#plan-list').replaceChildren(...plans.map(planCard)); $('#no-matches').hidden = !!plans.length;
  const all = comparison.plans.filter(p => profile.medications.length && p.listed_count === profile.medications.length).length;
  $('#summary').textContent = `${comparison.plans.length} plans in ${profile.state}${profile.medications.length ? ' · ' + all + ' list all your medications' : ''}`;
  renderDecision();
}
function renderDecision() {
  const box = $('#decision'); box.replaceChildren();
  const complete = comparison.plans.filter(p => currentQuote(p.id));
  if (complete.length) {
    complete.sort((a,b) => quotedTotal(a) - quotedTotal(b));
    const winner = complete[0], quote = currentQuote(winner.id), total = quotedTotal(winner), premium = (quote.monthlyPremium ?? winner.premium) * 12;
    box.append(node('h3', '', quote.kind === 'import' ? 'Lowest annual estimate in your import' : 'Lowest entered annual estimate'), node('strong', '', `${winner.name} · ${money(total)}/year`), node('p', '', `${money(premium)} in premiums + ${money(quote.drugCost)} in estimated drug costs.${complete[1] ? ' ' + money(quotedTotal(complete[1]) - total) + ' less than the next estimate.' : ''}${comparison.plans.length > complete.length ? ' ' + (comparison.plans.length - complete.length) + ' plans still need estimates.' : ''}`));
    if (quote.kind === 'import') box.append(node('p', '', `For ${quote.pharmacies}. Confirm coverage restrictions before choosing.`));
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
  compareVersion++; searchVersion++; profile.state = ''; profile.medications = []; quotes = {}; comparison = null; chosen = null; pendingSavedState = ''; $('#remember').checked = false; save(); $('#state').value = ''; $('#comparison').hidden = true; $('#results-empty').hidden = false; $('#add-form').hidden = true; $('#drug-results').replaceChildren(); $('#drug-search').value = ''; $('#search-message').textContent = ''; $('#profile-message').textContent = ''; renderMeds(); toast('Your information has been cleared.');
});
$('#print').addEventListener('click', () => window.print());
$('#export').addEventListener('click', () => {
  const lines = ['MedicareCorsair · Part D comparison checklist', `Coverage year: ${currentStatus?.enrollment.year || 'Pending'}`, `State: ${profile.state || 'Not selected'}`, '', 'MEDICATIONS (confirm exact strength, form, quantity and days supply)', ...profile.medications.map(m => `${m.name} | RxCUI ${m.rxcui} | ${m.quantity} units / ${m.days} days`), '', 'VERIFY IN MEDICARE PLAN FINDER', `https://www.medicare.gov/plan-compare/?year=${currentStatus?.enrollment.year || ''}&lang=en`, 'Check exact pharmacy network status, all drugs, prior authorization, step therapy and quantity limits.', 'Use annual drug costs plus annual premiums. Do not add the deductible twice.', '', ...(comparison?.plans || []).map(p => `${p.name} (${p.id}) | Premium ${money(p.premium)}/month | Deductible ${money(p.deductible)} | ${p.listed_count}/${profile.medications.length} medications listed${currentQuote(p.id) ? ' | Entered total ' + money(p.annual_premium + currentQuote(p.id).drugCost) : ' | Annual total unknown'}`), '', `CMS source: ${comparison?.source.url || currentStatus?.source?.url || 'Not loaded'}`, '', 'Enrollment eligibility and final coverage must be verified. Free counseling: https://www.shiphelp.org/'];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), link = node('a'); link.href = url; link.download = 'MedicareCorsair-checklist.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#sync-summary').addEventListener('click', () => { $('#sources').open = true; });
$('#open-import').addEventListener('click', () => {
  if (!comparison || !profile.medications.length) return toast('Choose your state and add the medications used in Medicare Plan Finder first.');
  $('#import-dialog').showModal();
});
$('#close-import').addEventListener('click', () => $('#import-dialog').close());
$('#import-load').addEventListener('submit', async e => {
  e.preventDefault(); pendingImport = null; $('#import-review').hidden = true; $('#read-import').disabled = true;
  $('#import-message').textContent = 'Reading locally. Image PDFs use OCR and may take a minute…';
  const context = fingerprint();
  try {
    const file = $('#import-file').files[0]; let payload;
    if (file) {
      if (file.size > 8 * 1024 * 1024) throw new Error('Choose a file smaller than 8 MB.');
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const encoded = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
        payload = { pdf: encoded };
      } else payload = { text: await file.text() };
    } else payload = { text: $('#import-text').value };
    const result = await api('/api/import-quotes', payload);
    if (context !== fingerprint()) throw new Error('Your comparison changed while reading the file. Please import again.');
    const ids = new Set(comparison.plans.map(p => p.id));
    result.quotes = result.quotes.filter(q => ids.has(q.id));
    if (!result.quotes.length) throw new Error('No imported plans match your selected state. Check your location.');
    pendingImport = { ...result, fingerprint: context };
    const table = $('#import-table'); table.replaceChildren(); const head = node('tr');
    ['Plan','Monthly premium','Annual drug + premium'].forEach(label => { const th=node('th','',label); th.scope='col'; head.append(th); }); table.append(head);
    result.quotes.forEach(q => { const row=node('tr'); [q.name,money(q.monthly_premium),money(q.annual_total)].forEach(v=>row.append(node('td','',v))); table.append(row); });
    $('#import-message').textContent = `${result.quotes.length} plans read for ${result.year}.${result.ocr ? ' OCR was used—review the numbers carefully.' : ''}`;
    $('#import-warnings').textContent = result.warnings.join(' '); $('#confirm-import').checked=false; $('#import-review').hidden=false;
  } catch(error) { $('#import-message').textContent=error.message; }
  finally { $('#read-import').disabled=false; }
});
$('#import-review').addEventListener('submit', e => {
  e.preventDefault(); if (!pendingImport || !$('#import-review').reportValidity()) return;
  if (pendingImport.fingerprint !== fingerprint()) { $('#import-message').textContent='Your comparison changed. Read the file again before using these results.'; return; }
  const pharmacies=$('#import-context').value.trim(); if(!pharmacies) return;
  pendingImport.quotes.forEach(q => { quotes[q.id]={kind:'import',drugCost:q.annual_drugs,annualTotal:q.annual_total,monthlyPremium:q.monthly_premium,pharmacies,date:pendingImport.captured_at,fingerprint:fingerprint()}; });
  save(); $('#sort').value='quote'; renderPlans(); $('#import-dialog').close(); toast(`${pendingImport.quotes.length} annual estimates imported.`);
});
restore(); renderMeds(); refreshStatus(); setInterval(refreshStatus, 30000);
