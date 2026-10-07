const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const{createNextFixture}=require('./support/next-ranking-server');
async function fixture(t,viewport={width:1920,height:1080}){const{app,state}=createNextFixture(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const browser=await chromium.launch({channel:'chrome',headless:true,args:['--proxy-server=direct://','--proxy-bypass-list=*']});const page=await browser.newPage({viewport});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await browser.close();server.closeAllConnections();server.close();assert.deepEqual(errors,[])});await page.goto('http://127.0.0.1:'+server.address().port+'/new');await page.locator('[data-key="monthly-ranking"] .row').first().waitFor();return{page,state}}
test('new desktop board has one monthly talent column, stacked Today talents/groups, live avatars and warning details',async t=>{
 const{page}=await fixture(t);assert.equal(await page.locator('[data-key="monthly-ranking"] .row').count(),23);assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST TODAY/);assert.match(await page.locator('[data-key="side-groups"]').textContent(),/TEST GROUP/);
 assert.equal(await page.locator('[data-key="monthly-ranking"] .avatar.live').count(),23);assert.equal(await page.locator('[data-key="monthly-ranking"] .equalizer i').count(),69);
 const positions=await page.locator('.monthly-ranking,.side-column').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().left));assert.ok(positions[1]>positions[0]);
 await page.locator('[data-key="monthly-ranking"] .warning').click();await page.locator('#warning-dialog').waitFor({state:'visible'});assert.match(await page.locator('#warning-details').textContent(),/2,000/);assert.equal(await page.locator('#warning-sheet').getAttribute('href'),'https://docs.google.com/spreadsheets/d/test/edit');
 await page.locator('#warning-dialog button').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('Last Month replaces Today, hiding Today expands monthly, preferences persist without touching old settings',async t=>{
 const{page}=await fixture(t);await page.locator('#history-toggle').click();await page.getByText('TEST PRIOR TALENT',{exact:true}).waitFor();assert.match(await page.locator('[data-key="side-groups"]').textContent(),/TEST PRIOR GROUP/);assert.equal(await page.locator('#side-column .avatar.live').count(),0);assert.equal(await page.locator('#side-column').count(),1);
 await page.locator('#history-toggle').click();await page.locator('#settings-open').click();await page.locator('#show-daily').uncheck();await page.locator('#close-settings').click();assert.equal(await page.locator('#side-column').isVisible(),false);
 await page.reload();await page.locator('[data-key="monthly-ranking"] .row').first().waitFor();assert.equal(await page.locator('#side-column').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('helios_leaderboard_v2_current')),null);
 await page.locator('#history-toggle').click();await page.getByText('TEST PRIOR TALENT',{exact:true}).waitFor();assert.equal(await page.locator('#side-column').isVisible(),true);
});
test('mobile fits screen, tabs show stacked daily, yesterday follows session source and SSE clears live',async t=>{
 const{page,state}=await fixture(t,{width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#mobile-tabs button').nth(5).click();assert.equal(await page.locator('#side-column').isVisible(),true);assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST TODAY/);
 await page.locator('#period-toggle').click();assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST YESTERDAY/);
 state.live=false;state.invalidate();await page.waitForFunction(()=>document.querySelectorAll('.avatar.live').length===0);
 await page.locator('#settings-open').click();await page.locator('#language').selectOption('en');await page.locator('#close-settings').click();assert.equal(await page.locator('#settings-open').textContent(),'Settings');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
