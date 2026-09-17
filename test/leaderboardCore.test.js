const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../public/leaderboard-core');
test('new and legacy devices start with five columns, independent idol score switches',()=>{
 const c=C.migrate({showIncome:{'individual-monthly':false,'group-daily':false},rotation:90,visibleGroups:{g:false}});
 assert.equal(c.lastMonth,false);assert.deepEqual(c.scores,[false,true,true,false,false]);assert.equal(c.groups.g,false);assert.equal(c.rotation,undefined);
 assert.equal(C.normalize({}).lastMonth,false);assert.equal(C.normalize({lastMonth:true}).lastMonth,true);
});
test('invalid stored values cannot break layout, timing or score switches',()=>{
 const c=C.normalize({scores:[false,'false'],speed:0,pause:-1,resetHour:99,freezeUntil:'26:00',tickerSpeed:'x',theme:'light',locations:{h:true,x:'yes'}});
 assert.deepEqual(c.scores,[false,true,true,true,true]);assert.equal(c.speed,10);assert.equal(c.pause,0);assert.equal(c.resetHour,23);assert.equal(c.freezeUntil,'09:00');assert.equal(c.tickerSpeed,165);assert.deepEqual(c.locations,{h:true});assert.equal(c.theme,undefined);
});
const rows=Array.from({length:14},(_,i)=>({name:'Idol '+i,value:14-i,groupId:i===0?'hidden':'g',locationId:'loc_hcm'}));
test('individual visibility survives saved settings and filters before top ten without changing group totals',()=>{
 const c=C.normalize({talents:{'Idol 0':false,'Idol 2':false,invalid:'false'}});
 const raw={individual:{daily:rows,monthly:rows,yesterday:rows},group:{daily:[rows[0]],monthly:[rows[0]]}};
 assert.equal(c.talents['Idol 0'],false);assert.equal(c.talents.invalid,undefined);
 for(const index of [1,3,4,5]){
  const selected=C.selectRows(raw,c,index,{individual:rows});
  assert.equal(selected[0].name,'Idol 1');assert.ok(!selected.some(r=>r.name==='Idol 2'));
  assert.equal(selected.length,index<4?10:12);
 }
 assert.equal(C.selectRows(raw,c,1,null,true)[0].name,'Idol 1');
 assert.equal(C.total(raw,c),14);assert.equal(C.selectRows(raw,c,0).length,1);
 assert.deepEqual(C.normalize({}).talents,{});
 assert.equal(C.normalize(JSON.parse(JSON.stringify(c))).talents['Idol 0'],false);
});
test('filter before ranking top ten, all ranking remains untruncated, total avoids double counting',()=>{
 const c=C.normalize({groups:{hidden:false}});const raw={group:{daily:[{name:'G',value:1200000,groupId:'g',locationId:'loc_hcm'}]},individual:{monthly:rows,daily:rows},locations:[{id:'loc_hcm'}]};
 assert.equal(C.selectRows(raw,c,3).length,10);assert.equal(C.selectRows(raw,c,4).length,13);assert.equal(C.selectRows(raw,c,3)[0].name,'Idol 1');assert.equal(C.total(raw,c),1200000);assert.equal(C.formatPoints(5270072),'5,270,072');
 assert.equal(C.selectRows(raw,C.normalize({locations:{loc_hcm:false}}),4).length,0);
});
test('sixth column uses its own source and cannot leak current month as historical data',()=>{
 const raw={individual:{monthly:rows},locations:[]};const c=C.normalize({locations:{}});
 assert.deepEqual(C.selectRows(raw,c,5,null),[]);assert.equal(C.selectRows(raw,c,5,{individual:[{name:'Prior',value:10}]}).length,1);
});
test('Vietnam calendar history target independent of display grace',()=>{
 assert.equal(C.historyMonth(new Date('2026-09-30T17:00:00Z')),'2026-09');
 assert.equal(C.historyMonth(new Date('2026-12-31T17:00:00Z')),'2026-12');
});
test('history cache accepts only complete exact-month aggregation v2 snapshots',()=>{
 const h={aggregationVersion:2,period:{month:'2026-08',start:'2026-08-01T00:00:00.000Z',end:'2026-09-01T00:00:00.000Z',complete:true},data:{individual:[],group:[]}};
 assert.equal(C.historyValid(h,'2026-08'),true);assert.equal(C.historyValid({...h,aggregationVersion:1},'2026-08'),false);assert.equal(C.historyValid(h,'2026-07'),false);assert.equal(C.historyValid({...h,period:{...h.period,complete:false}},'2026-08'),false);assert.equal(C.historyValid({...h,period:{...h.period,end:'2026-08-31T17:00:00.000Z'}},'2026-08'),false);
});
test('scroll pauses at both endpoints and does not animate a fitting list',()=>{
 assert.equal(C.scrollFrames(0,60,2),null);const a=C.scrollFrames(600,60,2);assert.equal(a.duration,24000);assert.equal(a.frames[0].transform,'translateY(0px)');assert.equal(a.frames[1].offset,2/24);assert.equal(a.frames[2].offset,12/24);assert.equal(a.frames[3].offset,14/24);assert.equal(a.frames[4].transform,'translateY(0px)');
});
