const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');
test('talent checkboxes support remote toggling, pagination and saved defaults',async t=>{
 const {app}=createFixtureServer(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');
 const total=await page.locator('.kpi b').textContent();
 await page.keyboard.press('7');await page.getByRole('button',{name:'Talents',exact:true}).click();
 const alpha=page.locator('#talent-items input[aria-label="TEST ALPHA"]');await alpha.focus();await page.keyboard.press('Enter');
 assert.equal(await alpha.isChecked(),false);
 assert.equal(await page.locator('.board').nth(1).locator('.name').first().textContent(),'TEST IDOL 2');
 assert.equal(await page.locator('.board').nth(3).locator('.row').count(),10);
 assert.equal(await page.locator('.board').nth(4).locator('.row').count(),31);
 assert.equal(await page.locator('.kpi b').textContent(),total);
 await page.locator('#save-default').click();await page.locator('#talents-next').click();assert.match(await page.locator('#talents-page').textContent(),/^2 /);
 await page.locator('#talents-prev').click();await alpha.check();await page.reload();await page.waitForSelector('.row');
 assert.equal(await page.locator('.board').nth(1).locator('.name').first().textContent(),'TEST ALPHA');
 await page.keyboard.press('7');await page.getByRole('button',{name:'Defaults',exact:true}).click();await page.locator('#restore-default').click();
 assert.equal(await page.locator('.board').nth(1).locator('.name').first().textContent(),'TEST IDOL 2');
 await page.getByRole('button',{name:'Talents',exact:true}).click();
 for(const size of [{width:1366,height:768},{width:800,height:600}]){
  await page.setViewportSize(size);
  assert.equal(await page.locator('.settings-box').evaluate(e=>e.scrollHeight>e.clientHeight+1),false);
 }
});
