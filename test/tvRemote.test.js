const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');
test('TV legacy key codes navigate, edit selects and toggle every checkbox despite mouse movement',async t=>{
 const {app}=createFixtureServer(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');await page.keyboard.press('7');
 const key=code=>page.evaluate(code=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Unidentified',keyCode:code,bubbles:true,cancelable:true})),code);
 await key(39);assert.equal(await page.locator('[data-score="0"]').evaluate(e=>e===document.activeElement),true);
 for(let i=0;i<6;i++){
  const control=page.locator(i<5?'[data-score="'+i+'"]':'[data-config="total"]'),before=await control.isChecked();
  await page.mouse.move(800+i*2,420);await key(13);assert.equal(await control.isChecked(),!before);
  assert.equal(await control.evaluate(e=>getComputedStyle(e).outlineStyle),'solid');await key(40);
 }
 await key(13);await key(40);assert.equal(await page.locator('html').getAttribute('lang'),'vi');await key(13);await key(40);
 await key(23);await key(20);assert.equal(await page.locator('.tv').getAttribute('data-layout'),'studio');await key(23);
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');assert.equal(await page.locator('#settings-dialog').isVisible(),false);
});
test('mouse-emulated TV clicks open custom choices and time controls without native popups',async t=>{
 const {app}=createFixtureServer(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');await page.keyboard.press('7');
 await page.locator('#layout-choice').click();await page.locator('.tv-picker').getByRole('button',{name:'Studio · Podium',exact:true}).click();assert.equal(await page.locator('.tv').getAttribute('data-layout'),'podium');
 await page.locator('#language-choice').click();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');assert.equal(await page.locator('html').getAttribute('lang'),'vi');
 await page.locator('.settings-nav [data-page="1"]').click();await page.locator('[data-config="freezeUntil"]').click();await page.locator('.tv-picker').getByRole('button',{name:'+ Giờ',exact:true}).click();await page.locator('.tv-picker').getByRole('button',{name:'+ Phút',exact:true}).click();assert.equal(await page.locator('[data-config="freezeUntil"]').inputValue(),'10:01');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.tv-picker').count(),0);await page.locator('[data-config="speed"]').click();await page.locator('.tv-picker').getByRole('button',{name:'+',exact:true}).click();assert.equal(await page.locator('[data-config="speed"]').inputValue(),'61');
});
