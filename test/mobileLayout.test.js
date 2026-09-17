const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');

async function fixture(t,viewport){
 const {app,state}=createFixtureServer();const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
 const page=await browser.newPage({viewport});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');
 return {page,state};
}
const tabs=page=>page.locator('.mobile-board-tabs [role="tab"]');

test('phone tabs show one complete manually scrollable leaderboard without refetching',{timeout:30000},async t=>{
 const {page,state}=await fixture(t,{width:390,height:844});
 assert.equal(await tabs(page).count(),5);
 assert.equal(await page.locator('.board:visible').count(),1);
 assert.equal(await tabs(page).first().getAttribute('aria-selected'),'true');
 const relationships=await page.evaluate(()=>[...document.querySelectorAll('.mobile-board-tabs [role="tab"]')].map(tab=>{const panel=document.getElementById(tab.getAttribute('aria-controls'));return{tabId:tab.id,panelRole:panel?.getAttribute('role'),panelLabel:panel?.getAttribute('aria-labelledby')}}));
 assert.equal(relationships.every(item=>item.tabId&&item.panelRole==='tabpanel'&&item.panelLabel===item.tabId),true,'each mobile tab labels its controlled tabpanel');
 const dailyPoint=await page.locator('.board[data-column="0"] .points').first().textContent();
 assert.equal(dailyPoint,'1,000,000','phone retains the full formatted point value');
 await page.waitForTimeout(3300);
 assert.equal(await page.locator('#settings-open').isVisible(),true,'touch settings stays visible after desktop idle timeout');
 const calls=state.requests.length;
 await tabs(page).nth(4).click();
 assert.equal(await tabs(page).nth(4).getAttribute('aria-selected'),'true');
 const monthly=page.locator('.board[data-column="4"]');
 assert.equal(await monthly.locator('.row').count(),32);
 assert.equal(state.requests.length,calls,'changing tabs only presents loaded data');
 assert.equal(await monthly.locator('.all-track').evaluate(element=>element.getAnimations().length),0);
 assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.board.mobile-hidden')].every(board=>{const control=board.querySelector('a,button,input,[tabindex]');if(!control)return true;control.focus();return !board.contains(document.activeElement)})),true,'hidden boards cannot receive focus');
 await monthly.locator('.row').last().scrollIntoViewIfNeeded();
 assert.equal(await monthly.locator('.row').last().evaluate(element=>{const rect=element.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight+1}),true);
 assert.equal(await tabs(page).evaluateAll(items=>items.every(item=>{const rect=item.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight})),true,'touch tabs remain visible while manually scrolling a long board');
 const stickyClear=await page.evaluate(()=>{const toolbar=document.querySelector('.quick-toolbar').getBoundingClientRect();return[...document.querySelectorAll('.mobile-board-tabs [role=tab]')].every(tab=>{const rect=tab.getBoundingClientRect();return rect.right<=toolbar.left||rect.left>=toolbar.right||rect.bottom<=toolbar.top||rect.top>=toolbar.bottom})});
 assert.equal(stickyClear,true,'sticky touch tabs stay clear of the fixed toolbar');
 const beforeLabelSync=await page.evaluate(()=>{const y=scrollY;document.querySelector('.board[data-column="0"] .board-head b').textContent='Updated Daily Label';window.dispatchEvent(new Event('resize'));return y});
 await page.waitForTimeout(50);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-beforeLabelSync)<=1,'background tab-label synchronization does not jump the page');
 await tabs(page).first().click();
 await page.waitForTimeout(50);
 assert.equal(await page.locator('.board[data-column="0"]').evaluate((board)=>{const tabs=document.querySelector('.mobile-board-tabs').getBoundingClientRect(),header=board.querySelector('.board-head').getBoundingClientRect(),first=board.querySelector('.row').getBoundingClientRect();return header.top>=tabs.bottom-1&&first.top>=header.bottom-1&&first.bottom<=innerHeight}),true,'switching from a long list returns to the selected board header and first row');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('history selection, language and landscape settings remain reachable on phones',{timeout:30000},async t=>{
 const {page}=await fixture(t,{width:844,height:390});
 assert.equal(await tabs(page).count(),5);
 assert.equal(await tabs(page).evaluateAll(items=>items.every(item=>item.getBoundingClientRect().height>=44)),true,'tab targets are at least 44px high');
 await page.keyboard.press('6');
 assert.equal(await tabs(page).count(),6);
 await tabs(page).nth(5).click();await page.waitForSelector('.board[data-column="5"] .row');
 assert.match(await page.locator('.board[data-column="5"] .name').first().textContent(),/^PRIOR /);
 await page.keyboard.press('6');
 assert.equal(await tabs(page).count(),5);
 assert.equal(await page.locator('.board:visible').count(),1);
 assert.equal(await tabs(page).evaluateAll(items=>items.filter(item=>item.getAttribute('aria-selected')==='true').length),1,'disabling history selects a valid remaining tab');
 await page.keyboard.press('7');await page.locator('#language-choice').selectOption('vi');
 for(let index=0;index<6;index++){
  await page.locator('.settings-nav [data-page="'+index+'"]').click();
  const controls=page.locator('.settings-page.active button,.settings-page.active input,.settings-page.active select,.settings-page.active a,.settings-actions button');
  for(const control of await controls.all()){
   if(!await control.isVisible())continue;
   await control.scrollIntoViewIfNeeded();
   assert.equal(await control.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1}),true,'phone control is reachable');
  }
 }
 const access=page.locator('#manage-access');
 assert.equal(await access.getAttribute('href'),'/auth');
 assert.equal(await access.getAttribute('role'),null,'access management keeps native link semantics');
 assert.equal(await access.textContent(),'Quản lý quyền truy cập');
 await access.focus();assert.equal(await page.evaluate(()=>document.activeElement?.id),'manage-access','access management remains in the settings focus order');
 await page.locator('#done-settings').click();
 assert.equal(await tabs(page).first().textContent(),'Top Nhóm Hôm Nay');
 assert.equal(await tabs(page).first().getAttribute('aria-label'),'Top Nhóm Hôm Nay');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('resizing from phone restores equal-width fixed TV columns and auto scroll',{timeout:30000},async t=>{
 const {page}=await fixture(t,{width:390,height:844});
 assert.equal(await tabs(page).count(),5);
 await tabs(page).nth(4).click();
 await page.setViewportSize({width:1920,height:1080});
 await page.waitForFunction(()=>[...document.querySelectorAll('.board')].filter(element=>element.getClientRects().length).length===5);
 await page.waitForFunction(()=>[...document.querySelectorAll('.board')].every(item=>item.getAttribute('role')===null&&item.getAttribute('aria-labelledby')===null));
 assert.equal(await page.locator('.mobile-board-tabs').isVisible(),false);
 assert.equal(await page.locator('.board').evaluateAll(items=>items.every(item=>item.getAttribute('role')===null&&item.getAttribute('aria-labelledby')===null)),true,'desktop boards do not retain mobile tabpanel semantics');
 const sizes=await page.locator('.board:visible').evaluateAll(items=>items.map(element=>element.getBoundingClientRect().width));
 assert.ok(Math.max(...sizes)-Math.min(...sizes)<2);
 await page.waitForFunction(()=>document.querySelector('.board[data-column="4"] .all-track').getAnimations().length>0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:800,height:600});
 assert.equal(await page.locator('.mobile-board-tabs').isVisible(),false,'800x600 remains the TV layout');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),true);
});

