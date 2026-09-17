const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');

test('header artwork and total stay inside their regions when viewport aspect ratio changes',async t=>{
 const {app}=createFixtureServer();const server=app.listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');
 for(const [width,height] of [[1920,720],[1920,1080],[2560,1080],[1366,768],[1280,1024],[1024,768],[800,600],[390,844],[844,390]]){
  await page.setViewportSize({width,height});
  const bounds=await page.evaluate(()=>{
   const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
   return{head:rect('.head'),brand:rect('.brand'),logo:rect('.logo'),name:rect('.brand-name'),sub:rect('.brand-sub'),kpi:rect('.kpi'),label:rect('.kpi span'),value:rect('.kpi b'),ticker:rect('.ticker-zone'),overflow:document.documentElement.scrollHeight>innerHeight};
  });
  const inside=(a,b)=>a.x>=b.x-1&&a.y>=b.y-1&&a.right<=b.right+1&&a.bottom<=b.bottom+1;
  for(const key of ['logo','name','sub'])assert.ok(inside(bounds[key],bounds.brand),`${width}x${height}: ${key} overflows brand ${JSON.stringify(bounds)}`);
  for(const key of ['label','value'])assert.ok(inside(bounds[key],bounds.kpi),`${width}x${height}: ${key} overflows total`);
  assert.ok(bounds.brand.right<=bounds.kpi.x+1,`${width}x${height}: brand overlaps total`);
  assert.ok(bounds.logo.bottom<=bounds.ticker.y&&bounds.kpi.bottom<=bounds.ticker.y,`${width}x${height}: header overlaps ticker`);
  assert.equal(bounds.overflow,false);
 }
});
