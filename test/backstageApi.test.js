const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express');
const {createBackstageApi,dateRange,tokenMatches,dailyScores,sheetDays,REASONS}=require('../backstageApi');
const {parseSheet}=require('../sheetReconciliation');
const TOKEN='t'.repeat(40);
const profiles=[{_id:'g',name:'HT - AURA',talents:{Alice:{},Bob:{}}}];
test('range is bounded to 62 real calendar days',()=>{
 assert.equal(dateRange('2026-10-01','2026-10-31').length,31);
 assert.equal(dateRange('2026-10-02','2026-10-01'),null);assert.equal(dateRange('2026-02-30','2026-03-01'),null);
 assert.equal(dateRange('2026-01-01','2026-03-03').length,62);assert.equal(dateRange('2026-01-01','2026-03-04'),null);
});
test('bearer token compares exactly',()=>{
 assert.equal(tokenMatches('Bearer '+TOKEN,TOKEN),true);assert.equal(tokenMatches('Bearer '+TOKEN+'x',TOKEN),false);
 assert.equal(tokenMatches(TOKEN,TOKEN),false);assert.equal(tokenMatches('Bearer x',''),false);
});
const vnHour=iso=>Math.floor((Date.parse(iso)+7*3600000)/3600000);
test('daily totals mirror the board: gift time with the 07:00 cut-off by default, whole sessions in session-start mode; no gift detail',()=>{
 const sessions=[{_id:'s1',profileId:'g',sessionStartedAt:'2026-10-02T05:30:00+07:00'}];
 const gifts=[{sessionId:'s1',cost:100,receivedTalent:'Alice',count:1,hour:vnHour('2026-10-02T06:30:00+07:00')},{sessionId:'s1',cost:50,receivedTalent:'Bob',count:2,hour:vnHour('2026-10-02T08:00:00+07:00')}];
 const now=Date.parse('2026-10-05T12:00:00+07:00');
 const giftTime=dailyScores(profiles,sessions,gifts,['2026-10-01','2026-10-02'],{now});
 assert.deepEqual(giftTime[0].groups.map(({groupId,name,value})=>({groupId,name,value})),[{groupId:'g',name:'HT - AURA',value:100}]);
 const bob=giftTime[1].idols.find(i=>i.name==='Bob');assert.deepEqual(bob,{groupId:'g',name:'Bob',value:100});
 assert.deepEqual(Object.keys(bob).sort(),['groupId','name','value']);
 const bySession=dailyScores(profiles,sessions,gifts,['2026-10-01','2026-10-02'],{now,dayCount:'session-start'});
 assert.equal(bySession[0].groups[0].value,200);assert.equal(bySession[1].groups.reduce((n,g)=>n+g.value,0),0);
});
test('each group/day carries why the backend number is still provisional',()=>{
 const sessions=[{_id:'s1',profileId:'g',sessionStartedAt:'2026-10-01T20:00:00+07:00'},{_id:'s2',profileId:'g',sessionStartedAt:'2026-10-02T20:00:00+07:00'},{_id:'s3',profileId:'g',sessionStartedAt:'2026-10-03T20:00:00+07:00'}];
 const gifts=[{sessionId:'s1',cost:10,receivedTalent:'Alice',count:1}];
 const days=dailyScores(profiles,sessions,gifts,['2026-09-30','2026-10-01','2026-10-02','2026-10-03'],{now:Date.parse('2026-10-03T21:00:00+07:00'),known:new Set(['s1','s3']),active:new Set(['s3'])});
 assert.deepEqual(days.map(d=>d.status[0].reasons),[['no_session'],[],['session_unverified'],['day_open','live_now']]);
 assert.deepEqual(days[1].groups[0].reasons,[]);assert.equal(days[1].groups[0].provisional,true);
 for(const d of days)for(const r of d.status[0].reasons)assert.ok(REASONS[r]);
 // Ngày 10-03 chỉ chốt lúc 07:00 sáng 10-04.
 const later=dailyScores(profiles,sessions,gifts,['2026-10-03'],{now:Date.parse('2026-10-04T07:00:00+07:00'),known:new Set(['s3'])});
 assert.deepEqual(later[0].status[0].reasons,[]);
});
test('blank sheet cells stay missing, not zero',()=>{
 const parsed=parseSheet([['Date','Alice','Bob','Chung','TỔNG','TOTAL'],[],[46296,100,null,0,100,100]],'2026-10',['Alice','Bob']);
 assert.deepEqual(sheetDays(parsed,['Alice','Bob']),[{date:'2026-10-01',group:100,idols:{Alice:100,Bob:null}}]);
});
async function call(api,path,headers={}){
 const app=express();app.use(api);const server=app.listen(0);
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers});return{status:r.status,body:await r.json()}}finally{server.close()}
}
test('endpoint refuses without a configured token or the right bearer',async()=>{
 const db={collection:()=>{throw Error('no db access expected')}};
 assert.equal((await call(createBackstageApi({getDb:()=>db,token:''}),'/api/backstage/scores?from=2026-10-01&to=2026-10-01',{authorization:'Bearer '+TOKEN})).status,503);
 const api=createBackstageApi({getDb:()=>db,token:TOKEN});
 assert.equal((await call(api,'/api/backstage/scores?from=2026-10-01&to=2026-10-01')).status,401);
 assert.equal((await call(api,'/api/backstage/scores?from=2026-10-01&to=2026-12-31',{authorization:'Bearer '+TOKEN})).status,400);
});
test('sheets endpoint reports disconnected without reading',async()=>{
 const api=createBackstageApi({getDb:()=>({}),token:TOKEN,readProfiles:async()=>profiles,sheets:{status:async()=>({connected:false}),read:()=>{throw Error('no read')}}});
 const r=await call(api,'/api/backstage/sheets?month=2026-10',{authorization:'Bearer '+TOKEN});
 assert.equal(r.status,200);assert.equal(r.body.connected,false);
});

