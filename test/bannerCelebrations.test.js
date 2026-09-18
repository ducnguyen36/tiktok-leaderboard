const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createFixtureServer}=require('./support/command-center-server');
test('milestones play once, suppress repeats, respect mute and survive reload',{timeout:30000},async t=>{
 const {app}=createFixtureServer(),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('.row');
 const result=await page.evaluate(()=>{
  let notes=0;
  celebrationAudio={state:'running',currentTime:0,destination:{},createOscillator(){return{frequency:{},connect(){},start(){notes++},stop(){}}},createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}}};
  const send=(value,extra={})=>{lastChime=0;updateCelebrations({data:{group:{daily:[{name:'TEST GROUP 1',groupId:'g0',locationId:'loc_hcm',value}]}},meta:{computedAt:Date.now(),...extra}});return notes};
  const counts=[send(1049999),send(1050000),send(1050000),send(1000000),send(1050000),send(1100000,{stale:true}),send(1100000)];
  config.celebrationSound=false;counts.push(send(1150000));config.celebrationSound=true;counts.push(send(1150000));
  celebrationSessionReady=false;counts.push(send(1200000));counts.push(send(1250000));
  return{counts,particles:document.querySelectorAll('.banner-spark').length};
 });
 assert.deepEqual(result.counts,[0,4,4,4,4,4,8,8,8,8,12]);assert.ok(result.particles>0);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.banner-fireworks').isVisible(),false);
});
