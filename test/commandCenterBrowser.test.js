const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');
test('command center: real renderer, responsive settings, defaults and remote controls',{timeout:120000},async t=>{
 const {app,state}=createFixtureServer();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+server.address().port;
 await page.goto(url);await page.waitForSelector('.row');
 assert.equal(await page.locator('.board:visible').count(),5);assert.equal(state.historyRequests,0);
 assert.equal(await page.locator('.board').nth(3).locator('.row').count(),10);assert.equal(await page.locator('.board').nth(4).locator('.row').count(),32);
 assert.equal(await page.locator('.board').nth(1).locator('.points').first().textContent(),'5,270,072');
 assert.equal(await page.locator('.logo img').evaluate(e=>e.naturalWidth),196);
 const brandSize=await page.evaluate(()=>({mark:document.querySelector('.logo').getBoundingClientRect().width,name:parseFloat(getComputedStyle(document.querySelector('.brand-name')).fontSize)}));
 assert.ok(brandSize.mark>=160&&brandSize.name>=68,'header identity should have the enlarged TV-readable size');
 await page.waitForFunction(()=>document.querySelector('.row .avatar img')?.naturalWidth>0);
 fs.mkdirSync('.superpowers',{recursive:true});
 await page.screenshot({path:'.superpowers/command-center-1920.png'});
 for(const [width,height] of [[1920,1080],[1366,768],[1440,900],[1280,720],[2560,1080]]){
  await page.setViewportSize({width,height});
  const geometry=await page.evaluate(()=>({page:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],widths:[...document.querySelectorAll('.board')].filter(e=>!e.hidden).map(e=>e.getBoundingClientRect().width)}));
  assert.deepEqual(geometry.page,[width,height]);assert.ok(Math.max(...geometry.widths)-Math.min(...geometry.widths)<1);
  const brandFits=await page.evaluate(()=>{const region=document.querySelector('.brand').getBoundingClientRect();return [...document.querySelectorAll('.brand .logo,.brand-name,.brand-sub')].every(e=>{const r=e.getBoundingClientRect();return r.left>=region.left-1&&r.right<=region.right+1&&r.top>=region.top-1&&r.bottom<=region.bottom+1})});
  assert.ok(brandFits,'enlarged identity must stay inside the left header at '+width+'x'+height);
  await page.keyboard.press('7');
  for(let i=0;i<6;i++){
   await page.locator('[data-page="'+i+'"]').click();
   const clipped=await page.evaluate(()=>{const box=document.querySelector('.settings-box').getBoundingClientRect();return [...document.querySelectorAll('.settings-page.active button,.settings-page.active input,.settings-page.active select,.settings-actions button,.settings-nav button')].filter(e=>e.getClientRects().length).some(e=>{const r=e.getBoundingClientRect();return r.bottom>box.bottom||r.right>box.right||r.top<box.top})});assert.equal(clipped,false,'Settings clipped at '+width+'x'+height+' pane '+i);
  }
  await page.getByRole('button',{name:'Done',exact:true}).click();
 }
 await page.keyboard.press('6');await page.waitForSelector('.board:nth-child(6) .row');assert.equal(await page.locator('.board:visible').count(),6);assert.equal(state.historyRequests,1);
 assert.equal(await page.locator('.board').nth(5).locator('.points').first().textContent(),'1,234,567');
 await page.keyboard.press('9');assert.equal(await page.locator('.kpi').evaluate(e=>getComputedStyle(e).visibility),'hidden');await page.keyboard.press('9');
 await page.keyboard.press('1');assert.equal(await page.locator('.board').first().locator('.points').first().isVisible(),false);await page.keyboard.press('1');
 await page.reload();await page.waitForSelector('.row');assert.equal(state.historyRequests,1,'complete history uses device cache');
 await page.keyboard.press('7');await page.locator('[data-page="0"]').click();await page.locator('[data-page="0"]').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.equal(await page.locator('[data-score="0"]').isChecked(),false);await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('[data-page="0"]').evaluate(e=>e===document.activeElement),true);
 await page.locator('[data-page="4"]').click();await page.locator('#save-default-page').click();await page.locator('#factory').click();assert.equal(await page.locator('.board:visible').count(),5);
 await page.locator('#restore-default').click();assert.equal(await page.locator('[data-score="0"]').isChecked(),false);
 await page.locator('[data-page="1"]').click();await page.locator('[data-config="resetHour"]').fill('9');await page.locator('[data-config="resetHour"]').press('Enter');assert.equal(await page.locator('[data-config="total"]').isChecked(),true,'input 9 cannot toggle total');
 await page.locator('[data-page="4"]').click();await page.locator('#factory').click();await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.waitForTimeout(100);state.offset=777;
 const old=await page.locator('.board').nth(1).locator('.points').first().textContent();
 await page.locator('.board-head').first().click();await page.locator('.column-refresh').first().click();await page.waitForFunction(()=>!document.querySelector('.board').classList.contains('loading'));
 assert.equal(await page.locator('.board').nth(1).locator('.points').first().textContent(),old,'scoped refresh leaves other columns alone');
 state.fail=true;const kept=await page.locator('.board').first().locator('.points').first().textContent();await page.keyboard.press('8');await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('OFFLINE'));assert.equal(await page.locator('.board').first().locator('.points').first().textContent(),kept);
 state.fail=false;await page.keyboard.press('8');await page.waitForFunction(()=>!document.querySelector('.board').classList.contains('loading'));
 await page.locator('.board-head').first().click();await page.locator('.board-head').first().click();assert.equal(await page.locator('.column-refresh').first().isVisible(),true);await page.waitForTimeout(3400);assert.equal(await page.locator('.column-refresh').first().isVisible(),false);assert.equal(await page.locator('.quick-toolbar').isVisible(),false);
 await page.mouse.move(50,50);await page.waitForTimeout(300);const offsets=await page.locator('#settings-open').evaluate(e=>{const a=e.getBoundingClientRect(),b=e.querySelector('svg').getBoundingClientRect();return[(a.x+a.width/2)-(b.x+b.width/2),(a.y+a.height/2)-(b.y+b.height/2)]});assert.deepEqual(offsets,[0,0]);
 assert.deepEqual(errors,[]);
});

