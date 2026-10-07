const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const{createNextFixture}=require('./support/next-ranking-server');
const fs=require('node:fs'),path=require('node:path');
async function fixture(t,viewport={width:1920,height:1080}){const{app,state}=createNextFixture(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const browser=await chromium.launch({channel:'chrome',headless:true,args:['--proxy-server=direct://','--proxy-bypass-list=*']});const page=await browser.newPage({viewport});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await browser.close();server.closeAllConnections();server.close();assert.deepEqual(errors,[])});await page.goto('http://127.0.0.1:'+server.address().port+'/new');await page.locator('[data-key="monthly-ranking"] .row').first().waitFor({state:'attached'});return{page,state}}
test('new desktop board has one monthly talent column, stacked Today talents/groups, live avatars and warning details',async t=>{
 const{page}=await fixture(t);assert.equal(await page.locator('[data-key="monthly-ranking"] .row').count(),23);assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST TODAY/);assert.match(await page.locator('[data-key="side-groups"]').textContent(),/TEST GROUP/);
 assert.equal(await page.locator('[data-key="monthly-ranking"] .avatar.live').count(),23);assert.equal(await page.locator('[data-key="monthly-ranking"] .equalizer i').count(),69);
 const positions=await page.locator('.monthly-ranking,.side-column').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().left));assert.ok(positions[1]>positions[0]);
 await page.locator('[data-key="monthly-ranking"] .warning').click();await page.locator('#warning-dialog').waitFor({state:'visible'});assert.match(await page.locator('#warning-details').textContent(),/2,000/);assert.equal(await page.locator('#warning-sheet').getAttribute('href'),'https://docs.google.com/spreadsheets/d/test/edit');
 await page.locator('#warning-dialog button').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('Last Month replaces Today, hiding Today expands monthly, preferences persist without touching old settings',async t=>{
 const{page}=await fixture(t);await page.locator('#quick-lastmonth').click();assert.equal(await page.locator('#side-column').isVisible(),false);await page.locator('#quick-lastmonth').click();await page.locator('[data-key="side-talents"]').getByText('TEST PRIOR TALENT',{exact:true}).waitFor();assert.match(await page.locator('[data-key="side-groups"]').textContent(),/TEST PRIOR GROUP/);assert.equal(await page.locator('#side-column .avatar.live').count(),0);assert.equal(await page.locator('#side-column').count(),1);
 await page.locator('#quick-lastmonth').click();assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST TODAY/);await page.keyboard.press('6');assert.equal(await page.locator('#side-column').isVisible(),false);
 await page.reload();await page.locator('[data-key="monthly-ranking"] .row').first().waitFor();assert.equal(await page.locator('#side-column').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('helios_leaderboard_v2_current')),null);
 await page.locator('#quick-lastmonth').click();await page.locator('[data-key="side-talents"]').getByText('TEST PRIOR TALENT',{exact:true}).waitFor();assert.equal(await page.locator('#side-column').isVisible(),true);
});
test('mobile fits screen, tabs show stacked daily, yesterday follows session source and SSE clears live',async t=>{
 const{page,state}=await fixture(t,{width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.mobile-board-tabs button').nth(5).click();assert.equal(await page.locator('#side-column').isVisible(),true);assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST TODAY/);
 await page.keyboard.press('7');await page.locator('[data-page="3"]').click();await page.locator('#daily-history').click();await page.locator('#close-settings').click();assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST YESTERDAY/);
 state.live=false;state.invalidate();await page.waitForFunction(()=>document.querySelectorAll('.avatar.live').length===0);
 await page.keyboard.press('7');await page.locator('[data-page="0"]').click();await page.locator('#language-choice').selectOption('en');await page.locator('#close-settings').click();assert.equal(await page.locator('#settings-open').getAttribute('aria-label'),'Open settings');assert.equal((await page.locator('#settings-open').textContent()).trim(),'');assert.equal(await page.locator('#settings-open svg').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('full original settings, six sections, toolbar SVGs and Podium palette are retained',async t=>{
 const{page}=await fixture(t);
 const original=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 const parity=await page.evaluate(html=>{
  const old=new DOMParser().parseFromString(html,'text/html'),missing=[];
  for(const el of old.querySelectorAll('#settings-dialog input,#settings-dialog select,#settings-dialog button,#settings-dialog a')){
   const selector=el.id?'#'+el.id:el.dataset.config?'[data-config="'+el.dataset.config+'"]':el.dataset.score?'[data-score="'+el.dataset.score+'"]':el.dataset.page?'[data-page="'+el.dataset.page+'"]':null;
   const next=selector&&document.querySelector('#settings-dialog '+selector);if(selector&&(!next||next.tagName!==el.tagName||next.type!==el.type))missing.push(selector);
  }
  return{missing,sections:document.querySelectorAll('.settings-nav button').length,icons:['quick-lastmonth','quick-refresh','settings-open'].map(id=>({same:old.querySelector('#'+id+' svg').outerHTML===document.querySelector('#'+id+' svg').outerHTML,text:document.getElementById(id).textContent.trim()})),layout:document.querySelector('.tv').dataset.layout,background:getComputedStyle(document.querySelector('.tv')).backgroundColor,positions:[0,1,2,3,4].map(i=>{const r=document.querySelector('[data-column="'+i+'"]').getBoundingClientRect();return{x:r.x,y:r.y}})};
 },original);
 assert.deepEqual(parity.missing,[]);assert.equal(parity.sections,6);assert.equal(parity.layout,'podium');assert.equal(parity.background,'rgb(17, 17, 20)');assert.ok(parity.icons.every(i=>i.same&&i.text===''));
 assert.ok(parity.positions[1].x>parity.positions[0].x);assert.ok(parity.positions[2].y>parity.positions[0].y);assert.ok(parity.positions[4].x>parity.positions[1].x);
 await page.keyboard.press('7');assert.equal(await page.locator('#settings-dialog').isVisible(),true);
 for(const i of [1,2,3,4,5]){await page.locator('[data-page="'+i+'"]').click();assert.equal(await page.locator('[data-pane="'+i+'"]').isVisible(),true)}
 await page.locator('#done-settings').click();assert.equal(await page.locator('#settings-dialog').isVisible(),false);
});
test('all timing controls, independent points, sound, saved defaults and original TV editing still work',async t=>{
 const{page,state}=await fixture(t);await page.keyboard.press('7');
 await page.locator('[data-score="0"]').uncheck();assert.match(await page.locator('[data-column="0"]').getAttribute('class'),/hide-points/);assert.doesNotMatch(await page.locator('[data-column="4"]').getAttribute('class'),/hide-points/);
 await page.locator('[data-page="1"]').click();await page.locator('[data-config="pause"]').fill('4');await page.locator('[data-config="pause"]').press('Tab');
 await page.locator('[data-config="tickerSpeed"]').fill('100');await page.locator('[data-config="tickerSpeed"]').press('Tab');await page.locator('[data-config="celebrationSound"]').uncheck();
 await page.locator('[data-config="resetHour"]').fill('7');await page.locator('[data-config="resetHour"]').press('Tab');
 await page.locator('[data-config="freezeUntil"]').fill('09:00');await page.locator('[data-config="freezeUntil"]').press('Tab');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')).freezeUntil==='09:00');assert.ok(state.contexts.some(c=>c.resetHour==='7'&&c.freezeUntil==='09:00'));
 await page.locator('#save-default').click();await page.locator('[data-config="pause"]').fill('1');await page.locator('[data-config="pause"]').press('Tab');await page.locator('[data-page="4"]').click();await page.locator('#restore-default').click();
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')));assert.equal(saved.pause,4);assert.equal(saved.tickerSpeed,100);assert.equal(saved.celebrationSound,false);assert.equal(saved.scores[0],false);
 await page.locator('#factory').click();saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')));assert.equal(saved.layout,'podium');assert.equal(saved.resetHour,6);assert.equal(saved.freezeUntil,'');assert.equal(saved.showDaily,true);
 await page.locator('[data-page="0"]').click();await page.locator('#layout-choice').click();await page.locator('.tv-picker button',{hasText:'Classic'}).click();assert.equal(await page.locator('.tv').getAttribute('data-layout'),'classic');await page.locator('#done-settings').click();
 await page.reload();await page.locator('[data-column="4"] .row').first().waitFor();assert.equal(await page.locator('.tv').getAttribute('data-layout'),'classic');
});
test('old preferences migrate without overwriting original settings, and hold-to-open is preserved',async t=>{
 const{page}=await fixture(t);const legacy={language:'vi',layout:'classic',resetHour:0,freezeUntil:'09:00',pause:5,tickerSpeed:120,celebrationSound:false,scores:[false,true,true,true,true],locations:{loc_hcm:true}};
 await page.evaluate(value=>{localStorage.removeItem('helios_leaderboard_next_current');localStorage.setItem('helios_leaderboard_v2_current',JSON.stringify(value))},legacy);await page.reload();await page.locator('[data-column="4"] .row').first().waitFor();
 const migrated=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')));assert.equal(migrated.layout,'podium');assert.equal(migrated.pause,5);assert.equal(migrated.tickerSpeed,120);assert.equal(migrated.celebrationSound,false);assert.equal(migrated.resetHour,6);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_v2_current'))),legacy);
 await page.mouse.move(40,20);await page.mouse.down();await page.locator('#settings-dialog').waitFor({state:'visible'});await page.mouse.up();await page.keyboard.press('7');assert.equal(await page.locator('#settings-dialog').isVisible(),false);
});
