'use strict';
// Feed for Helios Backstage (server-to-server). Daily KC totals per group/idol
// and the group Sheets — never gifts, donors' data or tokens (talent avatars only,
// for the Backstage profile pictures). The only write
// is /sheets/write: approved shift reports into the eight group workbooks,
// inside "THÁNG MM.YYYY" tabs, at most MAX_WRITE_CELLS cells per call.
const express=require('express');
const {GROUP_SHEETS,findMonthTab}=require('./groupSheets');
const {parseSheet,matchingProfile}=require('./sheetReconciliation');
const {sheetsReadError}=require('./sheetsConnection');
const {DAY,MAX_DAYS,MAX_SHIFT,MAX_WRITE_CELLS,MAX_READ_RANGES,ALLOWED_SHEETS,rangeCells,writeRequest,dateRange,tokenMatches,REASONS,dayReasons,dailyScores,dayCountOf,sheetDays,scoresData,sessionsData}=require('./backstageCore');
function createBackstageApi({getDb,readProfiles,sheets,reconcile,settings,token,clock=Date.now,resolveAvatar=(url)=>url,avatarFile=()=>null,liveJournal=null}){
  const router=express.Router(),cache=new Map(),hits=new Map();
  const configured=typeof token==='string'&&token.length>=32;
  const cached=async(key,ttl,build)=>{const hit=cache.get(key);if(hit&&clock()-hit.at<ttl)return hit.value;const value=await build();cache.set(key,{at:clock(),value});if(cache.size>50)cache.delete(cache.keys().next().value);return value};
  // File ảnh đại diện talent cho Backstage (server-to-server, cùng khoá). Đường riêng ngoài /api/backstage
  // để không ăn vào giới hạn 60 lượt/phút của API số liệu; chỉ tên file trong thư mục ảnh.
  router.get('/api/backstage-files/avatar/:file',(req,res)=>{
    if(!configured)return res.status(503).end();
    if(!tokenMatches(req.get('authorization'),token))return res.status(401).end();
    const file=avatarFile(String(req.params.file||''));
    if(!file)return res.status(404).end();
    res.set('Cache-Control','private, max-age=86400');
    res.sendFile(file);
  });
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
    const count=String(req.query.count||'');
    if(count&&count!=='session'&&count!=='gift')return res.status(400).json({status:'error',message:'count: session | gift'});
    try{
      res.json(await cached(`scores:${days[0]}:${days.at(-1)}:${count}`,60000,async()=>{
        const [profiles,board]=await Promise.all([readProfiles(),settings?settings().catch(()=>null):null]);
        return scoresData({db:getDb(),profiles,days,count,board,now:clock()});
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
  // Ảnh đại diện của TALENT trong từng nhóm (profiles.talents[name].avatarUrl) — không có người tặng.
  // avatar: "/userdata/avatars/<file>" (phục vụ công khai ở route đó) hoặc link https gốc.
  router.get('/api/backstage/avatars',async(req,res)=>{
    try{
      const profiles=await readProfiles();
      const talents=[];
      for(const p of profiles)for(const [name,info] of Object.entries(p.talents||{})){
        // Ảnh đã tải về ổ của ranking (theo username TikTok) — file lưu trong Mongo nằm trên máy HeliosControl.
        let a=String(resolveAvatar(String(info?.avatarUrl||''),String(info?.uniqueId||''))||'');
        if(a.startsWith('userdata/avatars/'))a='/'+a;
        else if(a.startsWith('avatars/')||a.startsWith('/avatars/'))a='/userdata/avatars/'+a.split('/').pop();
        if(!(a.startsWith('/userdata/avatars/')||/^https:\/\//.test(a)))a='';
        talents.push({groupId:String(p._id),group:p.name||'',name,uniqueId:String(info?.uniqueId||''),avatar:a});
      }
      res.json({status:'ok',talents});
    }catch{res.status(500).json({status:'error',message:'avatars_unavailable'})}
  });
  // Giờ bắt đầu / kết thúc phiên live theo nhóm (để Backstage suy ra lịch live). Chỉ đọc, không quà, không người tặng.
  router.get('/api/backstage/sessions',async(req,res)=>{
    const days=dateRange(req.query.from,req.query.to);
    if(!days)return res.status(400).json({status:'error',message:`from/to YYYY-MM-DD, tối đa ${MAX_DAYS} ngày`});
    try{
      res.json(await sessionsData({db:getDb(),profiles:await readProfiles(),days}));
    }catch{res.status(500).json({status:'error',message:'sessions_unavailable'})}
  });
  // Đoạn live theo nhóm (nhật ký lên/xuống từ heartbeat HeliosControl): nhóm nào đang live, dừng từ lúc nào,
  // lên lại sau bao lâu. `end: null` = đang live. Chỉ giờ giấc, không quà / người tặng.
  router.get('/api/backstage/live',async(req,res)=>{
    const days=dateRange(req.query.from,req.query.to);
    if(!days)return res.status(400).json({status:'error',message:`from/to YYYY-MM-DD, tối đa ${MAX_DAYS} ngày`});
    if(!liveJournal)return res.status(503).json({status:'error',message:'live_journal_unavailable'});
    try{
      const now=clock(),lo=Date.parse(days[0]+'T00:00:00+07:00'),hi=Date.parse(days.at(-1)+'T00:00:00+07:00')+DAY+MAX_SHIFT;
      liveJournal.expire(now);
      const profiles=await readProfiles();
      res.json({status:'ok',asOf:new Date(now).toISOString(),staleAfterMs:90000,groups:profiles.map(p=>({groupId:String(p._id),name:p.name})),segments:liveJournal.segments(lo,hi,now)});
    }catch{res.status(500).json({status:'error',message:'live_unavailable'})}
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
module.exports={createBackstageApi,writeRequest,rangeCells,dateRange,tokenMatches,dailyScores,dayCountOf,dayReasons,sheetDays,REASONS,MAX_DAYS};
