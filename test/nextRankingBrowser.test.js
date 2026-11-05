const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const{createNextFixture}=require('./support/next-ranking-server');
const fs=require('node:fs'),path=require('node:path');
async function fixture(t,viewport={width:1920,height:1080}){const{app,state}=createNextFixture(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const browser=await chromium.launch({channel:'chrome',headless:true,args:['--proxy-server=direct://','--proxy-bypass-list=*']});const page=await browser.newPage({viewport});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await browser.close();server.closeAllConnections();server.close();assert.deepEqual(errors,[])});await page.goto('http://127.0.0.1:'+server.address().port+'/new');await page.locator('[data-key="monthly-ranking"] .row:not(.skeleton)').first().waitFor({state:'attached'});return{page,state}}
test('new desktop board has one monthly talent column, stacked Today talents/groups, live avatars and warning details',async t=>{
 const{page,state}=await fixture(t);assert.equal(await page.locator('[data-key="monthly-ranking"] .row').count(),23);assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST TODAY/);assert.match(await page.locator('[data-key="side-groups"]').textContent(),/TEST GROUP/);
 assert.equal(await page.locator('[data-key="monthly-ranking"] .avatar.live').count(),23);assert.equal(await page.locator('[data-key="monthly-ranking"] .equalizer i').count(),69);
 // Every screen gets the simple TV-safe mark: ring without outline, solid round dot, no bars.
 assert.deepEqual(await page.locator('[data-key="monthly-ranking"] .avatar.live').first().evaluate(a=>{const dot=getComputedStyle(a.querySelector('.equalizer')),bar=getComputedStyle(a.querySelector('.equalizer i'));return[getComputedStyle(a).outlineStyle,dot.borderRadius,bar.display]}),['none','50%','none']);
 const positions=await page.locator('.monthly-ranking,.side-column').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().left));assert.ok(positions[1]>positions[0]);
 // Sheet problems stay off public TVs; only an admin browser sees them.
 assert.equal(await page.locator('.warning').count(),0);assert.equal(await page.locator('#sheet-status').isHidden(),true);
 state.admin=true;await page.reload();await page.locator('[data-key="monthly-ranking"] .warning').waitFor();
 await page.locator('[data-key="monthly-ranking"] .warning').click();await page.locator('#warning-dialog').waitFor({state:'visible'});assert.match(await page.locator('#warning-details').textContent(),/2,000/);assert.equal(await page.locator('#warning-sheet').getAttribute('href'),'https://docs.google.com/spreadsheets/d/test/edit');
 await page.locator('#warning-dialog button').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('Last Month replaces Today, hiding Today expands monthly, preferences persist without touching old settings',async t=>{
 const{page}=await fixture(t);await page.locator('#quick-lastmonth').click();assert.equal(await page.locator('#side-column').isVisible(),false);await page.locator('#quick-lastmonth').click();await page.locator('[data-key="side-talents"]').getByText('TEST PRIOR TALENT',{exact:true}).waitFor();assert.match(await page.locator('[data-key="side-groups"]').textContent(),/TEST PRIOR GROUP/);assert.equal(await page.locator('#side-column .avatar.live').count(),0);assert.equal(await page.locator('#side-column').count(),1);
 await page.locator('#quick-lastmonth').click();assert.match(await page.locator('[data-key="side-talents"]').textContent(),/TEST TODAY/);await page.keyboard.press('6');assert.equal(await page.locator('#side-column').isVisible(),false);
 await page.reload();await page.locator('[data-key="monthly-ranking"] .row:not(.skeleton)').first().waitFor();assert.equal(await page.locator('#side-column').isVisible(),false);assert.equal(await page.evaluate(()=>localStorage.getItem('helios_leaderboard_v2_current')),null);
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
 await page.locator('#factory').click();saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')));assert.equal(saved.layout,'podium');assert.equal(saved.resetHour,6);assert.equal(saved.freezeUntil,'14:00');assert.equal(saved.showDaily,true);
 await page.locator('[data-page="0"]').click();await page.locator('#layout-choice').click();await page.locator('.tv-picker button',{hasText:'Classic'}).click();assert.equal(await page.locator('.tv').getAttribute('data-layout'),'classic');await page.locator('#done-settings').click();
 await page.reload();await page.locator('[data-column="4"] .row:not(.skeleton)').first().waitFor();assert.equal(await page.locator('.tv').getAttribute('data-layout'),'classic');
});
test('old preferences migrate without overwriting original settings, and hold-to-open is preserved',async t=>{
 const{page}=await fixture(t);const legacy={language:'vi',layout:'classic',resetHour:0,freezeUntil:'09:00',pause:5,tickerSpeed:120,celebrationSound:false,scores:[false,true,true,true,true],locations:{loc_hcm:true}};
 await page.evaluate(value=>{localStorage.removeItem('helios_leaderboard_next_current');localStorage.setItem('helios_leaderboard_v2_current',JSON.stringify(value))},legacy);await page.reload();await page.locator('[data-column="4"] .row:not(.skeleton)').first().waitFor();
 const migrated=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')));assert.equal(migrated.layout,'podium');assert.equal(migrated.pause,5);assert.equal(migrated.tickerSpeed,120);assert.equal(migrated.celebrationSound,false);assert.equal(migrated.resetHour,6);assert.equal(migrated.freezeUntil,'14:00');
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_v2_current'))),legacy);
 await page.mouse.move(40,20);await page.mouse.down();await page.locator('#settings-dialog').waitFor({state:'visible'});await page.mouse.up();await page.keyboard.press('7');assert.equal(await page.locator('#settings-dialog').isVisible(),false);
});
test('TVs follow an admin broadcast at once and keep it as their default; admin controls stay hidden on TVs',async t=>{
 const{page,state}=await fixture(t);assert.equal(await page.locator('#broadcast-box').isHidden(),true);assert.equal(await page.locator('#group-reset').isHidden(),true);
 const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')));
 state.settings={version:3,config:{...current,layout:'classic',scores:[false,false,false,false,false]},groupResetHours:{g:18},updatedAt:new Date().toISOString(),updatedBy:'admin@example.test'};state.broadcast();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')).layout==='classic');
 const stored=await page.evaluate(()=>({def:JSON.parse(localStorage.getItem('helios_leaderboard_next_default')),version:localStorage.getItem('helios_leaderboard_next_broadcast'),layout:document.querySelector('.tv').dataset.layout}));
 assert.equal(stored.def.layout,'classic');assert.deepEqual(stored.def.scores,[false,false,false,false,false]);assert.equal(stored.version,'3');assert.equal(stored.layout,'classic');
 // A local change afterwards is kept until the next broadcast.
 await page.keyboard.press('1');await page.reload();await page.locator('[data-key="monthly-ranking"] .row:not(.skeleton)').first().waitFor({state:'attached'});
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')).scores[0]),true);
});
test('a TV adopts settings pushed to it; an admin browser keeps its own on broadcast and push',async t=>{
 const{page,state}=await fixture(t);const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')));
 state.push({version:Date.now(),config:{...current,layout:'studio'},updatedAt:new Date().toISOString(),updatedBy:'admin@example.test'});
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')).layout==='studio');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_default')).layout),'studio');
 state.admin=true;await page.reload();await page.locator('[data-key="monthly-ranking"] .row:not(.skeleton)').first().waitFor({state:'attached'});
 state.settings={...state.settings,version:5,config:{...current,layout:'classic'}};state.broadcast();state.push({version:Date.now()+1,config:{...current,layout:'classic'}});
 await page.waitForFunction(()=>localStorage.getItem('helios_leaderboard_next_broadcast')==='5');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_next_current')).layout),'studio');
});
test('admin edits group reset exceptions and saves settings for all TVs',async t=>{
 const{page,state}=await fixture(t);state.admin=true;state.settings={...state.settings,groupResetHours:{g:18}};await page.reload();await page.locator('[data-key="monthly-ranking"] .row:not(.skeleton)').first().waitFor({state:'attached'});
 await page.keyboard.press('7');await page.locator('[data-page="1"]').click();await page.locator('#group-reset .group-reset-row').first().waitFor();
 const hour=page.locator('#group-reset .group-reset-row input');await hour.fill('17');await hour.press('Tab');
 await page.locator('#shared-hold').fill('22:30');await page.locator('#shared-hold').press('Tab');
 await page.locator('[data-page="4"]').click();await page.locator('#broadcast-settings').click();
 await page.waitForFunction(()=>/1/.test(document.getElementById('broadcast-status').textContent));
 assert.equal(state.settings.version,1);assert.deepEqual(state.settings.groupResetHours,{g:17});assert.equal(state.settings.holdUntil,'22:30');assert.equal(state.settings.config.layout,'podium');
 assert.equal(await page.evaluate(()=>localStorage.getItem('helios_leaderboard_next_broadcast')),'1');
});
test('ticker congratulates groups then idols from 100K, skipping hidden idols',async t=>{
 const{page}=await fixture(t);
 const text=await page.evaluate(()=>{const saved=rawData,loc=allLocations[0].id;rawData={...saved,group:{...saved.group,daily:[{name:'TEST BIG GROUP',groupId:'gx',locationId:loc,value:160000},{name:'TEST SMALL GROUP',groupId:'gy',locationId:loc,value:99999}]},individual:{...saved.individual,daily:[{name:'TEST BIG IDOL',locationId:loc,value:120000},{name:'TEST HIDDEN IDOL',locationId:loc,value:300000},{name:'TEST SMALL IDOL',locationId:loc,value:99000}]}};config.talents['TEST HIDDEN IDOL']=false;const out=buildTicker();rawData=saved;delete config.talents['TEST HIDDEN IDOL'];return out});
 assert.ok(text.indexOf('TEST BIG GROUP')>=0&&text.indexOf('TEST BIG GROUP')<text.indexOf('TEST BIG IDOL'));assert.match(text,/100[.,]000/);
 for(const name of ['TEST SMALL GROUP','TEST HIDDEN IDOL','TEST SMALL IDOL'])assert.ok(!text.includes(name),name);
});
test('a slow first load shows placeholder rows, and a reload shows this device last scores at once as cached',async t=>{
 const{page,state}=await fixture(t);await page.waitForTimeout(100);
 assert.ok(await page.evaluate(()=>localStorage.getItem('helios_leaderboard_next_live')),'scores are kept on the device');
 state.delay=4000;await page.reload();const monthly=page.locator('[data-key="monthly-ranking"]');
 await monthly.locator('.row:not(.skeleton)').first().waitFor({timeout:2000});assert.equal(await page.locator('.row.skeleton').count(),0);
 assert.match(await page.locator('#connection').textContent(),/cached|bộ nhớ|đệm/i);
 await page.evaluate(()=>localStorage.removeItem('helios_leaderboard_next_live'));await page.reload();
 await monthly.locator('.row.skeleton').first().waitFor({timeout:2000});assert.equal(await monthly.locator('.row:not(.skeleton)').count(),0);assert.equal(await monthly.locator('.list').getAttribute('aria-busy'),'');
 await monthly.locator('.row:not(.skeleton)').first().waitFor({timeout:8000});assert.equal(await page.locator('.row.skeleton').count(),0);
 await page.evaluate(()=>localStorage.setItem('helios_leaderboard_next_live',JSON.stringify({...JSON.parse(localStorage.getItem('helios_leaderboard_next_live')),savedAt:Date.now()-13*3600000})));
 await page.reload();await monthly.locator('.row.skeleton').first().waitFor({timeout:2000});
});
test('auto-hide hides group points from day 15 and a manual flip lasts 5 minutes',async t=>{
 const{page}=await fixture(t);const start=new Date('2026-11-20T03:00:00Z').getTime();await page.clock.setFixedTime(start);await page.reload();await page.locator('[data-key="monthly-ranking"] .row:not(.skeleton)').first().waitFor({state:'attached'});
 const hidden=async i=>/hide-points/.test(await page.locator('[data-column="'+i+'"]').getAttribute('class'));
 await page.keyboard.press('7');await page.locator('[data-auto-hide="group"]').check();await page.locator('#done-settings').click();
 assert.deepEqual([await hidden(0),await hidden(1),await hidden(2),await hidden(3)],[true,false,true,false]);
 await page.keyboard.press('1');assert.equal(await hidden(0),false);assert.equal(await hidden(2),true);
 await page.clock.setFixedTime(start+6*60000);await page.waitForFunction(()=>document.querySelector('[data-column="0"]').classList.contains('hide-points'));
});