test('sheets write: only group workbooks, month tabs, bounded cells', () => {
  const { writeRequest, rangeCells } = require('../backstageApi');
  const vvg = '17ksmH7zVysl8mPO2kq5v4vlSt3WklKJpIp5qKZUdWKs';
  assert.equal(rangeCells("'THÁNG 11.2026'!B5"), 1);
  assert.equal(rangeCells("'THÁNG 11.2026'!B5:O5"), 14);
  assert.equal(writeRequest({ spreadsheetId: 'x'.repeat(44), data: [] }).error, 'not_allowed_spreadsheet');
  assert.equal(writeRequest({ spreadsheetId: vvg, data: [{ range: "'Trang tính1'!A1", values: [['1']] }] }).error, 'invalid_request');
  assert.equal(writeRequest({ spreadsheetId: vvg, data: [{ range: "'THÁNG 11.2026'!B5", values: [['1', '2']] }] }).error, 'invalid_request');
  assert.equal(writeRequest({ spreadsheetId: vvg, data: [{ range: "'THÁNG 11.2026'!A1:Z60", values: [] }] }).error, 'invalid_request');
  const ok = writeRequest({ spreadsheetId: vvg, data: [{ range: "'THÁNG 11.2026'!B5:C5", values: [[30050, '50700']] }], reason: 'r1' });
  assert.equal(ok.error, undefined);
  assert.equal(ok.valueInputOption, 'USER_ENTERED');
});

test('avatars: talent pictures only, paths normalized, unsafe values dropped', async () => {
 const profiles=[{_id:'g1',name:'HT - VVG',talents:{Yiin:{avatarUrl:'userdata/avatars/yiin.jpg',uniqueId:'yiin'},Aliz:{avatarUrl:'avatars/aliz.jpg'},Bad:{avatarUrl:'javascript:alert(1)'},Cdn:{avatarUrl:'https://p16.tiktokcdn.com/x.jpg'}}}];
 const api=createBackstageApi({getDb:()=>({}),token:TOKEN,readProfiles:async()=>profiles,sheets:{status:async()=>({connected:false})}});
 const r=await call(api,'/api/backstage/avatars',{authorization:'Bearer '+TOKEN});
 assert.equal(r.status,200);
 const by=Object.fromEntries(r.body.talents.map(t=>[t.name,t.avatar]));
 assert.equal(by.Yiin,'/userdata/avatars/yiin.jpg');
 assert.equal(by.Aliz,'/userdata/avatars/aliz.jpg');
 assert.equal(by.Bad,'');
 assert.equal(by.Cdn,'https://p16.tiktokcdn.com/x.jpg');
 assert.equal((await call(api,'/api/backstage/avatars')).status,401);
});

