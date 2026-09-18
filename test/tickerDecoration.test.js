const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');
test('congratulations have sparkle boundaries for one or many teams, fitting or scrolling',{timeout:30000},async t=>{
 const {app}=createFixtureServer(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});let mode='single';
 await page.route('**/api/leaderboard/current?*',async route=>{const response=await route.fetch(),json=await response.json();if(mode==='single')json.data.group.daily=[{name:'VELVET',value:400000,groupId:'g0',locationId:'loc_hcm'}];await route.fulfill({json})});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');
 const line=page.locator('.ticker-line');
 assert.equal(await line.locator(':scope > span').first().locator('.ticker-separator').count(),2,'one short congratulations is framed on both ends');
 assert.match(await line.locator(':scope > span').first().textContent(),/^\s*✦ ✧ ✦\s+CONGRATULATIONS TO VELVET ON REACHING 400,000 POINTS\s+✦ ✧ ✦\s*$/);
 assert.equal(await line.evaluate(e=>e.getAnimations().length),1,'even a fitting message scrolls');
 for(const size of [{width:390,height:844}]){
  await page.setViewportSize(size);await page.waitForFunction(()=>document.querySelector('.ticker-line').getAnimations().length===1);
  assert.equal(await line.locator(':scope > [aria-hidden="true"]').count(),1,'scroll duplicate is hidden from accessibility tree');
  const first=line.locator(':scope > span').first();assert.equal(await first.locator('.ticker-separator').count(),2);assert.equal((await first.textContent()).includes('·'),false,'no old dot added to scrolling seam');
 }
 mode='multiple';await page.setViewportSize({width:1920,height:1080});await page.reload();await page.waitForSelector('.row');
 const first=line.locator(':scope > span').first();assert.equal(await first.locator('.ticker-separator').count(),6,'five messages share sparkling separators and both outside boundaries');
 assert.equal((await first.textContent()).includes('·'),false);
 assert.equal(await first.locator('.ticker-separator').evaluateAll(es=>es.every(e=>e.getAttribute('aria-hidden')==='true')),true,'ornaments are decorative');
 await page.keyboard.press('7');await page.locator('#language-choice').selectOption('vi');await page.locator('#done-settings').click();assert.match(await line.textContent(),/CHÚC MỪNG/);
});
