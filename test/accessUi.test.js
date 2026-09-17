const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const path=require('node:path');
const {chromium}=require('playwright');

async function fixture(t,admin=false){
 const state={admin,authorized:admin,setupRequired:false,pairs:0,approved:[],revoked:[],devices:[]};
 const app=express();app.use(express.json());
 app.get('/auth/status',(req,res)=>res.json({...state,csrf:'test-csrf',email:admin?'ducnguyen36@gmail.com':undefined}));
 app.post('/auth/pair',(req,res)=>{assert.equal(req.get('x-csrf-token'),'test-csrf');state.pairs++;res.json({code:'ABCD-EFGH',expiresAt:new Date(Date.now()+600000).toISOString()})});
 app.get('/auth/devices',(req,res)=>res.json({devices:state.devices}));
 app.post('/auth/approve',(req,res)=>{assert.equal(req.get('x-csrf-token'),'test-csrf');state.approved.push(req.body);res.json({ok:true})});
 app.post('/auth/revoke',(req,res)=>{assert.equal(req.get('x-csrf-token'),'test-csrf');state.revoked.push(req.body.id);state.devices=state.devices.filter(d=>d.id!==req.body.id);res.json({ok:true})});
 app.post('/auth/logout',(req,res)=>{state.admin=false;state.authorized=false;res.json({ok:true})});
 app.get('/auth',(req,res)=>res.sendFile(path.resolve(__dirname,'../public/access.html')));
 app.get('/',(req,res)=>res.type('html').send('<h1>Approved fixture leaderboard</h1>'));
 app.get('/auth/access.js',(req,res)=>res.sendFile(path.resolve(__dirname,'../public/access.js')));
 app.get('/auth/access.css',(req,res)=>res.sendFile(path.resolve(__dirname,'../public/access.css')));
 app.use(express.static(path.resolve(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(4000);
 return{page,state,url:'http://127.0.0.1:'+server.address().port+'/auth'};
}

test('access shell requests a TV pairing code, switches language and fits phone',async t=>{
 const {page,state,url}=await fixture(t);await page.goto(url);
 await page.locator('#request-pair').click();
 await page.waitForFunction(()=>document.querySelector('#pair-code').textContent==='ABCD-EFGH');
 assert.equal(await page.locator('#pair-code').textContent(),'ABCD-EFGH');assert.equal(state.pairs,1);
 await page.locator('#access-language').selectOption('vi');
 assert.equal(await page.locator('html').getAttribute('lang'),'vi');
 assert.equal(await page.locator('#google-login').getAttribute('href'),'/auth/google');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.locator('#admin-panel').isVisible(),false);
});

test('administrator can approve and revoke named devices with safe text rendering',async t=>{
 const {page,state,url}=await fixture(t,true);state.devices=[{id:'device-1',name:'TV <img src=x onerror=alert(1)>',lastSeen:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}];
 await page.goto(url);await page.locator('#admin-panel').waitFor();
 await page.locator('#approval-code').fill('ABCD-EFGH');await page.locator('#device-name').fill('TV HCM');
 await page.locator('#approve-device').click();await page.waitForFunction(()=>document.querySelector('#approval-code').value==='');
 assert.deepEqual(state.approved,[{code:'ABCD-EFGH',name:'TV HCM'}]);
 assert.equal(await page.locator('#device-list img').count(),0);
 assert.match(await page.locator('#device-list').textContent(),/TV <img/);
 page.once('dialog',dialog=>dialog.accept());await page.locator('#device-list button').click();
 await page.waitForFunction(()=>!document.querySelector('#device-list button'));
 assert.deepEqual(state.revoked,['device-1']);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('unconfigured OAuth disables pairing and login with clear setup notice',async t=>{
 const {page,state,url}=await fixture(t);state.setupRequired=true;await page.goto(url);
 await page.locator('#setup-notice').waitFor();
 assert.equal(await page.locator('#request-pair').isDisabled(),true);
 assert.equal(await page.locator('#google-login').getAttribute('aria-disabled'),'true');
 assert.equal(await page.locator('#admin-panel').isVisible(),false);
});

test('approved TV opens automatically and administrator logout clears local ranking data',async t=>{
 const tv=await fixture(t);await tv.page.goto(tv.url);await tv.page.locator('#request-pair').click();
 await tv.page.waitForFunction(()=>document.querySelector('#pair-code').textContent.length>0);
 tv.state.authorized=true;await tv.page.waitForURL(url=>url.pathname==='/',{timeout:10000});
 const admin=await fixture(t,true);await admin.page.goto(admin.url);await admin.page.locator('#admin-panel').waitFor();
 await admin.page.evaluate(()=>{localStorage.setItem('helios_leaderboard_v2_history_2026-08','private');localStorage.setItem('helios_leaderboard_v2_current','private names');localStorage.setItem('leaderboard_config','legacy private names')});
 await admin.page.locator('#access-logout').click();await admin.page.waitForFunction(()=>document.querySelector('#access-logout').hidden);
 assert.equal(await admin.page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('helios_leaderboard_')||key==='leaderboard_config')),false);
 assert.equal(await admin.page.locator('#admin-panel').isVisible(),false);
});