test('avatars: uses the server avatar resolver (files fetched onto the ranking disk by TikTok username)', async () => {
 const profiles=[{_id:'g1',name:'HT - VVG',talents:{Yiin:{avatarUrl:'userdata/avatars/old.jpg',uniqueId:'yiin.tt'}}}];
 const api=createBackstageApi({getDb:()=>({}),token:TOKEN,readProfiles:async()=>profiles,sheets:{status:async()=>({connected:false})},resolveAvatar:(url,uid)=>uid==='yiin.tt'?'userdata/avatars/yiin.tt_1.jpg':url});
 const r=await call(api,'/api/backstage/avatars',{authorization:'Bearer '+TOKEN});
 assert.equal(r.body.talents[0].avatar,'/userdata/avatars/yiin.tt_1.jpg');
});

test('avatar file route: token required, outside the data rate limit, only known files', async () => {
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'av-'));fs.writeFileSync(path.join(dir,'a.jpg'),'JPEGDATA');
 const api=createBackstageApi({getDb:()=>({}),token:TOKEN,readProfiles:async()=>[],sheets:{status:async()=>({connected:false})},avatarFile:(n)=>n==='a.jpg'?path.join(dir,'a.jpg'):null});
 const app=express();app.use(api);const server=app.listen(0);
 try{
  const base=`http://127.0.0.1:${server.address().port}/api/backstage-files/avatar/`;
  assert.equal((await fetch(base+'a.jpg')).status,401);
  const ok=await fetch(base+'a.jpg',{headers:{authorization:'Bearer '+TOKEN}});
  assert.equal(ok.status,200);assert.equal(await ok.text(),'JPEGDATA');
  assert.equal((await fetch(base+'b.jpg',{headers:{authorization:'Bearer '+TOKEN}})).status,404);
 }finally{server.close()}
});

test('scores ?count: Backstage asks for session-start regardless of the board; bad value rejected',async()=>{
 const {dayCountOf}=require('../backstageApi');
 assert.equal(dayCountOf('session','gift-time'),'session-start');
 assert.equal(dayCountOf('gift','session-start'),'gift-time');
 assert.equal(dayCountOf('',undefined),undefined);
 assert.equal(dayCountOf('','session-start'),'session-start');
 const db={collection:()=>{throw Error('no db access expected')}};
 const api=createBackstageApi({getDb:()=>db,token:TOKEN});
 assert.equal((await call(api,'/api/backstage/scores?from=2026-10-01&to=2026-10-01&count=hourly',{authorization:'Bearer '+TOKEN})).status,400);
});

test('sheets/read: month ranges of a group workbook, values + formulas (POST)', async () => {
 const {GROUP_SHEETS}=require('../groupSheets');
 const id=GROUP_SHEETS[0].spreadsheetId,reads=[];
 const api=createBackstageApi({getDb:()=>({}),token:TOKEN,readProfiles:async()=>profiles,sheets:{status:async()=>({connected:true,canWrite:true}),read:async(o)=>{reads.push(o.render);return{range:o.range,values:[[o.render]]}}}});
 const app=express();app.use(api);const server=app.listen(0);
 try{
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/backstage/sheets/read`,{method:'POST',headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json'},body:JSON.stringify({spreadsheetId:id,ranges:["'THÁNG 11.2026'!B5"]})});
  const body=await r.json();
  assert.equal(r.status,200);assert.equal(body.ok,true);
  assert.deepEqual(body.valueRanges[0].values,[['FORMATTED_VALUE']]);assert.deepEqual(body.formulas[0].values,[['FORMULA']]);
 }finally{server.close()}
});
