'use strict';
// Nhật ký lên / xuống live theo nhóm cho Backstage (đúng giờ, gián đoạn giữa ca, lên lại nhanh không).
// Nguồn: leaderboard_live do HeliosControl ghi (mỗi bộ điều khiển một bản ghi, heartbeat 30 giây,
// `live` = đang nối TikTok, `liveEndedAt` = lúc mất kết nối). Mongo CHỈ ĐỌC; nhật ký lưu file JSONL
// trên ổ của ranking (bản ghi Mongo chỉ giữ đoạn live mới nhất của mỗi bộ điều khiển).
const fs=require('node:fs');
const path=require('node:path');
const STALE=90000,KEEP_DAYS=62,DAY=86400000;

// Một đoạn live: {pub, gid, sid, since, start, end|null, lastBeat}. `since` = liveSince của bộ điều khiển
// (khoá cùng `pub`); `start` = lúc lên thật (bằng since, hoặc lúc nối lại nếu rớt rồi nối lại cùng lease).
// `initial`: các đoạn đã lưu nơi khác (Backstage lưu trong database) thay cho file; `drain()` trả các đoạn
// vừa thêm/đổi kể từ lần gọi trước để nơi đó lưu lại.
function createLiveJournal({file=null,clock=Date.now,keepDays=KEEP_DAYS,initial=[]}={}){
  const segs=new Map(),open=new Map(),dirty=new Map();
  const key=s=>`${s.pub}|${s.start}`;
  const save=s=>{if(!file)return;try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,JSON.stringify(s)+'\n')}catch{}};
  function put(s){segs.set(key(s),s);dirty.set(key(s),s);if(s.end===null)open.set(s.pub,s);else if(open.get(s.pub)?.start===s.start)open.delete(s.pub);save(s)}
  function load(){
    if(!file)return;let text='';try{text=fs.readFileSync(file,'utf8')}catch{return}
    const cut=clock()-keepDays*DAY;
    for(const line of text.split('\n')){if(!line)continue;let s;try{s=JSON.parse(line)}catch{continue}
      if(!s||typeof s.pub!=='string'||!Number.isFinite(s.start))continue;segs.set(key(s),s)}
    for(const [k,s] of segs)if((s.end??s.lastBeat??s.start)<cut)segs.delete(k);
    for(const s of segs.values())if(s.end===null)open.set(s.pub,s);
    // Viết gọn lại: mỗi đoạn một dòng.
    try{fs.writeFileSync(file,[...segs.values()].map(s=>JSON.stringify(s)).join('\n')+(segs.size?'\n':''))}catch{}
  }
  /** Một bản ghi leaderboard_live (từ change stream hoặc lần quét định kỳ). */
  function ingest(doc,now=clock()){
    if(!doc||doc.source!=='helioscontrol'||!doc.profileId)return;
    const pub=String(doc._id),gid=String(doc.profileId),sid=doc.sessionId?String(doc.sessionId):null;
    const since=+new Date(doc.liveSince),beat=+new Date(doc.heartbeatAt);
    if(!Number.isFinite(since)||!Number.isFinite(beat))return;
    const fresh=beat<=now+5000&&now-beat<STALE,up=doc.live===true&&fresh,cur=open.get(pub);
    if(up){
      if(cur&&cur.since===since){if(beat>cur.lastBeat)cur.lastBeat=beat;
        // Ghi heartbeat ra file mỗi 5 phút: ranking khởi động lại giữa ca vẫn biết đoạn kéo tới đâu.
        if(cur.lastBeat-(cur.savedBeat||cur.start)>=300000){cur.savedBeat=cur.lastBeat;dirty.set(key(cur),cur);save(cur)}return}
      if(cur)put({...cur,end:cur.lastBeat});
      // Cùng lease đã có đoạn trước (rớt rồi nối lại) → lên lại lúc heartbeat này; lease mới → liveSince.
      const again=[...segs.values()].some(s=>s.pub===pub&&s.since===since);
      put({pub,gid,sid,since,start:again?beat:since,end:null,lastBeat:beat});
      return;
    }
    const end=doc.live===false?+new Date(doc.liveEndedAt||doc.heartbeatAt):beat;
    if(cur){put({...cur,end:Math.max(cur.start,Number.isFinite(end)?end:cur.lastBeat),lastBeat:Math.max(cur.lastBeat,beat)});return}
    // Chưa thấy đoạn này lúc đang live (ranking khởi động sau) → dựng lại từ bản ghi.
    if(![...segs.values()].some(s=>s.pub===pub&&s.since===since))put({pub,gid,sid,since,start:since,end:Math.max(since,Number.isFinite(end)?end:beat),lastBeat:beat});
  }
  /** Đoạn đang mở mà bộ điều khiển im quá 90 giây (tắt máy / mất mạng) → đóng ở heartbeat cuối. */
  function expire(now=clock()){for(const s of [...open.values()])if(now-s.lastBeat>=STALE)put({...s,end:s.lastBeat})}
  /** Các đoạn chạm khoảng [lo, hi). */
  function segments(lo,hi,now=clock()){
    return [...segs.values()].filter(s=>s.start<hi&&(s.end??now)>lo).sort((a,b)=>a.start-b.start)
      .map(s=>({groupId:s.gid,sessionId:s.sid,start:new Date(s.start).toISOString(),end:s.end===null?null:new Date(s.end).toISOString(),lastBeatAt:new Date(s.lastBeat).toISOString()}));
  }
  load();
  for(const s of initial){if(!s||typeof s.pub!=='string'||!Number.isFinite(s.start))continue;segs.set(key(s),s);if(s.end===null)open.set(s.pub,s)}
  function drain(){const out=[...dirty.values()];dirty.clear();return out}
  return{ingest,expire,segments,drain,size:()=>segs.size};
}
module.exports={createLiveJournal,STALE};
