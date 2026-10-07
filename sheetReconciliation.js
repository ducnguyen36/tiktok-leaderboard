'use strict';
const {GROUP_SHEETS,findMonthTab}=require('./groupSheets');
const {dayKey,dayStart,sessionStart,scoreRows,sessionGiftPipeline,liveGroups}=require('./rankingNext');
const {decodeGiftBuckets}=require('./leaderboardPerformance');
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
function sheetDate(value){
  if(typeof value==='number'&&Number.isFinite(value))return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
  const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value||''));
  if(m)return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):null;
}
function parseSheet(values,month,talentNames){
  const headers=values[0]||[],common=headers.findIndex(h=>['CHUNG','KC CHUNG'].includes(normalize(h))),sum=headers.findIndex(h=>normalize(h)==='TONG'),total=headers.findIndex(h=>normalize(h)==='TOTAL');
  if(common<0||sum<0||total<0)return{error:'unsupported_headers',days:[]};
  const columns=talentNames.map(name=>({name,index:headers.findIndex(h=>normalize(h)===normalize(name))}));
  if(columns.some(c=>c.index<1)||new Set(columns.map(c=>c.index)).size!==columns.length)return{error:'talent_names_unmatched',days:[]};
  const days=new Map();let date=null;
  for(const row of values.slice(2)){
    if(row[0]!==undefined&&row[0]!==null&&String(row[0]).trim()!=='')date=sheetDate(row[0]);
    if(!date)continue;
    const filled=(columns.length?columns.map(c=>row[c.index]):row.slice(1,common)).some(v=>typeof v==='number'||normalize(v)==='OFF')||(typeof row[common]==='number'&&row[common]!==0);
    if(!filled)continue;
    if(!date.startsWith(month+'-'))return{error:'date_month_mismatch',days:[]};
    if(columns.some(c=>row[c.index]!=null&&row[c.index]!==''&&typeof row[c.index]!=='number'&&normalize(row[c.index])!=='OFF'))return{error:'invalid_score',days:[]};
    const shared=typeof row[common]==='number'?row[common]:0;
    const group=typeof row[sum]==='number'?row[sum]:typeof row[total]==='number'?row[total]+shared:null;
    if(group===null||!Number.isFinite(group))continue;
    const entry=days.get(date)||{date,group:0,individual:Object.fromEntries(talentNames.map(n=>[n,0])),provided:Object.fromEntries(talentNames.map(n=>[n,true]))};
    entry.group+=group;
    for(const c of columns){entry.individual[c.name]+=(typeof row[c.index]==='number'?row[c.index]:0)+Math.floor(shared/talentNames.length);entry.provided[c.name]=entry.provided[c.name]&&(typeof row[c.index]==='number'||normalize(row[c.index])==='OFF')}
    days.set(date,entry);
  }
  return{days:[...days.values()]};
}
function matchingProfile(profiles,group){
  const canonical=name=>normalize(name).replace(/^HT\s*[-_]\s*/,'');
  // Exact aliases verified on the production board; never fuzzy-match a group.
  const aliases={'LEVEL X':['LEVEL X','LEVELX'],DPM:['DPM','DOPAMINE','DPM ( TUYEN THANH VIEN )'],VELIX:['VELIX','VELIX🏖️ [TUYEN THANH VIEN]']};
  const target=normalize(group),allowed=aliases[target]||[target];
  const matches=profiles.filter(p=>allowed.includes(canonical(p.name)));return matches.length===1?matches[0]:null;
}
function discrepancy(backend,sheet,details){const delta=backend-sheet;return Number.isFinite(delta)&&Math.abs(delta)>1000?{...details,backend,sheet,delta,threshold:1000}:null}
function createSheetReconciliation({getDb,sheets,clock=Date.now}){
  let result={state:'pending',warnings:[],sources:[]},pending,checked=0,version='';
  async function build(profiles,currentVersion){
    const now=clock(),today=dayKey(now),month=today.slice(0,7),db=getDb();
    const sessions=await db.collection('sessions').find({createdAt:{$gte:new Date(dayStart(month+'-01')-86400000)}},{projection:{createdAt:1,sessionStartedAt:1,profileId:1,sessionName:1}}).toArray();
    const gifts=sessions.length?decodeGiftBuckets(await db.collection('gifts').aggregate(sessionGiftPipeline(sessions.map(s=>s._id)),{allowDiskUse:true,maxTimeMS:60000}).toArray()):[];
    const live=await db.collection('leaderboard_live').find({live:true,heartbeatAt:{$gt:new Date(now-90000)}}).toArray();
    const liveSessionIds=new Set(live.filter(s=>liveGroups([s],now).size).map(s=>String(s.sessionId)));
    const warnings=[],sources=[];
    // Serial reads avoid burst quota/network pressure on the NAS. No cell values in logs.
    for(const source of GROUP_SHEETS){
      const profile=matchingProfile(profiles,source.group);
      if(!profile){sources.push({group:source.group,state:'profile_unmatched'});continue}
      try{
        const metadata=await sheets.read({spreadsheetId:source.spreadsheetId,metadata:true});const tab=findMonthTab(metadata,new Date(dayStart(today)));
        if(!tab){sources.push({group:source.group,state:'month_tab_missing'});continue}
        const data=await sheets.read({spreadsheetId:source.spreadsheetId,range:`'${tab.title.replace(/'/g,"''")}'!A1:U${Math.min(100,tab.gridProperties.rowCount)}`});
        let names=Object.keys(profile.talents||{}),parsed=parseSheet(data.values||[],month,names),groupOnly=false;
        // Group totals are explicit in the sheet and do not need guessed talent aliases.
        if(parsed.error==='talent_names_unmatched'){names=[];parsed=parseSheet(data.values||[],month,names);groupOnly=true}
        if(parsed.error){sources.push({group:source.group,state:parsed.error});continue}
        const complete=parsed.days.filter(day=>day.date<today&&!sessions.some(s=>dayKey(sessionStart(s))===day.date&&String(s.profileId)===String(profile._id)&&liveSessionIds.has(String(s._id))));
        const dates=new Set(complete.map(d=>d.date));
        const ids=new Set(sessions.filter(s=>String(s.profileId)===String(profile._id)&&dates.has(dayKey(sessionStart(s)))).map(s=>String(s._id)));
        if(!dates.size){sources.push({group:source.group,state:'awaiting_closed_data'});continue}
        const scored=scoreRows(profiles,gifts.filter(g=>ids.has(String(g.sessionId))),sessions);
        const context={period:'monthly',groupId:String(profile._id),group:source.group,dates:[...dates].sort(),checkedAt:new Date(now).toISOString(),basis:'closed-filled-session-days',sheetUrl:`https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${tab.sheetId}`};
        const group=scored.group.find(g=>g.groupId===String(profile._id));
        const groupWarning=discrepancy(group?.value||0,complete.reduce((n,d)=>n+d.group,0),{...context,kind:'group',name:profile.name});if(groupWarning)warnings.push(groupWarning);
        for(const name of names){
          const entered=complete.filter(d=>d.provided[name]);if(!entered.length)continue;
          const talentDates=new Set(entered.map(d=>d.date));const talentIds=new Set(sessions.filter(s=>String(s.profileId)===String(profile._id)&&talentDates.has(dayKey(sessionStart(s)))).map(s=>String(s._id)));
          const subset=talentDates.size===dates.size?scored:scoreRows(profiles,gifts.filter(g=>talentIds.has(String(g.sessionId))),sessions);
          const row=subset.individual.find(e=>e.name===name&&e.groupId===String(profile._id));const warning=discrepancy(row?.value||0,entered.reduce((n,d)=>n+d.individual[name],0),{...context,dates:[...talentDates].sort(),kind:'individual',name});if(warning)warnings.push(warning);
        }
        sources.push({group:source.group,state:groupOnly?'checked_group_only':'checked',dates:[...dates].sort()});
      }catch{sources.push({group:source.group,state:'read_failed'})}
    }
    if(await sheets.version()!==currentVersion)return;
    result={state:'checked',warnings,sources,checkedAt:new Date(now).toISOString()};checked=clock();version=currentVersion;
  }
  return{status(){return result},async refresh(profiles){
    const connected=await sheets.status();if(!connected.connected){result={state:'disconnected',warnings:[],sources:[]};version='';return}
    const currentVersion=await sheets.version();if(currentVersion!==version)result={state:'pending',warnings:[],sources:[]};
    if(pending)return pending;if(currentVersion===version&&clock()-checked<300000)return;
    pending=build(profiles,currentVersion).catch(()=>{result={state:'unavailable',warnings:[],sources:[]};checked=clock();version=currentVersion}).finally(()=>pending=null);return pending;
  }};
}
module.exports={normalize,sheetDate,parseSheet,matchingProfile,discrepancy,createSheetReconciliation};