test('focused tab follows real frozen and yesterday label transitions without losing focus',{timeout:30000},async t=>{
 const {page,state}=await fixture(t,{width:390,height:844});
 const first=tabs(page).first(),panel=page.locator('.board[data-column="0"]');await first.focus();const tabId=await first.getAttribute('id');
 assert.equal(await panel.getAttribute('role'),'tabpanel');assert.equal(await panel.getAttribute('aria-labelledby'),tabId);
 state.frozen=true;await page.keyboard.press('8');await page.waitForFunction(()=>document.querySelector('.mobile-board-tabs [role="tab"]').textContent==='Yesterday Top Groups');
 assert.equal(await panel.locator('.board-head b').textContent(),'Yesterday Top Groups');assert.equal(await page.evaluate(()=>document.activeElement?.id),tabId,'frozen refresh retains the focused tab');
 state.frozen=false;await page.keyboard.press('8');await page.waitForFunction(()=>document.querySelector('.mobile-board-tabs [role="tab"]').textContent==='Daily Top Groups');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),tabId,'live refresh retains the focused tab');
 await page.evaluate(()=>document.getElementById('daily-history').click());await page.waitForFunction(()=>document.querySelector('.mobile-board-tabs [role="tab"]').textContent==='Yesterday Top Groups');
 assert.equal(await panel.locator('.board-head b').textContent(),'Yesterday Top Groups');assert.equal(await page.evaluate(()=>document.activeElement?.id),tabId,'yesterday toggle retains the focused tab');
 await page.evaluate(()=>document.getElementById('daily-history').click());await page.waitForFunction(()=>document.querySelector('.mobile-board-tabs [role="tab"]').textContent==='Daily Top Groups');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),tabId,'returning to current scores retains the focused tab');
});