test('settings focus stays modal while editing; history and yesterday labels never invent data',{timeout:60000},async t=>{
 const {app,state}=createFixtureServer();state.historyComplete=false;const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1366,height:768}});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');
 await page.keyboard.press('7');await page.locator('[data-page="1"]').click();await page.locator('[data-page="1"]').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('#settings-dialog').contains(document.activeElement)),true,'Tab must stay inside modal while editing');}
 await page.locator('[data-config="yesterdayGroups"]').check();await page.locator('[data-page="3"]').click();await page.locator('#daily-history').click();assert.equal(await page.locator('.board').first().locator('.yesterday').count(),0,'yesterday mode has no invented zero comparison');
 await page.getByRole('button',{name:'Done',exact:true}).click();await page.keyboard.press('6');await page.waitForSelector('.board:nth-child(6) .row');
 const text=await page.locator('.board').nth(5).innerText();assert.match(text,/20\d{2}-\d{2}/,'month is visible without hover');assert.match(text,/provisional/i,'provisional data is visibly labeled');
 await page.keyboard.press('7');await page.keyboard.press('7');assert.equal(await page.locator('#settings-dialog').isVisible(),false,'7 closes settings outside input edit');
});

test('scoped monthly refresh cannot relabel retained frozen daily rows as live',{timeout:60000},async t=>{
 const {app,state}=createFixtureServer();state.frozen=true;const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');
 assert.match(await page.locator('.board-head b').first().textContent(),/Yesterday/);
 state.frozen=false;await page.locator('.board-head').nth(2).click();await page.locator('.column-refresh').nth(2).click();await page.waitForFunction(()=>!document.querySelectorAll('.board')[2].classList.contains('loading'));
 assert.match(await page.locator('.board-head b').first().textContent(),/Yesterday/);
 assert.doesNotMatch(await page.locator('#data-status').textContent(),/LIVE SCORES/);
});

test('remote edit cancellation and history filtering preserve the chosen settings',{timeout:60000},async t=>{
 const {app,state}=createFixtureServer();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 await page.addInitScript(()=>{localStorage.setItem('helios_design_v10_default_current',JSON.stringify({lastMonth:true}));});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');
 assert.equal(await page.locator('.board:visible').count(),5,'prototype settings never migrate');
 await page.keyboard.press('7');await page.locator('[data-page="1"]').click();await page.locator('[data-page="1"]').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await page.keyboard.press('ArrowUp');await page.keyboard.press('Escape');
 assert.equal(await page.locator('[data-config="resetHour"]').inputValue(),'0');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_v2_current')).resetHour),0,'cancelled input does not persist');
 await page.locator('[data-page="2"]').click();await page.locator('#group-items input').first().uncheck();assert.equal(await page.locator('.board').first().locator('.row .name').first().textContent(),'TEST GROUP 2');
 await page.getByRole('button',{name:'Done',exact:true}).click();await page.keyboard.press('6');await page.waitForSelector('.board:nth-child(6) .row');assert.equal(await page.locator('.board').nth(5).locator('.row').count(),30,'hidden group filters historical idols');
 await page.keyboard.press('7');await page.locator('[data-page="1"]').click();await page.locator('[data-config="speed"]').fill('100');await page.locator('[data-config="speed"]').press('Enter');
 const fast=await page.locator('.board:nth-child(5) .all-track').evaluate(e=>e.getAnimations()[0].effect.getTiming().duration);
 await page.locator('[data-page="4"]').click();await page.locator('#factory').click();const restored=await page.locator('.board:nth-child(5) .all-track').evaluate(e=>e.getAnimations()[0].effect.getTiming().duration);assert.ok(restored>fast,'restoring defaults reapplies motion settings');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 state.empty=true;await page.keyboard.press('8');await page.waitForSelector('.board .empty-state');assert.equal(await page.locator('.board').first().locator('.row').count(),0);
 await page.mouse.move(500,120);await page.mouse.down();await page.waitForTimeout(1300);assert.equal(await page.locator('#settings-dialog').isVisible(),true);await page.mouse.up();
});
