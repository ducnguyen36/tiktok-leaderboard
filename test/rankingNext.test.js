const test=require('node:test'),assert=require('node:assert/strict');
const {dayKey,dayStart,sessionStart,partitionSessions,liveGroups,scoreRows,sessionGiftPipeline,createNextRanking}=require('../rankingNext');
const N=require('../public/next-core');
const profiles=[{_id:'g',name:'HT - AURA',locationId:'loc_hcm',talents:{Alice:{},Bob:{}}}];
test('daily reset defaults to 00:00 Vietnam session-start time; 06:00 stays selectable',()=>{
 assert.equal(dayKey('2026-10-06T23:59:59+07:00'),'2026-10-06');assert.equal(dayKey('2026-10-07T00:00:00+07:00'),'2026-10-07');
 assert.equal(dayStart('2026-10-07'),Date.parse('2026-10-06T17:00:00Z'));
 const night=partitionSessions([{_id:'night',createdAt:'2026-10-07T01:00:00+07:00'},{_id:'late',createdAt:'2026-10-06T23:00:00+07:00'}],Date.parse('2026-10-07T09:00:00+07:00'));
 assert.equal(night.keys.get('night'),'2026-10-07');assert.equal(night.keys.get('late'),'2026-10-06');
 assert.equal(dayKey('2026-10-07T05:59:59+07:00',6),'2026-10-06');assert.equal(dayKey('2026-10-07T06:00:00+07:00',6),'2026-10-07');
 assert.equal(dayStart('2026-10-07',6),Date.parse('2026-10-06T23:00:00Z'));
 assert.equal(sessionStart({sessionName:'20261007_055959'}),Date.parse('2026-10-07T05:59:59+07:00'));
 assert.equal(partitionSessions([{_id:'s',createdAt:'2026-10-07T05:00:00+07:00'}],Date.parse('2026-10-07T07:00:00+07:00')).keys.get('s'),'2026-10-07');
 assert.equal(partitionSessions([{_id:'s',createdAt:'2026-10-07T05:00:00+07:00'}],Date.parse('2026-10-07T07:00:00+07:00'),6).keys.get('s'),'2026-10-06');
});
test('live requires an explicit connected lease; silence/crash expires after 90 seconds',()=>{
 const now=Date.now();assert.equal(liveGroups([{profileId:'g',heartbeatAt:now,live:true}],now).size,1);
 for(const state of [{profileId:'g',heartbeatAt:now-90000,live:true},{profileId:'g',heartbeatAt:now,live:false},{profileId:'g',updatedAt:now},{profileId:'g',heartbeatAt:now+6000,live:true}])assert.equal(liveGroups([state],now).size,0);
 assert.equal(N.isLive({live:true,liveExpiresAt:new Date(now-1).toISOString()},now),false);
});
test('session query is not constrained by gift timestamp; group points are counted once',()=>{
 const pipeline=sessionGiftPipeline(['s']);assert.deepEqual(pipeline[0],{$match:{sessionId:{$in:['s']}}});
 const result=scoreRows(profiles,[{sessionId:'s',cost:200,receivedTalent:'Alice',count:1},{sessionId:'s',cost:100,receivedTalent:'HT - AURA',count:1},{sessionId:'s',cost:-10,receivedTalent:'Bob',count:1}],[{_id:'s',profileId:'g'}]);
 assert.equal(result.group[0].value,290);assert.equal(result.individual.find(e=>e.name==='Alice').value,250);assert.equal(result.individual.find(e=>e.name==='Bob').value,40);
});
test('new settings preserve visibility but isolate daily defaults and Today/Last Month source',()=>{
 const c=N.normalize({groups:{g:false},resetHour:0,freezeUntil:'09:00',showDaily:false});assert.equal(c.resetHour,0);assert.equal(c.freezeUntil,'09:00');assert.equal(c.groups.g,false);assert.equal(c.showDaily,false);
 assert.equal(N.normalize({}).resetHour,0);assert.equal(N.normalize({resetHour:6}).resetHour,0,'saved old 06:00 default moves to 00:00 once');assert.equal(N.normalize({resetHour:7,dailyResetVersion:1}).resetHour,7,'later choices are kept');assert.equal(N.normalize(N.normalize({resetHour:6})).resetHour,0);assert.equal(N.normalize({}).freezeUntil,'');assert.equal(N.normalize({}).layout,'podium');
 const migrated=N.migrate(null,{layout:'classic',resetHour:0,freezeUntil:'09:00',pause:5,tickerSpeed:100,celebrationSound:false});assert.equal(migrated.layout,'podium');assert.equal(migrated.resetHour,0);assert.equal(migrated.pause,5);assert.equal(migrated.tickerSpeed,100);assert.equal(migrated.celebrationSound,false);
 assert.equal(N.migrate({...c,layout:'classic',appearanceVersion:1},null).layout,'classic');
 const raw={individual:{monthly:[{name:'Monthly',value:1,locationId:'loc_hcm'}],daily:[{name:'Today',value:2,locationId:'loc_hcm'}]},group:{daily:[{name:'Group',value:1,locationId:'loc_hcm'}]}};
 const cfg=N.normalize({});assert.equal(N.panels(raw,cfg,null)[4].rows[0].name,'Monthly');assert.equal(N.panels(raw,cfg,null)[5].rows[0].name,'Today');
 cfg.lastMonth=true;assert.equal(N.panels(raw,cfg,{data:{individual:[{name:'Prior',value:4,locationId:'loc_hcm'}],group:[]}})[5].rows[0].name,'Prior');
});
test('new service attributes a session spanning reset to yesterday and excludes orphan adjustments',async()=>{
 const now=Date.parse('2026-10-07T07:00:00+07:00'),sessions=[{_id:'before',createdAt:'2026-10-07T05:00:00+07:00',profileId:'g'},{_id:'after',createdAt:'2026-10-07T06:30:00+07:00',profileId:'g'}];
 let pipeline;const db={collection(name){return{find(){return{toArray:async()=>name==='sessions'?sessions:[]}},aggregate(p){pipeline=p;return{toArray:async()=>[{gift:{sessionId:'before',cost:200,receivedTalent:'Alice'},count:1},{gift:{sessionId:'after',cost:100,receivedTalent:'Bob'},count:1}]}}}}};
 const monthly={status:'ok',meta:{computedAt:new Date(now).toISOString()},data:{individual:{monthly:[{name:'Alice',value:999,groupId:'g'}]},group:{monthly:[]},locations:[],groups:[]}};
 const service=createNextRanking({getDb:()=>db,current:async()=>monthly,readProfiles:async()=>profiles,readLocations:async()=>[],clock:()=>now});
 const result=await service.get(false,{resetHour:6});assert.equal(result.data.group.daily[0].value,100);assert.equal(result.data.group.yesterday[0].value,200);
 const byDefault=await service.get();assert.equal(byDefault.data.dailyPeriod.resetHour,0);assert.equal(byDefault.data.group.daily[0].value,300);assert.equal(result.data.individual.monthly[0].value,999);assert.deepEqual(pipeline[0].$match.sessionId.$in,['before','after']);
 assert.equal(result.data.individual.daily.find(e=>e.name==='Alice').yesterday.value,200);
 const frozen=await service.get(false,{resetHour:6,freezeUntil:'09:00'});assert.equal(frozen.data.frozen,true);assert.equal(frozen.data.group.daily[0].value,200);
 const live=await service.get(false,{resetHour:6,freezeUntil:''});assert.equal(live.data.frozen,false);assert.equal(live.data.group.daily[0].value,100);
 const midnight=await service.get(false,{resetHour:0});assert.equal(midnight.data.group.daily[0].value,300);assert.equal(midnight.data.dailyPeriod.resetHour,0);assert.equal(midnight.data.individual.monthly[0].value,999);
 await assert.rejects(service.get(false,{resetHour:24}),RangeError);await assert.rejects(service.get(false,{freezeUntil:'24:00'}),RangeError);
});
test('smart TV browsers get the simple live mark; phones and computers keep the animation',()=>{
 assert.equal(N.isTvDevice('Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 SamsungBrowser/4.0 TV Safari/537.36'),true);
 assert.equal(N.isTvDevice('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/79.0 Safari/537.36'),true);
 assert.equal(N.isTvDevice('Mozilla/5.0 (Linux; Android 9; BRAVIA 4K VH2) AppleWebKit/537.36 Chrome/94.0 Safari/537.36'),true);
 assert.equal(N.isTvDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'),false);
 assert.equal(N.isTvDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'),false);
 assert.equal(N.isTvDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36'),false);
 assert.equal(N.isTvDevice('Mozilla/5.0 (Windows NT 10.0)', '1'),true);assert.equal(N.isTvDevice('Mozilla/5.0 (SMART-TV; Tizen)', '0'),false);
});
test('celebrations name the group or talent that crossed a daily milestone',()=>{
 const visible=new Set(['g1','Alice']);
 const first=N.milestoneHits({},[{name:'G',groupId:'g1',kind:'group',value:120000}],{step:50000,minStep:2,visible,ready:false});
 assert.deepEqual(first.hits,[],'nothing on first load');assert.equal(first.next.g1,2);
 const group=N.milestoneHits(first.next,[{name:'G',groupId:'g1',kind:'group',value:151000}],{step:50000,minStep:2,visible,ready:true});
 assert.equal(group.hits[0].entry.name,'G');assert.equal(group.hits[0].points,150000);
 const talent=N.milestoneHits({Alice:0,Bob:0},[{name:'Alice',value:52000,avatar:'/a.png'},{name:'Bob',value:60000}],{step:50000,minStep:1,visible,ready:true});
 assert.deepEqual(talent.hits.map(h=>[h.entry.name,h.points,h.entry.avatar]),[['Alice',50000,'/a.png']],'only visible talents');
 assert.deepEqual(N.milestoneHits({Alice:1},[{name:'Alice',value:90000}],{step:50000,minStep:1,visible,ready:true}).hits,[],'same milestone once');
});
test('a restart mid-shift keeps the new session on the shift day',()=>{
 const{shiftStarts,partitionSessions}=require('../rankingNext');
 const sessions=[
  {_id:'a',profileId:'dpm',createdAt:'2026-10-13T01:49:52+07:00',updatedAt:'2026-10-13T07:36:05+07:00'},
  {_id:'b',profileId:'dpm',createdAt:'2026-10-13T06:14:51+07:00',updatedAt:'2026-10-13T07:03:59+07:00'},
  {_id:'c',profileId:'dpm',createdAt:'2026-10-13T07:44:32+07:00',updatedAt:'2026-10-13T11:45:32+07:00'},
  {_id:'d',profileId:'dpm',createdAt:'2026-10-14T01:28:40+07:00',updatedAt:'2026-10-14T07:29:13+07:00'},
  {_id:'e',profileId:'other',createdAt:'2026-10-13T07:50:00+07:00',updatedAt:'2026-10-13T12:00:00+07:00'}];
 const starts=shiftStarts(sessions);
 assert.equal(starts.get('c'),Date.parse('2026-10-13T01:49:52+07:00'),'8 minutes after the shift\'s last activity');
 assert.equal(starts.get('d'),Date.parse('2026-10-14T01:28:40+07:00'),'next night is a new shift');
 assert.equal(starts.get('e'),Date.parse('2026-10-13T07:50:00+07:00'),'another group is independent');
 const keys=partitionSessions(sessions,Date.parse('2026-10-15T09:00:00+07:00'),6).keys;
 assert.deepEqual(['a','b','c','d'].map(k=>keys.get(k)),['2026-10-12','2026-10-12','2026-10-12','2026-10-13']);
});
test('sessions re-saved days later or far apart are never chained into one shift',()=>{
 const{shiftStarts}=require('../rankingNext');
 const s=[{_id:'a',profileId:'k',createdAt:'2026-10-05T07:00:00+07:00',updatedAt:'2026-10-09T10:00:00+07:00'},
  {_id:'b',profileId:'k',createdAt:'2026-10-07T07:10:00+07:00',updatedAt:'2026-10-07T13:00:00+07:00'},
  {_id:'c',profileId:'k',createdAt:'2026-10-07T13:20:00+07:00',updatedAt:'2026-10-07T23:00:00+07:00'},
  {_id:'d',profileId:'k',createdAt:'2026-10-07T23:20:00+07:00',updatedAt:'2026-10-08T03:00:00+07:00'}];
 const st=shiftStarts(s);
 assert.equal(st.get('b'),Date.parse('2026-10-07T07:10:00+07:00'),'stale last-save of 05/10 does not swallow 07/10');
 assert.equal(st.get('c'),Date.parse('2026-10-07T07:10:00+07:00'),'restart 20 minutes later is the same shift');
 assert.equal(st.get('d'),Date.parse('2026-10-07T23:20:00+07:00'),'a shift is at most 14 hours');
});
