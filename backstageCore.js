'use strict';
// Phần thuần (không Express, không Google) của API cho Helios Backstage: tính KC theo ngày, phiên live,
// kiểm yêu cầu ghi Sheet. Backstage chép NGUYÊN file này (và các module nó cần) để tự đọc MongoDB
// HeliosControl giống hệt ranking — sửa ở đây thì chạy lại scripts/sync-ranking-core.mjs bên Backstage.
const crypto=require('node:crypto');
const {GROUP_SHEETS}=require('./groupSheets');
const {WORKDAY_HOUR,giftCutoff,giftDay,groupResetHours,partitionSessions,dayStart,scoreRows,sessionGiftPipeline,liveGroups}=require('./rankingNext');
const {decodeGiftBuckets}=require('./leaderboardPerformance');
const DAY=86400000,MAX_DAYS=62,MAX_SHIFT=14*3600000,MAX_WRITE_CELLS=200,MAX_READ_RANGES=10;
const ALLOWED_SHEETS=new Set(GROUP_SHEETS.map(s=>s.spreadsheetId));
// 'THÁNG 11.2026'!B5 or 'THÁNG 11.2026'!A1:Z60 — month tabs only.
const MONTH_RANGE=/^'TH(Á|A)NG \d{1,2}\.\d{4}'!\$?[A-Z]{1,3}\$?\d{1,4}(:\$?[A-Z]{1,3}\$?\d{1,4})?$/;
const colNum=c=>[...c].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);
function rangeCells(range){
  const m=range.replace(/\$/g,'').match(/!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);if(!m)return Infinity;
  const c1=colNum(m[1]),r1=+m[2],c2=m[3]?colNum(m[3]):c1,r2=m[4]?+m[4]:r1;
  return c2<c1||r2<r1?Infinity:(c2-c1+1)*(r2-r1+1);
}
function writeRequest(body){
  if(!body||typeof body!=='object'||!ALLOWED_SHEETS.has(body.spreadsheetId))return{error:'not_allowed_spreadsheet'};
  const data=Array.isArray(body.data)?body.data:null;if(!data||!data.length||data.length>MAX_WRITE_CELLS)return{error:'invalid_request'};
  let cells=0;
  for(const d of data){
    if(typeof d?.range!=='string'||!MONTH_RANGE.test(d.range.normalize('NFC'))||!Array.isArray(d.values))return{error:'invalid_request'};
    const n=rangeCells(d.range),rows=d.values;
    if(!rows.every(r=>Array.isArray(r)&&r.every(v=>v===null||typeof v==='number'||(typeof v==='string'&&v.length<=500))))return{error:'invalid_request'};
    if(rows.reduce((a,r)=>a+r.length,0)>n)return{error:'invalid_request'};
    cells+=n;if(cells>MAX_WRITE_CELLS)return{error:'invalid_request'};
  }
  const valueInputOption=body.valueInputOption==='RAW'?'RAW':'USER_ENTERED';
  return{spreadsheetId:body.spreadsheetId,data:data.map(d=>({range:d.range.normalize('NFC'),values:d.values})),valueInputOption,reason:typeof body.reason==='string'?body.reason.slice(0,100):''};
}
const sha=value=>crypto.createHash('sha256').update(String(value)).digest();
const isDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function dateRange(from,to){
  if(!isDate(from)||!isDate(to)||from>to)return null;
  const days=[];for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=DAY)days.push(new Date(t).toISOString().slice(0,10));
  return days.length>MAX_DAYS?null:days;
}
function tokenMatches(header,token){
  const given=/^Bearer\s+(\S+)$/.exec(header||'')?.[1];
  return Boolean(given&&token)&&crypto.timingSafeEqual(sha(given),sha(token));
}
// Why a backend day is still provisional (tạm tính). Same rules as the Sheet
// reconciliation: only closed days whose sessions the day-aware publisher saw are comparable.
const REASONS=Object.freeze({
  day_open:'Ngày vận hành chưa chốt (bảng tính quà tới 07:00 sáng hôm sau)',
  live_now:'Nhóm đang live — phiên chưa đóng',
  session_unverified:'Có phiên do bộ điều khiển cũ ghi (có thể dùng lại một phiên cho nhiều ngày) — số theo ngày chưa chắc',
  no_session:'Không có phiên live nào được ghi trong ngày'
});
function dayReasons(profileId,date,sessions,keyOf,{now,cutoff,known,active}){
  const mine=sessions.filter(s=>String(s.profileId)===String(profileId)&&keyOf.get(String(s._id))===date),reasons=[];
  // Ngày "date" chốt khi tới giờ cut-off (07:00) của sáng hôm sau.
  if(now<dayStart(date,cutoff)+DAY)reasons.push('day_open');
  if(mine.some(s=>active.has(String(s._id))))reasons.push('live_now');
  if(mine.some(s=>!known.has(String(s._id))))reasons.push('session_unverified');
  if(!mine.length)reasons.push('no_session');
  return{sessions:mine.length,reasons};
}
// Same day attribution as the board (rankingNext createNextRanking, 06:00 workday):
// 'gift-time' (default) counts each gift by its own time with the 07:00 cut-off;
// 'session-start' counts whole sessions by their shift's start day (group reset hours apply).
function dailyScores(profiles,sessions,gifts,days,context={}){
  const now=context.now??Date.now(),mode=context.dayCount==='session-start'?'session-start':'gift-time',resetHour=WORKDAY_HOUR,cutoff=giftCutoff(resetHour);
  const groupHours=mode==='gift-time'?{}:groupResetHours(profiles,resetHour,context.rules||null);
  const part=partitionSessions(sessions,now,resetHour,{groupHours}),keyOf=part.keys;
  const owners=Object.fromEntries(sessions.map(s=>[String(s._id),s.profileId]));
  const dayOf=g=>mode==='gift-time'?giftDay(g,part,owners,cutoff):keyOf.get(String(g.sessionId));
  const ctx={now,cutoff:mode==='gift-time'?cutoff:resetHour,known:context.known||new Set(),active:context.active||new Set()};
  return days.map(date=>{
    const scored=scoreRows(profiles,gifts.filter(g=>dayOf(g)===date),sessions);
    const status=profiles.map(p=>({groupId:String(p._id),...dayReasons(p._id,date,sessions,keyOf,ctx)}));
    const reasonsOf=new Map(status.map(s=>[s.groupId,s.reasons]));
    return{date,groups:scored.group.map(({groupId,name,value})=>({groupId,name,value,provisional:true,reasons:reasonsOf.get(groupId)||[]})),idols:scored.individual.map(({groupId,name,value})=>({groupId,name,value})),status};
  });
}
// ?count=session (Backstage): whole sessions by shift start day regardless of the board setting;
// ?count=gift: gift time; absent: follow the board's dayCount.
function dayCountOf(count,board){
  if(count==='session')return'session-start';
  if(count==='gift')return'gift-time';
  return board;
}
// Blank cells stay null (missing), never 0.
function sheetDays(parsed,names){
  return parsed.days.map(day=>({date:day.date,group:day.group,idols:Object.fromEntries(names.map(n=>[n,day.provided[n]?day.individual[n]:null]))}));
}
// Số KC theo ngày từ MongoDB — cùng truy vấn với /api/backstage/scores.
async function scoresData({db,profiles,days,count='',board=null,now=Date.now()}){
  const lo=new Date(dayStart(days[0],WORKDAY_HOUR)-DAY-MAX_SHIFT),hi=new Date(dayStart(days.at(-1),WORKDAY_HOUR)+2*DAY);
  const sessions=await db.collection('sessions').find({$or:[{createdAt:{$gte:lo,$lt:hi}},{sessionStartedAt:{$gte:lo,$lt:hi}}]},{projection:{profileId:1,createdAt:1,sessionStartedAt:1,sessionName:1,updatedAt:1}}).toArray();
  const [gifts,live]=await Promise.all([sessions.length?db.collection('gifts').aggregate(sessionGiftPipeline(sessions.map(s=>s._id)),{allowDiskUse:true,maxTimeMS:60000}).toArray().then(decodeGiftBuckets):[],
    db.collection('leaderboard_live').find({source:'helioscontrol',liveSince:{$gte:lo}},{projection:{sessionId:1,profileId:1,live:1,heartbeatAt:1,liveSince:1}}).toArray()]);
  const context={now,dayCount:dayCountOf(count,board?.dayCount),rules:board?.rules,known:new Set(live.map(s=>String(s.sessionId))),active:new Set(live.filter(s=>liveGroups([s],now).size).map(s=>String(s.sessionId)))};
  // Backend numbers are always provisional: TikTok's closed figures are not available here.
  return{status:'ok',source:'helioscontrol',asOf:new Date(now).toISOString(),resetHour:WORKDAY_HOUR,attribution:context.dayCount==='session-start'?'session-start':'gift-time',provisional:true,reasonLabels:REASONS,
    groups:profiles.map(p=>({groupId:String(p._id),name:p.name,idols:Object.keys(p.talents||{})})),days:dailyScores(profiles,sessions,gifts,days,context)};
}
// Giờ bắt đầu phiên live theo nhóm — cùng truy vấn với /api/backstage/sessions.
async function sessionsData({db,profiles,days}){
  const lo=new Date(Date.parse(days[0]+'T00:00:00+07:00')),hi=new Date(Date.parse(days.at(-1)+'T00:00:00+07:00')+DAY);
  const sessions=await db.collection('sessions').find({$or:[{sessionStartedAt:{$gte:lo,$lt:hi}},{sessionStartedAt:null,createdAt:{$gte:lo,$lt:hi}}]},{projection:{profileId:1,createdAt:1,sessionStartedAt:1,updatedAt:1}}).toArray();
  const names=new Map(profiles.map(p=>[String(p._id),p.name]));
  return{status:'ok',from:days[0],to:days.at(-1),sessions:sessions.map(s=>({groupId:String(s.profileId),name:names.get(String(s.profileId))||'',startedAt:new Date(s.sessionStartedAt||s.createdAt).toISOString(),lastUpdateAt:s.updatedAt?new Date(s.updatedAt).toISOString():null}))};
}
// Hồ sơ nhóm như ranking đọc (bỏ "new profile" tạo nhầm).
async function readProfiles(db){
  const all=await db.collection('profiles').find({},{projection:{name:1,avatar:1,username:1,talents:1,updatedAt:1,locationId:1}}).toArray();
  return all.filter(p=>(p.name||'').toLowerCase().trim()!=='new profile');
}
module.exports={DAY,MAX_DAYS,MAX_SHIFT,MAX_WRITE_CELLS,MAX_READ_RANGES,ALLOWED_SHEETS,MONTH_RANGE,rangeCells,writeRequest,dateRange,tokenMatches,REASONS,dayReasons,dailyScores,dayCountOf,sheetDays,scoresData,sessionsData,readProfiles};
