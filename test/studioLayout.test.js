const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');
async function fixture(t){
 const {app,state}=createFixtureServer(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true,args:['--disable-gpu']});
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');return{page,state};
}
async function choose(page,value){await page.keyboard.press('7');await page.locator('.settings-nav [data-page="0"]').click();assert.equal(await page.locator('#layout-choice').count(),1,'Display settings offers both TV layouts');await page.locator('#layout-choice').selectOption(value);await page.locator('#done-settings').click();}
test('Studio rearranges every ranking without losing rows, points or viewport fit',{timeout:60000},async t=>{
 const {page,state}=await fixture(t),before=await page.locator('.board .name').allTextContents();const requests=state.requests.length;
 await choose(page,'studio');assert.equal(await page.locator('.tv').getAttribute('data-layout'),'studio');
 assert.deepEqual(await page.locator('.board .name').allTextContents(),before);assert.equal(state.requests.length,requests,'layout change does not refetch scores');
 for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:1100,height:600},{width:2560,height:1080}]){
  await page.setViewportSize(size);
  for(const history of [false,true]){
   if(history)await page.keyboard.press('6');await page.waitForTimeout(80);
   assert.equal(await page.locator('.board:visible').count(),history?6:5);
   const geometry=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const boards=[...document.querySelectorAll('.board')].filter(e=>!e.hidden),top=boards.slice(0,4);
    return{bounds:boards.map(rect),head:rect(document.querySelector('.head')),ticker:rect(document.querySelector('.ticker-zone')),brand:rect(document.querySelector('.brand')),kpi:rect(document.querySelector('.kpi')),fits:top.every(b=>[...b.querySelectorAll('.row')].length===10&&[...b.querySelectorAll('.row')].every(e=>{const r=rect(e),l=rect(b.querySelector('.list'));return r.y>=l.y-1&&r.bottom<=l.bottom+1&&r.right<=l.right+1})),pointsFit:top.every(b=>[...b.querySelectorAll('.points')].every(e=>e.scrollWidth<=e.clientWidth)),scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]};
   });
   assert.ok(geometry.bounds[2].y>geometry.bounds[0].bottom-1,'month boards below daily boards');
   assert.ok(geometry.bounds[4].height>geometry.bounds[0].height*1.8,'full ranking spans both rows');
   if(history)assert.equal(await page.locator('.board:nth-child(-n+4) .name').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth)),true,'normal fixture names stay readable when history is added');
   assert.equal(geometry.ticker.y,0,'Studio congratulations occupy the top row');
   assert.ok(geometry.ticker.bottom<=geometry.head.y+1,'congratulations above logo and total');
   assert.ok(geometry.brand.right<=geometry.kpi.x,'brand and total do not overlap');
   assert.equal(geometry.fits,true,'all 40 top entries fit fully');assert.equal(geometry.pointsFit,true,'point values remain complete');
   assert.ok(geometry.scroll[0]<=size.width&&geometry.scroll[1]<=size.height,'TV never scrolls');
   assert.equal(await page.locator('.board[data-column="1"] .points').first().textContent(),'5,270,072');
   await page.waitForFunction(()=>document.querySelector('.board[data-column="4"] .all-track').getAnimations().length>0);
   if(history){await page.waitForSelector('.board[data-column="5"] .row');assert.equal(await page.locator('.board[data-column="5"] .row').count(),32);await page.keyboard.press('6')}
  }
 }
 await page.setViewportSize({width:1100,height:600});await page.keyboard.press('7');await page.locator('.settings-nav [data-page="1"]').click();await page.locator('[data-config="yesterdayGroups"]').check();await page.locator('[data-config="yesterdayIdols"]').check();await page.locator('#done-settings').click();
 assert.equal(await page.locator('.board[data-column="0"] .yesterday').count(),10);
 assert.equal(await page.locator('.board:nth-child(-n+2) .identity').evaluateAll(es=>es.every(e=>{const a=e.getBoundingClientRect(),b=e.closest('.row').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom})),true,'comparison labels fit at the smallest Studio size');
 await page.setViewportSize({width:800,height:600});assert.equal(await page.locator('.board:visible').count(),5);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight),true);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.board:visible').count(),1);assert.equal(await page.locator('.mobile-board-tabs button').count(),5);
 await page.setViewportSize({width:1920,height:1080});await choose(page,'classic');
 const heights=await page.locator('.board:visible').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));assert.ok(Math.max(...heights)-Math.min(...heights)<2);
});
test('Studio selection supports saved defaults, reload, bilingual labels and remote editing',{timeout:30000},async t=>{
 const {page}=await fixture(t);await choose(page,'studio');await page.keyboard.press('7');await page.locator('#save-default').click();await page.locator('#done-settings').click();
 await page.reload();await page.waitForSelector('.row');assert.equal(await page.locator('.tv').getAttribute('data-layout'),'studio');
 await page.keyboard.press('7');await page.locator('#language-choice').selectOption('vi');assert.equal(await page.locator('#layout-label').evaluate(e=>e.firstChild.textContent),'Bố cục TV');assert.equal(await page.locator('#layout-choice option[value="classic"]').textContent(),'Cổ điển');
 await page.locator('#layout-choice').focus();await page.keyboard.press('Enter');await page.keyboard.press('Home');await page.keyboard.press('Enter');assert.equal(await page.locator('.tv').getAttribute('data-layout'),'classic');
 await page.locator('.settings-nav [data-page="4"]').click();await page.locator('#restore-default').click();assert.equal(await page.locator('.tv').getAttribute('data-layout'),'studio');
 await page.locator('#done-settings').click();await page.keyboard.press('1');assert.equal(await page.locator('.board[data-column="0"]').evaluate(e=>e.classList.contains('hide-points')),true);
 await page.keyboard.press('9');assert.equal(await page.locator('.kpi').evaluate(e=>e.classList.contains('hide-total')),true);
});
test('three layouts switch instantly during mouse and remote selection; Classic remains the fresh default',{timeout:30000},async t=>{
 const {page}=await fixture(t);assert.equal(await page.locator('.tv').getAttribute('data-layout'),'classic');
 await page.keyboard.press('7');const choice=page.locator('#layout-choice');
 assert.deepEqual(await choice.locator('option').evaluateAll(es=>es.map(e=>e.value)),['classic','studio','podium']);
 await choice.dispatchEvent('pointerdown');await choice.selectOption('podium');
 assert.equal(await page.locator('.tv').getAttribute('data-layout'),'podium','mouse choice applies while settings stays open');
 assert.equal(await page.locator('#settings-dialog').isVisible(),true);
 await choice.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.press('ArrowUp');
 assert.equal(await page.locator('.tv').getAttribute('data-layout'),'studio','remote arrow applies without OK confirmation');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.tv').getAttribute('data-layout'),'studio','Back exits without undoing an immediate layout selection');
 await page.locator('#done-settings').click();await page.reload();await page.waitForSelector('.row');assert.equal(await page.locator('.tv').getAttribute('data-layout'),'studio');
 await choose(page,'classic');assert.equal(await page.locator('.tv').getAttribute('data-layout'),'classic');
});
test('Podium preserves all ranks, points, comparisons and rail scrolling at TV sizes',{timeout:45000},async t=>{
 const {page,state}=await fixture(t),names=await page.locator('.board').evaluateAll(bs=>bs.map(b=>[...b.querySelectorAll('.name')].map(e=>e.textContent))),calls=state.requests.length;
 await page.keyboard.press('7');assert.equal(await page.locator('#layout-choice option[value="podium"]').count(),1,'Podium is a selectable third layout');await page.locator('#layout-choice').selectOption('podium');await page.locator('.settings-nav [data-page="1"]').click();await page.locator('[data-config="yesterdayGroups"]').check();await page.locator('[data-config="yesterdayIdols"]').check();await page.locator('#done-settings').click();
 assert.deepEqual(await page.locator('.board').evaluateAll(bs=>bs.map((b,i)=>[...b.querySelectorAll('.name')].slice(0,i<4?10:Infinity).map(e=>e.textContent))),names);assert.equal(state.requests.length,calls);
 for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:1100,height:600}]){
  await page.setViewportSize(size);
  for(const history of [false,true]){
   if(history){await page.keyboard.press('6');await page.waitForSelector('.board[data-column="5"] .row')}
   const checks=await page.locator('.board:nth-child(-n+4)').evaluateAll(bs=>bs.map(b=>{
    const rows=[...b.querySelectorAll('.row')],r=rows.map(e=>e.getBoundingClientRect()),box=b.querySelector('.list').getBoundingClientRect();
    const avatars=rows.map(e=>e.querySelector('.avatar').getBoundingClientRect().height);
    return{count:rows.length,order:r[1].x<r[0].x&&r[0].x<r[2].x,winner:r[0].y<r[1].y&&r[0].y<r[2].y,hierarchy:avatars[0]>avatars[1]&&avatars[0]>avatars[2]&&avatars[1]>avatars[3]&&avatars[2]>avatars[3]&&r[0].width>r[1].width&&r[0].width>r[2].width,balanced:Math.abs(r[6].bottom-r[10]?.bottom)<1,fit:r.every(a=>a.x>=box.x-1&&a.right<=box.right+1&&a.y>=box.y-1&&a.bottom<=box.bottom+1),text:rows.every(e=>[...e.querySelectorAll('.identity,.avatar,.name,.points,.yesterday')].every(x=>{const a=x.getBoundingClientRect(),p=e.getBoundingClientRect();return a.y>=p.y-1&&a.bottom<=p.bottom+1})),points:rows.every(e=>{const p=e.querySelector('.points');return p.scrollWidth<=p.clientWidth})};
   }));
   for(const c of checks){assert.equal(c.count,11);assert.equal(c.order,true,'podium positions are 2,1,3');assert.equal(c.winner,true,'winner is raised');assert.equal(c.hierarchy,true,'winner larger than runners-up, runners-up larger than lower ranks');assert.equal(c.balanced,true,'ranks 7 and 11 finish at the same height');assert.equal(c.fit,true,'all ranks fit');assert.equal(c.text,true,`identity and comparisons fit ${JSON.stringify(size)}`);assert.equal(c.points,true,'unabbreviated points fit')}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),true);
   await page.waitForFunction(()=>document.querySelector('.board[data-column="4"] .all-track').getAnimations().length>0);
   if(history)await page.keyboard.press('6');
  }
 }
 await page.keyboard.press('1');assert.equal(await page.locator('.board[data-column="0"] .points:visible').count(),0);
 await page.setViewportSize({width:800,height:600});await page.waitForTimeout(100);assert.equal(await page.locator('.board[data-column="0"] .row').last().evaluate(e=>e.getBoundingClientRect().bottom<=e.closest('.list').getBoundingClientRect().bottom+1),true,'all eleven fit in compact TV fallback');
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelectorAll('.board.mobile-hidden').length===5);assert.equal(await page.locator('.board:visible').count(),1);assert.equal(await page.locator('.board[data-column="0"] .row').count(),11);
 state.empty=true;await page.setViewportSize({width:1920,height:1080});await page.keyboard.press('8');await page.waitForSelector('.board[data-column="0"] .empty-state');
 assert.equal(await page.locator('.board[data-column="0"] .row').count(),0,'empty data never invents podium winners');
});
