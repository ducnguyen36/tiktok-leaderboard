const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {createCompetitionFixture}=require('./support/competition-server');
test('outside viewer requests access, admin approves, viewer snapshots and swipes to the snapshot page',async t=>{
 const {app}=createCompetitionFixture(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--proxy-server=direct://','--proxy-bypass-list=*']}),errors=[];
 t.after(async()=>{await browser.close();server.closeAllConnections();server.close();assert.deepEqual(errors,[])});
 const visitorContext=await browser.newContext({viewport:{width:390,height:844}}),adminContext=await browser.newContext({viewport:{width:1280,height:900}});
 await adminContext.addCookies([{name:'test_admin',value:'1',url:base}]);
 const visitor=await visitorContext.newPage(),admin=await adminContext.newPage();
 for(const page of [visitor,admin]){page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message))}
 await visitor.goto(`${base}/pk-battle-16-10`);await visitor.locator('#request-view').waitFor();
 assert.equal(await visitor.locator('#comp-name').textContent(),'PK BATTLE 16/10');assert.match(await visitor.locator('#request-view').textContent(),/Nhập tên của bạn/);
 await visitor.locator('#request-name').fill('<b>Kế toán</b>');await visitor.getByRole('button',{name:'Gửi yêu cầu xem'}).click();
 await visitor.locator('#pending-view').waitFor();assert.equal(await visitor.locator('#pending-name').textContent(),'<b>Kế toán</b>','names are shown as text');
 await admin.goto(`${base}/pk-battle-16-10`);await admin.locator('#admin-view .request').waitFor();
 assert.match(await admin.locator('#admin-view').textContent(),/<b>Kế toán<\/b>/);await admin.getByRole('button',{name:'Duyệt xem + snapshot'}).click();
 await admin.locator('#admin-view .request button[data-action="snapshot"][disabled]').waitFor();
 await visitor.locator('#board-view').waitFor();await visitor.locator('.page.live .row').first().waitFor();
 assert.match(await visitor.locator('.page.live .talents .row').first().textContent(),/LILY 🍉.*104/s);assert.match(await visitor.locator('.page.live .groups').textContent(),/HT - DPM.*108/s);
 assert.equal(await visitor.locator('#comp-status').textContent(),'Đang diễn ra');assert.equal(await visitor.locator('#admin-view').isVisible(),false);
 await visitor.getByRole('button',{name:'Chụp snapshot'}).click();await visitor.locator('#name-dialog').waitFor();await visitor.locator('#name-input').fill('Vòng 1');await visitor.locator('#name-confirm').click();
 await visitor.locator('.page').nth(1).waitFor({state:'attached'});assert.equal(await visitor.locator('.dots button').count(),2);
 assert.equal(await visitor.locator('.dots button').nth(0).getAttribute('aria-current'),'true','stays on LIVE until the viewer swipes');
 // Swipe: scroll the snap container horizontally, as a touch swipe would.
 await visitor.locator('#pages').evaluate(box=>box.scrollTo({left:box.children[1].offsetLeft,behavior:'auto'}));
 await visitor.waitForFunction(()=>document.querySelectorAll('.dots button')[1].getAttribute('aria-current')==='true');
 const snapshotPage=visitor.locator('.page').nth(1);assert.equal(await snapshotPage.locator('.page-title').textContent(),'Vòng 1');
 assert.equal(await snapshotPage.evaluate(el=>{const r=el.getBoundingClientRect();return Math.round(r.left)>=0&&Math.round(r.right)<=innerWidth}),true,'snapshot page is in view');
 assert.match(await snapshotPage.locator('.talents .row').first().textContent(),/LILY 🍉.*104.*104/s);
 await visitor.locator('#prev-page').click();await visitor.waitForFunction(()=>document.querySelectorAll('.dots button')[0].getAttribute('aria-current')==='true');
 assert.equal(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page scroll on a phone');
});
