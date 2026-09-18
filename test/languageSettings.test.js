const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');

async function openFixture(t,viewport={width:800,height:600}){
 const {app}=createFixtureServer(),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
 const page=await browser.newPage({viewport});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');return page;
}

test('mouse language setting translates the full UI and persists through defaults and reload',{timeout:60000},async t=>{
 const page=await openFixture(t);
 assert.equal(await page.locator('html').getAttribute('lang'),'en');
 assert.equal(await page.locator('.board-head b').first().textContent(),'Daily Top Groups');
 const idolName=await page.locator('.board').nth(1).locator('.name').first().textContent(),idolPoints=await page.locator('.board').nth(1).locator('.points').first().textContent();
 await page.keyboard.press('7');const language=page.locator('#language-choice');assert.equal(await language.count(),1,'Display settings expose a language selector');await language.selectOption('vi');
 await page.waitForFunction(()=>document.documentElement.lang==='vi'&&document.querySelector('#settings-title').textContent==='Cài đặt');
 assert.equal(await page.locator('.board-head b').first().textContent(),'Top Nhóm Hôm Nay');
 assert.equal(await page.locator('.board').nth(1).locator('.name').first().textContent(),idolName,'proper names must not be translated');
 assert.equal(await page.locator('.board').nth(1).locator('.points').first().textContent(),idolPoints,'full point values must not change');
 assert.match(await page.locator('.camera-notice').textContent(),/CẤM CHỤP ẢNH HOẶC QUAY VIDEO/);
 assert.deepEqual(await page.locator('.settings-nav button').allTextContents(),['Hiển thị','Thời gian','Phạm vi hiển thị','Lịch sử & Làm mới','Mặc định','Phím tắt']);
 await page.locator('[data-page="2"]').click();assert.equal(await page.locator('#location-choice option').first().textContent(),'Tất cả chi nhánh');assert.equal(await page.locator('#location-toggles span').textContent(),'Hiện tất cả chi nhánh');assert.equal(await page.locator('#branch-items input').first().getAttribute('aria-label'),'Hiện TEST HCM');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_v2_current')).language),'vi');
 for(let pane=0;pane<6;pane++){
  await page.locator('[data-page="'+pane+'"]').click();
  const fit=await page.evaluate(()=>{const box=document.querySelector('.settings-box').getBoundingClientRect(),controls=[...document.querySelectorAll('.settings-page.active button,.settings-page.active input,.settings-page.active select,.settings-actions button')].filter(e=>e.getClientRects().length);return{page:[document.documentElement.scrollWidth,document.documentElement.scrollHeight,innerWidth,innerHeight],controls:controls.every(e=>{const r=e.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1&&r.top>=box.top-1&&r.bottom<=box.bottom+1})}});
  assert.deepEqual(fit.page,[800,600,800,600]);assert.equal(fit.controls,true,'Vietnamese controls fit pane '+pane+' at 800x600');
 }
 await page.locator('[data-page="4"]').click();await page.locator('#save-default-page').click();
 await page.locator('[data-page="0"]').click();await language.selectOption('en');assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.locator('[data-page="4"]').click();await page.locator('#restore-default').click();assert.equal(await page.locator('html').getAttribute('lang'),'vi');
 await page.reload();await page.waitForSelector('.row');assert.equal(await page.locator('html').getAttribute('lang'),'vi');assert.equal(await page.locator('#settings-title').textContent(),'Cài đặt');
});

test('remote language selection applies immediately and Back keeps it while dynamic copy stays bilingual',{timeout:30000},async t=>{
 const page=await openFixture(t,{width:1280,height:720});await page.keyboard.press('7');const language=page.locator('#language-choice');assert.equal(await language.count(),1,'Display settings expose a language selector');
 await language.focus();await page.keyboard.press('Enter');await page.keyboard.press('ArrowDown');
 assert.equal(await page.locator('html').getAttribute('lang'),'vi','selection translates before OK or Back');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('helios_leaderboard_v2_current')).language),'vi');
 await page.keyboard.press('ArrowUp');assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.documentElement.lang==='vi');assert.equal(await language.inputValue(),'vi');assert.equal(await page.locator('#save-status').textContent(),'Đã áp dụng thay đổi');
 assert.match(await page.locator('.ticker-line').textContent(),/CHÚC MỪNG TEST GROUP 1 ĐẠT 1,000,000 ĐIỂM/);
 assert.match(await page.locator('#connection').textContent(),/BỘ NHỚ ĐỆM/);assert.doesNotMatch(await page.locator('#connection').textContent(),/CACHED/);
 assert.equal(await page.locator('#quick-refresh').getAttribute('title'),'Làm mới tất cả (8)');
 await page.locator('#done-settings').click();await page.keyboard.press('8');await page.waitForFunction(()=>document.querySelector('.toast').textContent.includes('Đã làm mới điểm'));
 const vn=new Date(Date.now()+7*3600000),month=new Date(Date.UTC(vn.getUTCFullYear(),vn.getUTCMonth()-1,1)).toISOString().slice(0,7),[y,m]=month.split('-').map(Number),history={status:'ok',aggregationVersion:2,source:'rebuilt',period:{month,start:new Date(Date.UTC(y,m-1,1)).toISOString(),end:new Date(Date.UTC(y,m,1)).toISOString(),complete:true},data:{individual:[{name:'TEST ALPHA',value:1234567,locationId:'loc_hcm',groupId:'g0'}],group:[]}};
 await page.route('**/api/leaderboard/history**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(history)}));
 await page.keyboard.press('6');await page.waitForSelector('.board:nth-child(6) .row');assert.match(await page.locator('#history-note').textContent(),/Tháng trước:/);
 assert.match(await page.locator('#history-note').textContent(),/đã tính lại/,'rebuilt history source is translated');
});
