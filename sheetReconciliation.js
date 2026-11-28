'use strict';
const {GROUP_SHEETS,findMonthTab}=require('./groupSheets');
const {dayKey,dayStart,shiftStarts,scoreRows,sessionGiftPipeline,liveGroups,groupResetHours,sessionWorkday}=require('./rankingNext');
const {decodeGiftBuckets}=require('./leaderboardPerformance');
const {sheetsReadError}=require('./sheetsConnection');
const {displayMonth}=require('./monthlyWindows');
// Sheets record a workday from 06:00: a night shift after midnight belongs to the
// previous day, independent of the board's own daily reset hour.
const WORKDAY_HOUR=6,workday=value=>dayKey(value,WORKDAY_HOUR);
// Talent names compared by letters/digits only: "Lapin" matches "Lapin 🐰".
// NFKC turns styled letters (𝒀𝒊𝒊𝒏, ᴷʰᵒ) into plain ones; small capitals (ʟᴇᴠɪ) it
// leaves, so they are folded here.
const SMALL_CAPS={'ᴀ':'A','ʙ':'B','ᴄ':'C','ᴅ':'D','ᴇ':'E','ꜰ':'F','ɢ':'G','ʜ':'H','ɪ':'I','ᴊ':'J','ᴋ':'K','ʟ':'L','ᴍ':'M','ɴ':'N','ᴏ':'O','ᴘ':'P','ǫ':'Q','ʀ':'R','ꜱ':'S','ᴛ':'T','ᴜ':'U','ᴠ':'V','ᴡ':'W','ʏ':'Y','ᴢ':'Z'};
const foldSmallCaps=value=>String(value||'').replace(/[ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡʏᴢ]/g,c=>SMALL_CAPS[c]);
// Sheet columns named after another name of the talent (confirmed by the owner).
// Talent name key -> sheet header keys.
const SHEET_COLUMN_ALIASES=Object.freeze({ALIZ:['ARIEL']}); // Aliz🤍 (VELVET GRACE) = column Ariel, 28/11
const nameKey=value=>foldSmallCaps(value).normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function talentColumns(headers,talentNames){
  const keys=headers.map(nameKey),found=talentNames.map(name=>{
    const key=nameKey(name);if(!key)return{name,index:-1};
    const wanted=[key,...(SHEET_COLUMN_ALIASES[key]||[])];
    const exact=keys.flatMap((h,i)=>i>0&&wanted.includes(h)?[i]:[]);
    // Sheets often shorten a nickname ("Wina" for "Wina here 🐱", "Katie" for
    // "Hello Katie", "Zelzi" for "Lucky ZELzii").
    const loose=exact.length?exact:keys.flatMap((h,i)=>i>0&&h.length>=3&&(key.startsWith(h)||key.endsWith(h)||(h.length>=4&&key.includes(h)))?[i]:[]);
    return{name,index:loose.length===1?loose[0]:-1};
  });
  // A column claimed by two talents is ambiguous: compare neither.
  return found.map(c=>c.index>0&&found.filter(o=>o.index===c.index).length===1?c:{...c,index:-1});
}
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
  const columns=talentColumns(headers,talentNames).filter(c=>c.index>0),names=columns.map(c=>c.name);
  const days=new Map();let date=null,outside=0;
  for(const row of values.slice(2)){
    // A fully blank row ends the day table: a side table below it (e.g. NAME/KPI/LACK/TOTAL)
    // must not inherit the last date. Merged-date rows of a second shift are never blank.
    if(!row.some(v=>v!==undefined&&v!==null&&String(v).trim()!=='')){date=null;continue}
    if(row[0]!==undefined&&row[0]!==null&&String(row[0]).trim()!=='')date=sheetDate(row[0]);
    if(!date)continue;
    const filled=(columns.length?columns.map(c=>row[c.index]):row.slice(1,common)).some(v=>typeof v==='number'||normalize(v)==='OFF')||(typeof row[common]==='number'&&row[common]!==0);
    if(!filled)continue;
    // A stray row from another month (e.g. 30/09 copied into October) is skipped.
    if(!date.startsWith(month+'-')){outside++;continue}
    const shared=typeof row[common]==='number'?row[common]:0;
    // Rows with talent scores but no total (e.g. a battle row) use the talent cells.
    const cells=row.slice(1,common).filter(v=>typeof v==='number');
    const group=typeof row[sum]==='number'?row[sum]:typeof row[total]==='number'?row[total]+shared:cells.length?cells.reduce((n,v)=>n+v,0)+shared:null;
    if(group===null||!Number.isFinite(group))continue;
    // Most sheets already spread the shared (Chung) points into each talent's cell
    // (e.g. DPM 26.898,33 = own + 1.222/3). Add a share only when the cells plus
    // Chung make up the row total and the cells alone do not.
    const cellSum=cells.reduce((n,v)=>n+v,0),tolerance=Math.max(2,cells.length);
    const addShare=shared!==0&&Math.abs(cellSum+shared-group)<=tolerance&&Math.abs(cellSum-group)>tolerance;
    const share=addShare?Math.floor(shared/talentNames.length):0;
    // A second row of a day (another shift or account, e.g. "LIVE ĐT") may list only
    // the talents who played: its blank cells mean 0, not "not filled".
    const continuing=days.has(date);
    const entry=days.get(date)||{date,group:0,cells:0,individual:Object.fromEntries(names.map(n=>[n,0])),provided:Object.fromEntries(names.map(n=>[n,true]))};
    entry.group+=group;
    // What the row's cells add up to (with Chung when that is closer to the row total),
    // to point out a total cell that does not match its own row.
    entry.cells+=cells.length?cellSum+(Math.abs(cellSum+shared-group)<Math.abs(cellSum-group)?shared:0):group;
    // A text value in a score cell (not OFF) makes that talent's day unverifiable.
    for(const c of columns){entry.individual[c.name]+=(typeof row[c.index]==='number'?row[c.index]:0)+share;const blank=row[c.index]===undefined||row[c.index]===null||String(row[c.index]).trim()==='';entry.provided[c.name]=entry.provided[c.name]&&((continuing&&blank)||typeof row[c.index]==='number'||normalize(row[c.index])==='OFF')}
    days.set(date,entry);
  }
  if(!days.size&&outside)return{error:'date_month_mismatch',days:[]};
  return{days:[...days.values()],names};
}
function matchingProfile(profiles,group){
  const canonical=name=>normalize(name).replace(/^HT\s*[-_]\s*/,'');
  // Exact aliases verified on the production board; never fuzzy-match a group.
  const aliases={'LEVEL X':['LEVEL X','LEVELX'],DPM:['DPM','DOPAMINE','DPM ( TUYEN THANH VIEN )'],VELIX:['VELIX','VELIX🏖️ [TUYEN THANH VIEN]']};
  const target=normalize(group),allowed=aliases[target]||[target];
  const matches=profiles.filter(p=>allowed.includes(canonical(p.name)));return matches.length===1?matches[0]:null;
}
function discrepancy(backend,sheet,details){const delta=backend-sheet;return Number.isFinite(delta)&&Math.abs(delta)>1000?{...details,backend,sheet,delta,threshold:1000}:null}
function comparableDay(date,profileId,sessions,known,active,starts=shiftStarts(sessions),hours={}){
  const entries=sessions.filter(s=>String(s.profileId)===String(profileId)&&sessionWorkday(starts.get(String(s._id)),s.profileId,hours)===date);
  // Legacy controllers can reuse a session for multiple days. Only compare days
  // whose sessions have been observed by the new, day-aware controller publisher.
  return entries.length>0&&entries.every(s=>known.has(String(s._id))&&!active.has(String(s._id)));
}
function createSheetReconciliation({getDb,sheets,groupRules,clock=Date.now}){
  let result={state:'pending',warnings:[],sources:[]},pending,checked=0,version='';
  async function build(profiles,currentVersion){
    // The check reads the month the monthly board shows: the finished month stays
    // through day 2, so its last days (and their sheet rows) are still compared.
    const now=clock(),month=displayMonth(new Date(now)),db=getDb();
    const sessions=await db.collection('sessions').find({createdAt:{$gte:new Date(dayStart(month+'-01',WORKDAY_HOUR)-86400000)}},{projection:{createdAt:1,sessionStartedAt:1,profileId:1,sessionName:1,updatedAt:1}}).toArray();
    const gifts=sessions.length?decodeGiftBuckets(await db.collection('gifts').aggregate(sessionGiftPipeline(sessions.map(s=>s._id)),{allowDiskUse:true,maxTimeMS:60000}).toArray()):[];
    const live=await db.collection('leaderboard_live').find({source:'helioscontrol',liveSince:{$gte:new Date(dayStart(month+'-01',WORKDAY_HOUR)-86400000)}}).toArray();
    // Sessions opened by a mid-shift restart belong to the shift's workday.
    // Each group's own reset hour (e.g. DPM 18:00 for overtime) decides its workday.
    const hours=groupResetHours(profiles,WORKDAY_HOUR,groupRules?.()),starts=shiftStarts(sessions),shiftDay=s=>sessionWorkday(starts.get(String(s._id)),s.profileId,hours);
    const knownSessionIds=new Set(live.map(s=>String(s.sessionId)));
    const liveSessionIds=new Set(live.filter(s=>liveGroups([s],now).size).map(s=>String(s.sessionId)));
    const warnings=[],sources=[];
    // Serial reads avoid burst quota/network pressure on the NAS. No cell values in logs.
    for(const source of GROUP_SHEETS){
      const profile=matchingProfile(profiles,source.group);
      if(!profile){sources.push({group:source.group,state:'profile_unmatched'});continue}
      try{
        const metadata=await sheets.read({spreadsheetId:source.spreadsheetId,metadata:true});const tab=findMonthTab(metadata,new Date(dayStart(month+'-01',WORKDAY_HOUR)));
        if(!tab){sources.push({group:source.group,state:'month_tab_missing'});continue}
        const data=await sheets.read({spreadsheetId:source.spreadsheetId,range:`'${tab.title.replace(/'/g,"''")}'!A1:U${Math.min(100,tab.gridProperties.rowCount)}`});
        const parsed=parseSheet(data.values||[],month,Object.keys(profile.talents||{}));
        if(parsed.error){sources.push({group:source.group,state:parsed.error});continue}
        // Talents without a recognisable sheet column are left out; group totals are explicit.
        const names=parsed.names,groupOnly=!names.length;
        const groupToday=sessionWorkday(now,profile._id,hours);
        const complete=parsed.days.filter(day=>day.date<groupToday&&comparableDay(day.date,profile._id,sessions,knownSessionIds,liveSessionIds,starts,hours));
        const dates=new Set(complete.map(d=>d.date));
        // Every session of those workdays counts: battles and lives on another
        // group's account are split by member group exactly like the board.
        const ids=new Set(sessions.filter(s=>dates.has(shiftDay(s))).map(s=>String(s._id)));
        if(!dates.size){sources.push({group:source.group,state:'awaiting_verified_closed_sessions'});continue}
        const scored=scoreRows(profiles,gifts.filter(g=>ids.has(String(g.sessionId))),sessions);
        const context={period:'monthly',groupId:String(profile._id),group:source.group,dates:[...dates].sort(),checkedAt:new Date(now).toISOString(),basis:'closed-filled-session-days',sheetUrl:`https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${tab.sheetId}`};
        const group=scored.group.find(g=>g.groupId===String(profile._id));
        const groupWarning=discrepancy(group?.value||0,complete.reduce((n,d)=>n+d.group,0),{...context,kind:'group',name:profile.name});if(groupWarning)warnings.push(groupWarning);
        for(const name of names){
          const entered=complete.filter(d=>d.provided[name]);if(!entered.length)continue;
          const talentDates=new Set(entered.map(d=>d.date));const talentIds=new Set(sessions.filter(s=>talentDates.has(shiftDay(s))).map(s=>String(s._id)));
          const subset=talentDates.size===dates.size?scored:scoreRows(profiles,gifts.filter(g=>talentIds.has(String(g.sessionId))),sessions);
          const row=subset.individual.find(e=>e.name===name&&e.groupId===String(profile._id));const warning=discrepancy(row?.value||0,entered.reduce((n,d)=>n+d.individual[name],0),{...context,dates:[...talentDates].sort(),kind:'individual',name});if(warning)warnings.push(warning);
        }
        sources.push({group:source.group,state:groupOnly?'checked_group_only':'checked',dates:[...dates].sort()});
      }catch(error){sources.push({group:source.group,state:sheetsReadError(error)})}
    }
    if(await sheets.version()!==currentVersion)return;
    result={state:'checked',month,warnings,sources,checkedAt:new Date(now).toISOString()};checked=clock();version=currentVersion;
  }
  return{status(){return result},invalidate(){checked=0;version=''},async refresh(profiles){
    const connected=await sheets.status();if(!connected.connected){result={state:'disconnected',warnings:[],sources:[]};version='';return}
    const currentVersion=await sheets.version();if(currentVersion!==version)result={state:'pending',warnings:[],sources:[]};
    if(pending)return pending;if(currentVersion===version&&clock()-checked<300000)return;
    pending=build(profiles,currentVersion).catch(()=>{result={state:'unavailable',warnings:[],sources:[]};checked=clock();version=currentVersion}).finally(()=>pending=null);return pending;
  }};
}
module.exports={normalize,nameKey,SHEET_COLUMN_ALIASES,talentColumns,sheetDate,parseSheet,matchingProfile,discrepancy,comparableDay,createSheetReconciliation};
