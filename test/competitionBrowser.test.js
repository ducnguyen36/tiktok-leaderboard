const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {createCompetitionFixture}=require('./support/competition-server');
test('outside viewer requests access, admin approves, viewer switches modes, toggles groups, snapshots and swipes',async t=>{
 const {app,state}=createCompetitionFixture(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 // A manual correction pushes Chanee below zero: Cuộc thi LILY 104, RYAN 40, Chanee −296; Tổng cộng RYAN 1039, LILY 154, Chanee −296.
 state.db.rows('gifts').push(state.gift(['Chanee🌸'],-300,Date.now()-100));
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--proxy-server=direct://','--proxy-bypass-list=*']}),errors=[];
 t.after(async()=>{await browser.close();server.closeAllConnections();server.close();assert.deepEqual(errors,[])});
 const visitorContext=await browser.newContext({viewport:{width:375,height:812}}),adminContext=await browser.newContext({viewport:{width:1280,height:900}});
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
 await visitor.locator('#board-view').waitFor();await visitor.locator('.page.live .talents .row').first().waitFor();
 const live=visitor.locator('.page.live'),scores=page=>page.locator('.talents .row').evaluateAll(rows=>rows.map(r=>[r.querySelector('.who b').textContent,r.querySelector('.score').textContent]));
 const groupScores=page=>page.locator('.groups .row').evaluateAll(rows=>rows.map(r=>[r.querySelector('.who b').textContent,r.querySelector('.score').textContent]));
 assert.deepEqual(await scores(live),[['LILY 🍉','104'],['RYAN','40'],['Chanee🌸','−296']],'one number per row, true minus sign');
 assert.equal(await live.locator('.talents .score.neg').count(),1);assert.notEqual(await live.locator('.score.neg').first().evaluate(e=>getComputedStyle(e).color),await live.locator('.score').first().evaluate(e=>getComputedStyle(e).color));
 assert.doesNotMatch(await visitor.locator('#board-view').textContent(),/Vòng/,'no round split any more');
 assert.equal(await visitor.locator('#comp-status').textContent(),'Đang diễn ra');assert.equal(await visitor.locator('#admin-view').isVisible(),false);
 assert.equal(await live.locator('.groups').isVisible(),false,'group totals start hidden');
 // Group toggle on a phone: the panel sits above the talent ranking.
 await visitor.getByRole('button',{name:'Nhóm'}).click();await live.locator('.groups').waitFor();
 assert.deepEqual(await groupScores(live),[['HT - ICONZ','40'],['HT - DPM','−192']]);assert.equal(await live.locator('.groups .score.neg').count(),1);
 const [g,tl]=await Promise.all([live.locator('.groups').boundingBox(),live.locator('.talents').boundingBox()]);assert.ok(g.y+g.height<=tl.y+1,'groups above talents on a phone');
 // Mode switch changes numbers and order, for talents and groups.
 await visitor.getByRole('button',{name:'Tổng cộng'}).click();
 assert.deepEqual(await scores(live),[['RYAN','1.039'],['LILY 🍉','154'],['Chanee🌸','−296']]);assert.deepEqual(await groupScores(live),[['HT - ICONZ','1.039'],['HT - DPM','−142']]);
 assert.equal(await visitor.getByRole('button',{name:'Tổng cộng'}).getAttribute('aria-pressed'),'true');
 assert.equal(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page scroll at 375px');
 assert.equal(await live.locator('.who b').first().evaluate(e=>getComputedStyle(e).textOverflow),'ellipsis');
 // Preferences persist per browser.
 await visitor.reload();await live.locator('.talents .row').first().waitFor();
 assert.equal(await visitor.getByRole('button',{name:'Tổng cộng'}).getAttribute('aria-pressed'),'true');assert.equal(await live.locator('.groups').isVisible(),true);
 assert.equal((await scores(live))[0][0],'RYAN');
 // Snapshot through the compact icon button.
 const camera=visitor.getByRole('button',{name:'Chụp snapshot'});const size=await camera.boundingBox();assert.ok(size.width<=44&&size.height<=44,'compact icon button');
 await camera.click();await visitor.locator('#name-dialog').waitFor();assert.equal(await visitor.locator('#name-input').inputValue(),'Snapshot 1');
 await visitor.locator('#name-input').fill('Chốt 1');await visitor.locator('#name-confirm').click();
 await visitor.locator('.page').nth(1).waitFor({state:'attached'});assert.equal(await visitor.locator('.dots button').count(),2);
 assert.equal(await visitor.locator('.dots button').nth(0).getAttribute('aria-current'),'true','stays on LIVE until the viewer swipes');
 // Swipe: scroll the snap container horizontally, as a touch swipe would.
 await visitor.locator('#pages').evaluate(box=>box.scrollTo({left:box.children[1].offsetLeft,behavior:'auto'}));
 await visitor.waitForFunction(()=>document.querySelectorAll('.dots button')[1].getAttribute('aria-current')==='true');
 const snapshotPage=visitor.locator('.page').nth(1);assert.equal(await snapshotPage.locator('.page-title').textContent(),'Chốt 1');
 assert.equal(await snapshotPage.evaluate(el=>{const r=el.getBoundingClientRect();return Math.round(r.left)>=0&&Math.round(r.right)<=innerWidth}),true,'snapshot page is in view');
 assert.deepEqual(await scores(snapshotPage),[['RYAN','1.039'],['LILY 🍉','154'],['Chanee🌸','−296']]);assert.equal(await snapshotPage.locator('.groups').isVisible(),true);
 await visitor.getByRole('button',{name:'Cuộc thi'}).click();
 assert.deepEqual(await scores(snapshotPage),[['LILY 🍉','104'],['RYAN','40'],['Chanee🌸','−296']],'mode applies to snapshot pages');
 assert.equal(await visitor.locator('.dots button').nth(1).getAttribute('aria-current'),'true','switching mode keeps the page');
 await visitor.getByRole('button',{name:'Nhóm'}).click();assert.equal(await snapshotPage.locator('.groups').isVisible(),false,'tap again hides groups');
 await visitor.locator('#prev-page').click();await visitor.waitForFunction(()=>document.querySelectorAll('.dots button')[0].getAttribute('aria-current')==='true');
 // Wide landscape: the group panel slides in from the right beside the ranking.
 const adminLive=admin.locator('.page.live');await adminLive.locator('.talents .row').first().waitFor();
 const panel=adminLive.locator('.groups');assert.equal(await panel.evaluate(e=>getComputedStyle(e).visibility),'hidden');
 await admin.getByRole('button',{name:'Nhóm'}).click();
 await admin.waitForFunction(()=>{const e=document.querySelector('.page.live .groups');return e&&getComputedStyle(e).opacity==='1'&&e.getBoundingClientRect().width>=250});
 const [side,list]=await Promise.all([panel.boundingBox(),adminLive.locator('.talents').boundingBox()]);
 assert.ok(side.x>=list.x+list.width-1,'side panel is right of the ranking, not over it');assert.ok(Math.abs(side.y-list.y)<2,'side by side');
 assert.ok(await panel.evaluate(e=>getComputedStyle(e).transitionProperty.includes('flex-basis')),'slides with a CSS transition');
 // Snapshot header: pencil right after the name; only admins get the trash, at the far right, confirmed first.
 const visitorSnap=visitor.locator('.page').nth(1);
 assert.equal(await visitorSnap.locator('.title-row button[aria-label="Đổi tên snapshot"]').count(),1);assert.equal(await visitorSnap.locator('button[aria-label="Xóa snapshot"]').count(),0);
 await admin.reload();const adminSnap=admin.locator('.page').nth(1);await adminSnap.waitFor({state:'attached'});
 const trash=adminSnap.locator('.page-head > button[aria-label="Xóa snapshot"]');
 assert.equal(await adminSnap.locator('.page-head').evaluate(h=>h.lastElementChild.getAttribute('aria-label')),'Xóa snapshot');
 const [pencilBox,trashBox,headBox]=await Promise.all([adminSnap.locator('.title-row button').boundingBox(),trash.boundingBox(),adminSnap.locator('.page-head').boundingBox()]);
 assert.ok(trashBox.x-(pencilBox.x+pencilBox.width)>60,'trash is well away from the pencil');assert.ok(headBox.x+headBox.width-(trashBox.x+trashBox.width)<20,'trash hugs the right edge');
 admin.once('dialog',d=>d.dismiss());await trash.click();await admin.waitForTimeout(300);assert.equal(await admin.locator('.page').count(),2,'cancelled confirm keeps it');
 admin.once('dialog',d=>{assert.match(d.message(),/Chốt 1/);d.accept()});await trash.click();await admin.waitForFunction(()=>document.querySelectorAll('.page').length===1);
});
test('eliminated talents are left out of the ranking; the toolbar eye shows their count and can show them dimmed',async t=>{
 const {app,state}=createCompetitionFixture(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 // LILY 104, RYAN 40, Chanee 4 (Cuộc thi); RYAN is out.
 state.db.rows('competitions')[0].eliminated=[{talentName:'RYAN',at:new Date()}];
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--proxy-server=direct://','--proxy-bypass-list=*']}),errors=[];
 t.after(async()=>{await browser.close();server.closeAllConnections();server.close();assert.deepEqual(errors,[])});
 const context=await browser.newContext({viewport:{width:375,height:812}});await context.addCookies([{name:'test_admin',value:'1',url:base}]);
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/pk-battle-16-10`);const live=page.locator('.page.live');await live.locator('.talents .row').first().waitFor();
 const rows=()=>live.locator('.talents .row').evaluateAll(list=>list.map(r=>[r.querySelector('.rank').textContent,r.querySelector('.who b').textContent,r.classList.contains('out')]));
 assert.deepEqual(await rows(),[['1','LILY 🍉',false],['2','Chanee🌸',false]],'hidden by default; ranks continuous');
 const eye=page.locator('#out-toggle');assert.equal(await eye.isVisible(),true);assert.equal((await eye.textContent()).trim(),'1','eye icon shows only the count');assert.equal(await live.locator('.out-toggle').count(),0,'no text button in the list');
 const [eyeBox,groupsBox]=await Promise.all([eye.boundingBox(),page.getByRole('button',{name:'Nhóm'}).boundingBox()]);assert.ok(Math.abs(eyeBox.y-groupsBox.y)<4,'eye sits on the toolbar row with Nhóm');
 assert.equal(await eye.getAttribute('aria-label'),'Hiện 1 người bị loại');await eye.click();
 assert.deepEqual(await rows(),[['1','LILY 🍉',false],['–','RYAN',true],['2','Chanee🌸',false]],'shown in score order, unnumbered');
 const out=live.locator('.talents .row.out');assert.match(await out.textContent(),/Đã loại/);assert.ok(Number(await out.evaluate(e=>getComputedStyle(e).opacity))<0.7,'dimmed');
 assert.match(await out.locator('.score').textContent(),/40/,'score still visible');
 await page.getByRole('button',{name:'Nhóm'}).click();assert.match(await live.locator('.groups').textContent(),/HT - ICONZ\s*40/,'groups still count eliminated points');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.reload();await live.locator('.talents .row').first().waitFor();assert.equal((await rows()).length,3,'choice remembered per browser');
 assert.equal(await eye.getAttribute('aria-label'),'Ẩn 1 người bị loại');await eye.click();assert.equal((await rows()).length,2);
});
