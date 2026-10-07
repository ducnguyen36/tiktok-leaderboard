const test=require('node:test'),assert=require('node:assert/strict');
const {dayKey,dayStart,sessionStart,partitionSessions,liveGroups,scoreRows,sessionGiftPipeline,createNextRanking}=require('../rankingNext');
const N=require('../public/next-core');
const profiles=[{_id:'g',name:'HT - AURA',locationId:'loc_hcm',talents:{Alice:{},Bob:{}}}];
test('daily 06:00 is Vietnam session-start time, independent from monthly 07:00',()=>{
 assert.equal(dayKey('2026-10-07T05:59:59+07:00'),'2026-10-06');assert.equal(dayKey('2026-10-07T06:00:00+07:00'),'2026-10-07');
 assert.equal(dayStart('2026-10-07'),Date.parse('2026-10-06T23:00:00Z'));
 assert.equal(sessionStart({sessionName:'20261007_055959'}),Date.parse('2026-10-07T05:59:59+07:00'));
 assert.equal(partitionSessions([{_id:'s',createdAt:'2026-10-07T05:00:00+07:00'}],Date.parse('2026-10-07T07:00:00+07:00')).keys.get('s'),'2026-10-06');
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
 assert.equal(N.normalize({}).resetHour,6);assert.equal(N.normalize({}).freezeUntil,'');assert.equal(N.normalize({}).layout,'podium');
 const migrated=N.migrate(null,{layout:'classic',resetHour:0,freezeUntil:'09:00',pause:5,tickerSpeed:100,celebrationSound:false});assert.equal(migrated.layout,'podium');assert.equal(migrated.resetHour,6);assert.equal(migrated.pause,5);assert.equal(migrated.tickerSpeed,100);assert.equal(migrated.celebrationSound,false);
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
 const result=await service.get();assert.equal(result.data.group.daily[0].value,100);assert.equal(result.data.group.yesterday[0].value,200);assert.equal(result.data.individual.monthly[0].value,999);assert.deepEqual(pipeline[0].$match.sessionId.$in,['before','after']);
 assert.equal(result.data.individual.daily.find(e=>e.name==='Alice').yesterday.value,200);
 const frozen=await service.get(false,{resetHour:6,freezeUntil:'09:00'});assert.equal(frozen.data.frozen,true);assert.equal(frozen.data.group.daily[0].value,200);
 const live=await service.get(false,{resetHour:6,freezeUntil:''});assert.equal(live.data.frozen,false);assert.equal(live.data.group.daily[0].value,100);
 const midnight=await service.get(false,{resetHour:0});assert.equal(midnight.data.group.daily[0].value,300);assert.equal(midnight.data.dailyPeriod.resetHour,0);assert.equal(midnight.data.individual.monthly[0].value,999);
 await assert.rejects(service.get(false,{resetHour:24}),RangeError);await assert.rejects(service.get(false,{freezeUntil:'24:00'}),RangeError);
});
