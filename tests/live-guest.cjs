/* Opt-in live integration test. Uses a disposable Chromium profile, fabricated
   prescriptions, and the real public guest UI. Never signs in or enrolls.
   Start the local helper on port 8000 first. No HAR, cookies, or health logs. */
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'build','test-browsers');
const {chromium}=require('playwright');
(async()=>{
 const extension=path.join(root,'extension');
 const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,viewport:{width:1280,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
  context.on('response',response=>{if(response.status()>=400){const u=new URL(response.url());if(u.origin==='https://www.medicare.gov')console.error('Medicare test HTTP:',response.status(),u.pathname);}});
  // Serve the current frontend in the test browser; API requests still reach the
  // real loopback helper. Does not change the user's server or personal browser.
  await context.route('http://127.0.0.1:8000/**',async route=>{
   const url=new URL(route.request().url());if(url.pathname.startsWith('/api/'))return route.continue();
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
   if(!['index.html','app.js','styles.css','favicon.svg','setup-guides.json','privacy.html'].includes(file)&&!file.startsWith('assets/setup/'))return route.abort();
   const target=path.resolve(root,file);if(!target.startsWith(root+path.sep))return route.abort();
   const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
   await route.fulfill({status:200,contentType:type,body:await fs.readFile(target),headers:{'Cache-Control':'no-store'}});
  });
  const page=await context.newPage();page.setDefaultTimeout(45000);
  await page.goto('http://127.0.0.1:8000/');
  await page.locator('#app-flow').waitFor({state:'visible'});
  await page.getByRole('button',{name:'No / not sure',exact:true}).click();
  await page.getByRole('button',{name:/Original Medicare/}).click();
  await page.locator('#setup-assistance').selectOption('none');
  await page.getByRole('button',{name:'Start comparing',exact:true}).click();
  await page.locator('#zip').fill('60601');await page.locator('#pharmacy').fill('CVS');
  await page.locator('#drug-search').fill('atorvastatin');
  await page.locator('.drug-choice').filter({hasText:/^atorvastatin 20 MG Oral TabletGeneric product$/}).click();
  await page.locator('#quantity').fill('30');await page.locator('#days').selectOption('30');
  await page.getByRole('button',{name:'Add medication',exact:true}).click();
  await fs.mkdir(path.join(root,'tmp'),{recursive:true});await page.screenshot({path:path.join(root,'tmp','guest-entry-smoke.png')});
  const entryButton=await page.locator('#compare').boundingBox();assert(entryButton.y+entryButton.height<800,'The primary action must fit in the initial viewport.');
  if(process.argv.includes('--entry-only')){console.log('Entry screen passed: primary action fits without scrolling.');return;}
  await page.locator('#compare').click();
  let pharmacyChosen=false;
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
   const status=await page.locator('#account-status').textContent();
   if(await page.locator('#account-results').isVisible())break;
   if(await page.locator('#guest-prompt').getByText('CVS Pharmacy #04781',{exact:false}).count()){
    await page.locator('#guest-prompt label').filter({hasText:'CVS Pharmacy #04781'}).locator('input').check();
    await page.getByRole('button',{name:'Use selected pharmacies',exact:true}).click();pharmacyChosen=true;
   }
   if(/didn.t finish|No different|did not match|unavailable|needs an update|could not|expired|canceled|refresh MedicareCorsair/i.test(status))throw new Error('Guest test stopped: '+status);
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert(pharmacyChosen,'The exact pharmacy location must be confirmed.');
  assert(await page.locator('#account-results').isVisible(),'No complete comparison returned.');
  await page.locator('#account-confirm').check();
  const cards=await page.locator('#account-plans article').count();assert(cards>1,'Expected multiple real plan estimates.');
  await page.screenshot({path:path.join(root,'tmp','guest-results-smoke.png')});
  console.log(`Live guest integration passed: ${cards} Medicare plans returned; exact pharmacy confirmed; no login or enrollment.`);
 }catch(error){
  const pages=context.pages();for(const [index,page]of pages.entries()){
   console.error(`Test tab ${index}: ${new URL(page.url()).origin}${new URL(page.url()).pathname}`);
   if(page.url().startsWith('http://127.0.0.1:8000/'))console.error('Dashboard status:',await page.locator('#account-status').textContent().catch(()=>''));
   if(page.url().startsWith('https://www.medicare.gov/plan-compare/')){
    console.error('Fabricated Medicare test screen:',(await page.locator('main').innerText().catch(()=>'' )).slice(0,3500));
    await page.screenshot({path:path.join(root,'tmp','guest-live-failure.png')});
   }
  }
  throw error;
 }finally{await context.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
