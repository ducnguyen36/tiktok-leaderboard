'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createLiveJournal}=require('../liveJournal');

const T=Date.parse('2026-11-04T12:00:00Z'),M=60000;
const doc=(o)=>({_id:'pub1',source:'helioscontrol',profileId:'g1',sessionId:'s1',liveSince:new Date(T),...o});

test('live journal: up, drop with liveEndedAt, reconnect on same lease, stale close', () => {
  let now=T;const j=createLiveJournal({clock:()=>now});
  j.ingest(doc({live:true,heartbeatAt:new Date(T)}));
  now=T+30*M;j.ingest(doc({live:true,heartbeatAt:new Date(now)}));
  let seg=j.segments(T-M,T+DAY(),now);
  assert.equal(seg.length,1);assert.equal(seg[0].end,null);
  // TikTok rớt lúc +40 phút.
  now=T+41*M;j.ingest(doc({live:false,heartbeatAt:new Date(now),liveEndedAt:new Date(T+40*M)}));
  seg=j.segments(T-M,T+DAY(),now);
  assert.equal(seg[0].end,new Date(T+40*M).toISOString());
  // Nối lại cùng lease lúc +52 phút → đoạn mới bắt đầu ở heartbeat đó.
  now=T+52*M;j.ingest(doc({live:true,heartbeatAt:new Date(now)}));
  seg=j.segments(T-M,T+DAY(),now);
  assert.equal(seg.length,2);assert.equal(seg[1].start,new Date(T+52*M).toISOString());assert.equal(seg[1].end,null);
  // Máy tắt ngang: không heartbeat nữa → đóng ở heartbeat cuối.
  now=T+55*M;j.ingest(doc({live:true,heartbeatAt:new Date(now)}));
  now=T+60*M;j.expire(now);
  seg=j.segments(T-M,T+DAY(),now);
  assert.equal(seg[1].end,new Date(T+55*M).toISOString());
});

test('live journal: rebuilds a finished stretch seen only after the fact; new lease starts at liveSince', () => {
  let now=T+3*3600000;const j=createLiveJournal({clock:()=>now});
  j.ingest(doc({live:false,heartbeatAt:new Date(T+2*3600000),liveEndedAt:new Date(T+2*3600000)}));
  j.ingest(doc({_id:'pub2',live:true,liveSince:new Date(T+2.5*3600000),heartbeatAt:new Date(now-10000)}));
  const seg=j.segments(T-M,T+DAY(),now);
  assert.deepEqual(seg.map(s=>[s.start,s.end]),[[new Date(T).toISOString(),new Date(T+2*3600000).toISOString()],[new Date(T+2.5*3600000).toISOString(),null]]);
  // Bản ghi cũ đọc lại không tạo đoạn trùng.
  j.ingest(doc({live:false,heartbeatAt:new Date(T+2*3600000),liveEndedAt:new Date(T+2*3600000)}));
  assert.equal(j.segments(T-M,T+DAY(),now).length,2);
});

test('live journal: persists to file and reloads', () => {
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'lj-')),'j.jsonl');
  let now=T;const a=createLiveJournal({file,clock:()=>now});
  a.ingest(doc({live:true,heartbeatAt:new Date(T)}));
  now=T+20*M;a.ingest(doc({live:false,heartbeatAt:new Date(now),liveEndedAt:new Date(now)}));
  const b=createLiveJournal({file,clock:()=>now});
  assert.deepEqual(b.segments(T-M,T+DAY(),now),a.segments(T-M,T+DAY(),now));
  assert.equal(fs.readFileSync(file,'utf8').trim().split('\n').length,1);
});

function DAY(){return 86400000}

test('live journal: initial segments + drain returns only changed ones', () => {
  let now=T+10*M;
  const a=createLiveJournal({clock:()=>now,initial:[{pub:'pub1',gid:'g1',sid:'s1',since:T,start:T,end:null,lastBeat:T+9*M}]});
  assert.equal(a.drain().length,0);
  a.ingest(doc({live:false,heartbeatAt:new Date(now),liveEndedAt:new Date(T+10*M)}));
  const changed=a.drain();
  assert.equal(changed.length,1);assert.equal(changed[0].end,T+10*M);
  assert.equal(a.drain().length,0);
});
