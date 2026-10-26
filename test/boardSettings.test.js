const test=require('node:test'),assert=require('node:assert/strict');
const {createBoardSettings,validRules}=require('../boardSettings');
const {groupResetHours,sessionWorkday,shiftStarts}=require('../rankingNext');
const {comparableDay}=require('../sheetReconciliation');
function memoryDb(){const docs=new Map();return{docs,collection(){return{findOne:async q=>docs.get(q._id)||null,replaceOne:async(q,doc)=>{docs.set(q._id,doc)}}}}}
test('broadcast settings are versioned, validated and kept per administrator save',async()=>{
 const db=memoryDb(),store=createBoardSettings({getDb:()=>db,clock:()=>Date.parse('2026-10-26T12:00:00Z')});
 assert.equal(await store.current(),null);assert.equal(store.version(),0);assert.equal(store.groupRules(),null);
 const first=await store.save({config:{layout:'classic',scores:[false,true,true,true,true]},groupResetHours:{'1775430662791':18}},'kimlinh727@gmail.com');
 assert.equal(first.version,1);assert.equal(first.updatedBy,'kimlinh727@gmail.com');assert.deepEqual(store.groupRules(),{'1775430662791':18});
 const second=await store.save({groupResetHours:{}},'ducnguyen36@gmail.com');assert.equal(second.version,2);assert.equal(second.config.layout,'classic','config kept when only rules change');assert.deepEqual(store.groupRules(),{});
 await assert.rejects(store.save({groupResetHours:{g:24}}),RangeError);await assert.rejects(store.save({config:[1]}),RangeError);await assert.rejects(store.save({config:{big:'x'.repeat(30000)}}),RangeError);
 assert.equal(validRules({'a b':6}),null);assert.deepEqual(validRules({g:0}),{g:0});
 const reloaded=createBoardSettings({getDb:()=>db});assert.equal((await reloaded.current()).version,2);
});
test('group reset rules replace the DPM default; an empty rule set means every group resets at 06:00',()=>{
 const profiles=[{_id:'dpm',name:'HT - DPM ( tuyen thanh vien )'},{_id:'aura',name:'HT - AURA'}];
 assert.deepEqual(groupResetHours(profiles,6),{dpm:18});assert.deepEqual(groupResetHours(profiles,6,{aura:9}),{aura:9});assert.deepEqual(groupResetHours(profiles,6,{}),{});
 assert.deepEqual(groupResetHours(profiles,0,{aura:9}),{},'exceptions belong to the 06:00 workday only');
 const at=value=>Date.parse(value);assert.equal(sessionWorkday(at('2026-10-09T13:00:00+07:00'),'dpm',{dpm:18}),'2026-10-08');assert.equal(sessionWorkday(at('2026-10-09T13:00:00+07:00'),'aura',{dpm:18}),'2026-10-09');
});
test('sheet check counts DPM overtime after 06:00 on the shift day',()=>{
 const sessions=[{_id:'night',profileId:'dpm',createdAt:'2026-10-08T21:00:00+07:00'},{_id:'overtime',profileId:'dpm',createdAt:'2026-10-09T13:00:00+07:00'}];
 const known=new Set(['night','overtime']),active=new Set(),starts=shiftStarts(sessions);
 assert.equal(comparableDay('2026-10-08','dpm',sessions,known,active,starts,{dpm:18}),true);
 assert.equal(comparableDay('2026-10-09','dpm',sessions,known,active,starts,{dpm:18}),false,'no DPM session belongs to 09/10 yet');
 assert.equal(comparableDay('2026-10-09','dpm',sessions,known,active,starts,{}),true,'with 06:00 the overtime would be a new day');
});
