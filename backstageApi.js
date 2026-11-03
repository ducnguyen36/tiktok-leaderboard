'use strict';
// Feed for Helios Backstage (server-to-server). Daily KC totals per group/idol
// and the group Sheets — never gifts, donors, avatars or tokens. The only write
// is /sheets/write: approved shift reports into the eight group workbooks,
// inside "THÁNG MM.YYYY" tabs, at most MAX_WRITE_CELLS cells per call.
const crypto=require('node:crypto');
const express=require('express');
const {GROUP_SHEETS,findMonthTab}=require('./groupSheets');
const {WORKDAY_HOUR,giftCutoff,giftDay,groupResetHours,partitionSessions,dayStart,scoreRows,sessionGiftPipeline,liveGroups}=require('./rankingNext');
const {parseSheet,matchingProfile}=require('./sheetReconciliation');
const {decodeGiftBuckets}=require('./leaderboardPerformance');
const {sheetsReadError}=require('./sheetsConnection');
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
// Blank cells stay null (missing), never 0.
function sheetDays(parsed,names){
  return parsed.days.map(day=>({date:day.date,group:day.group,idols:Object.fromEntries(names.map(n=>[n,day.provided[n]?day.individual[n]:null]))}));
}
function createBackstageApi({getDb,readProfiles,sheets,reconcile,settings,token,clock=Date.now}){
  const router=express.Router(),cache=new Map(),hits=new Map();
  const configured=typeof token==='string'&&token.length>=32;
  const cached=async(key,ttl,build)=>{const hit=cache.get(key);if(hit&&clock()-hit.at<ttl)return hit.value;const value=await build();cache.set(key,{at:clock(),value});if(cache.size>50)cache.delete(cache.keys().next().value);return value};
  router.use('/api/backstage',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!configured)return res.status(503).json({status:'error',message:'not_configured'});
    if(!tokenMatches(req.get('authorization'),token))return res.status(401).json({status:'error',message:'unauthorized'});
    const minute=Math.floor(clock()/60000),count=(hits.get(minute)||0)+1;hits.clear();hits.set(minute,count);
    if(count>60)return res.status(429).json({status:'error',message:'rate_limited'});
    if(!getDb())return res.status(503).json({status:'error',message:'database_unavailable'});
    next();
  });
  router.get('/api/backstage/scores',async(req,res)=>{
    const days=dateRange(req.query.from,req.query.to);
    if(!days)return res.status(400).json({status:'error',message:`from/to YYYY-MM-DD, tối đa ${MAX_DAYS} ngày`});
    try{
      res.json(await cached(`scores:${days[0]}:${days.at(-1)}`,60000,async()=>{
        const db=getDb(),lo=new Date(dayStart(days[0],WORKDAY_HOUR)-DAY-MAX_SHIFT),hi=new Date(dayStart(days.at(-1),WORKDAY_HOUR)+2*DAY);
        const [profiles,sessions]=await Promise.all([readProfiles(),db.collection('sessions').find({$or:[{createdAt:{$gte:lo,$lt:hi}},{sessionStartedAt:{$gte:lo,$lt:hi}}]},{projection:{profileId:1,createdAt:1,sessionStartedAt:1,sessionName:1,updatedAt:1}}).toArray()]);
        const [gifts,live]=await Promise.all([sessions.length?db.collection('gifts').aggregate(sessionGiftPipeline(sessions.map(s=>s._id)),{allowDiskUse:true,maxTimeMS:60000}).toArray().then(decodeGiftBuckets):[],
          db.collection('leaderboard_live').find({source:'helioscontrol',liveSince:{$gte:lo}},{projection:{sessionId:1,profileId:1,live:1,heartbeatAt:1,liveSince:1}}).toArray()]);
        const board=settings?await settings().catch(()=>null):null;
        const now=clock(),context={now,dayCount:board?.dayCount,rules:board?.rules,known:new Set(live.map(s=>String(s.sessionId))),active:new Set(live.filter(s=>liveGroups([s],now).size).map(s=>String(s.sessionId)))};
        // Backend numbers are always provisional: TikTok's closed figures are not available here.
        return{status:'ok',source:'helioscontrol',asOf:new Date(now).toISOString(),resetHour:WORKDAY_HOUR,attribution:context.dayCount==='session-start'?'session-start':'gift-time',provisional:true,reasonLabels:REASONS,
          groups:profiles.map(p=>({groupId:String(p._id),name:p.name,idols:Object.keys(p.talents||{})})),days:dailyScores(profiles,sessions,gifts,days,context)};
      }));
    }catch{res.status(500).json({status:'error',message:'scores_unavailable'})}
  });
  router.get('/api/backstage/sheets',async(req,res)=>{
    const month=String(req.query.month||'');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({status:'error',message:'month YYYY-MM'});
    try{
      const state=await sheets.status();
      if(!state.connected)return res.json({status:'ok',connected:false,month,sources:[]});
      res.json(await cached(`sheets:${month}:${await sheets.version()}`,300000,async()=>{
        const profiles=await readProfiles(),sources=[];
        // Serial reads, as the reconciliation does, to stay inside the Sheets quota.
        for(const source of GROUP_SHEETS){
          const profile=matchingProfile(profiles,source.group),base={group:source.group,groupId:profile?String(profile._id):null};
          try{
            const metadata=await sheets.read({spreadsheetId:source.spreadsheetId,metadata:true});
            const tab=findMonthTab(metadata,new Date(Date.parse(month+'-15T00:00:00Z')));
            if(!tab){sources.push({...base,state:'month_tab_missing'});continue}
            const data=await sheets.read({spreadsheetId:source.spreadsheetId,range:`'${tab.title.replace(/'/g,"''")}'!A1:U${Math.min(100,tab.gridProperties.rowCount)}`});
            let names=Object.keys(profile?.talents||{}),parsed=parseSheet(data.values||[],month,names),groupOnly=false;
            if(parsed.error==='talent_names_unmatched'){names=[];parsed=parseSheet(data.values||[],month,names);groupOnly=true}
            if(parsed.error){sources.push({...base,state:parsed.error});continue}
            sources.push({...base,state:groupOnly?'group_only':'ok',tab:tab.title,sheetUrl:`https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${tab.sheetId}`,days:sheetDays(parsed,names)});
          }catch{sources.push({...base,state:'read_failed'})}
        }
        return{status:'ok',connected:true,month,asOf:new Date(clock()).toISOString(),sources,reconciliation:reconcile?.status()||null};
      }));
    }catch{res.status(500).json({status:'error',message:'sheets_unavailable'})}
  });
  router.get('/api/backstage/sheets/status',async(req,res)=>{
    try{const s=await sheets.status();res.json({ok:true,connected:s.connected,canWrite:s.canWrite===true,email:s.email||null})}
    catch{res.status(500).json({ok:false,error:'sheets_unavailable'})}
  });
  router.post('/api/backstage/sheets/read',express.json({limit:'8kb'}),async(req,res)=>{
    const {spreadsheetId,ranges}=req.body||{};
    if(!ALLOWED_SHEETS.has(spreadsheetId))return res.status(403).json({ok:false,error:'not_allowed_spreadsheet'});
    if(!Array.isArray(ranges)||!ranges.length||ranges.length>MAX_READ_RANGES||!ranges.every(r=>typeof r==='string'&&MONTH_RANGE.test(r.normalize('NFC'))))return res.status(400).json({ok:false,error:'invalid_request'});
    try{
      if(!(await sheets.status()).connected)return res.status(403).json({ok:false,error:'sheets_not_connected'});
      const valueRanges=[],formulas=[];
      for(const range of ranges.map(r=>r.normalize('NFC'))){
        const v=await sheets.read({spreadsheetId,range,render:'FORMATTED_VALUE'}),f=await sheets.read({spreadsheetId,range,render:'FORMULA'});
        valueRanges.push({range:v.range||range,values:v.values||[]});formulas.push({range:f.range||range,values:f.values||[]});
      }
      res.json({ok:true,valueRanges,formulas});
    }catch(error){res.status(502).json({ok:false,error:'sheets_failed',code:sheetsReadError(error)})}
  });
  router.post('/api/backstage/sheets/write',express.json({limit:'64kb'}),async(req,res)=>{
    const w=writeRequest(req.body);
    if(w.error)return res.status(w.error==='not_allowed_spreadsheet'?403:400).json({ok:false,error:w.error});
    try{
      const s=await sheets.status();
      if(!s.connected)return res.status(403).json({ok:false,error:'sheets_not_connected'});
      if(!s.canWrite)return res.status(403).json({ok:false,error:'scope_readonly'});
      const out=await sheets.write(w);
      // Audit without cell values: who asked (Backstage report id), where, how many cells.
      await getDb().collection('backstage_sheet_writes').insertOne({at:new Date(clock()),spreadsheetId:w.spreadsheetId,ranges:w.data.map(d=>d.range),reason:w.reason,updatedCells:out?.totalUpdatedCells||0}).catch(()=>{});
      res.json({ok:true,updatedCells:out?.totalUpdatedCells||0,updatedRanges:(out?.responses||[]).map(r=>r.updatedRange)});
    }catch(error){
      if(error?.code==='scope_readonly')return res.status(403).json({ok:false,error:'scope_readonly'});
      res.status(502).json({ok:false,error:'sheets_failed',code:sheetsReadError(error)});
    }
  });
  return router;
}
module.exports={createBackstageApi,writeRequest,rangeCells,dateRange,tokenMatches,dailyScores,dayReasons,sheetDays,REASONS,MAX_DAYS};
