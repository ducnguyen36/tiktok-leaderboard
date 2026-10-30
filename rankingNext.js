'use strict';
const A=require('./leaderboardAggregation');
const {decodeGiftBuckets}=require('./leaderboardPerformance');
const DAY=86400000, OFFSET=7*3600000;
function dayKey(value,resetHour=0){const n=+new Date(value);return Number.isFinite(n)?new Date(n+OFFSET-resetHour*3600000).toISOString().slice(0,10):null}
function dayStart(key,resetHour=0){return Date.parse(key+'T'+String(resetHour).padStart(2,'0')+':00:00+07:00')}
function sessionStart(session){
  const explicit=session.sessionStartedAt||session.createdAt;
  if(explicit&&Number.isFinite(+new Date(explicit)))return +new Date(explicit);
  const m=/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(session.sessionName||'');
  return m?Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`):NaN;
}
// HeliosControl opens a new session when it restarts mid-shift. A session of the
// same group that starts within 30 minutes of the previous one's last activity is
// the same shift, so it takes the shift's first start for its day. A shift never
// spans more than 14 hours, and a last-save time far after a session's start (old
// sessions re-saved days later) is ignored, so separate days are never chained.
const CONTINUATION_GAP=30*60000,MAX_SHIFT=14*3600000;
function shiftStarts(sessions){
  const starts=new Map(),byProfile=new Map();
  for(const s of sessions){const start=sessionStart(s);starts.set(String(s._id),start);if(s.profileId&&Number.isFinite(start))(byProfile.get(String(s.profileId))||byProfile.set(String(s.profileId),[]).get(String(s.profileId))).push(s)}
  for(const list of byProfile.values()){
    list.sort((a,b)=>sessionStart(a)-sessionStart(b));let head=null,end=-Infinity;
    for(const s of list){const start=sessionStart(s),saved=+new Date(s.updatedAt)||start,last=saved>=start&&saved-start<=MAX_SHIFT?saved:start;
      if(head!==null&&start-end<=CONTINUATION_GAP&&start-head<=MAX_SHIFT){starts.set(String(s._id),head);end=Math.max(end,last)}else{head=start;end=last}}
  }
  return starts;
}
function liveGroups(states,now=Date.now()){
  const result=new Map();for(const state of states){const beat=+new Date(state.heartbeatAt);if(state.live===true&&state.profileId&&Number.isFinite(beat)&&beat<=now+5000&&now-beat<90000)result.set(String(state.profileId),{live:true,liveSince:state.liveSince,liveExpiresAt:new Date(beat+90000).toISOString()})}return result;
}
function scoreRows(profiles,gifts,sessions,avatar=value=>value||''){
  const avatars=A.buildTalentAvatars(profiles),map=A.buildProfileMap(profiles),tp=A.buildTalentToProfileMap(profiles),names=A.buildProfileNameToIdMap(profiles),uids=A.buildUidMaps(profiles);
  const owners=Object.fromEntries(sessions.filter(s=>s.profileId).map(s=>[String(s._id),s.profileId]));
  return {
    individual:A.aggregateIndividual(gifts,avatars,names,uids.uidToTalent,tp,map,uids.uidToProfile).map(e=>{const group=tp[e._id],p=map[group?.profileId]||{};return{name:e._id,value:e.totalDiamonds,groupId:String(group?.profileId||''),locationId:p.locationId||'',avatar:avatar(avatars[e._id]?.avatarUrl,avatars[e._id]?.uniqueId)}}),
    group:A.aggregateGroup(gifts,tp,map,names,uids.uidToTalent,uids.uidToProfile,owners).map(e=>({name:e.name,value:e.totalDiamonds,groupId:String(e._id),locationId:map[e._id]?.locationId||'',avatar:avatar(map[e._id]?.avatar,map[e._id]?.username)}))
  };
}
// The workday (06:00 by default) decides which day a shift belongs to. DPM works
// overtime until the next afternoon, so its shifts only roll over at 18:00. Groups'
// own reset hours are an admin setting; until one is saved, the DPM default applies.
const WORKDAY_HOUR=6,LATE_GROUP_HOUR=18,LATE_GROUPS=/\bDPM\b/i;
function groupResetHours(profiles,resetHour,rules=null){
  const hours={};if(resetHour!==WORKDAY_HOUR)return hours;
  if(rules){for(const p of profiles||[])if(Number.isInteger(rules[String(p._id)]))hours[String(p._id)]=rules[String(p._id)];return hours}
  for(const p of profiles||[])if(LATE_GROUPS.test(p.name||''))hours[String(p._id)]=LATE_GROUP_HOUR;
  return hours;
}
// Workday of a session from its shift start, using the group's own reset hour.
function sessionWorkday(start,profileId,hours,resetHour=WORKDAY_HOUR){return dayKey(start,hours[String(profileId)]??resetHour)}
// The board keeps showing the finished workday until the hold time (14:00), then
// moves to the new one. A hold at or before the reset hour has no effect.
function holdHours(holdUntil){const m=/^(\d{2}):(\d{2})$/.exec(holdUntil||'');return m?+m[1]+m[2]/60:0}
function displayDay(now,resetHour=0,holdUntil=''){return dayKey(now,Math.max(resetHour,holdHours(holdUntil)))}
function partitionSessions(sessions,now=Date.now(),resetHour=0,{holdUntil='',groupHours={}}={}){
  const today=displayDay(now,resetHour,holdUntil),yesterday=new Date(Date.parse(today)-DAY).toISOString().slice(0,10);
  const starts=shiftStarts(sessions),keys=new Map(sessions.map(s=>[String(s._id),dayKey(starts.get(String(s._id)),groupHours[String(s.profileId)]??resetHour)]));
  return{today,yesterday,keys};
}
function sessionGiftPipeline(ids){
  const fields=['receivedTalent','receivedTalents','receivedTalentUid','toMemberUid','cost','sessionId','competitionId'];
  return[{$match:{sessionId:{$in:ids}}},{$group:{_id:Object.fromEntries(fields.map(f=>[f,'$'+f])),count:{$sum:1}}},{$project:{_id:0,gift:'$_id',count:1}}];
}
function decorateLive(rows,states,now){const groups=liveGroups(states,now);return rows.map(row=>({...row,...(groups.get(String(row.groupId))||{live:false})}))}
function createNextRankingForHour({getDb,current,readProfiles,readLocations,avatar,reconcile,groupRules,clock=Date.now,resetHour=0,holdUntil=''}){
  let cached,pending,generation=0;
  async function build(force=false){
    const revision=generation,started=clock(),db=getDb();if(!db)throw Error('Database unavailable');
    // Restarted shifts reach back up to 14 hours, so read sessions from before the earlier day's start.
    const from=new Date(dayStart(displayDay(started,resetHour,holdUntil),resetHour)-DAY-MAX_SHIFT);
    const [monthly,profiles,locations,sessions,states]=await Promise.all([current(resetHour,'',{force}),readProfiles(),readLocations(),db.collection('sessions').find({$or:[{createdAt:{$gte:from}},{sessionStartedAt:{$gte:from}}]},{projection:{profileId:1,createdAt:1,sessionStartedAt:1,sessionName:1,updatedAt:1}}).toArray(),db.collection('leaderboard_live').find({live:true,heartbeatAt:{$gt:new Date(started-90000)}}).toArray()]);
    const buckets=sessions.length?decodeGiftBuckets(await db.collection('gifts').aggregate(sessionGiftPipeline(sessions.map(s=>s._id)),{allowDiskUse:true,maxTimeMS:60000}).toArray()):[];
    const groupHours=groupResetHours(profiles,resetHour,groupRules?.()),days=partitionSessions(sessions,started,resetHour,{holdUntil,groupHours}),{today,yesterday}=days;
    const scores=key=>scoreRows(profiles,buckets.filter(g=>days.keys.get(String(g.sessionId))===key),sessions,avatar);
    const daily=scores(today),prior=scores(yesterday);
    for(const kind of ['group','individual'])daily[kind]=daily[kind].map(row=>({...row,yesterday:prior[kind].find(p=>p.name===row.name&&p.groupId===row.groupId)||null}));
    const data={...monthly.data,individual:{...monthly.data.individual,daily:daily.individual,yesterday:prior.individual},group:{...monthly.data.group,daily:daily.group,yesterday:prior.group},frozen:false,dailyPeriod:{today,yesterday,resetHour,holdUntil,groupResetHours:groupHours,attribution:'session-start'}};
    for(const kind of ['individual','group'])for(const period of ['daily','yesterday','monthly'])data[kind][period]=decorateLive(data[kind][period],states,started);
    cached={status:'ok',data,meta:{...monthly.meta,computedAt:new Date(started).toISOString(),dailyAttribution:'session-start',liveSource:'helioscontrol-heartbeat',stale:monthly.meta?.stale===true},builtAt:started,revision};
    reconcile?.refresh(profiles).catch(()=>{});return cached;
  }
  return{invalidate(){generation++},async get(force=false){
    if(force&&pending)await pending;
    const newDay=()=>displayDay(clock(),resetHour,holdUntil)!==cached.data.dailyPeriod.today;
    if(!cached||newDay()||force||clock()-cached.builtAt>15000||cached.revision!==generation){if(!pending)pending=build(force).finally(()=>pending=null);if(!cached||force||newDay())await pending;else pending.catch(()=>{})}
    const result={...cached,data:structuredClone(cached.data),meta:{...cached.meta,stale:cached.meta.stale||cached.revision!==generation||clock()-cached.builtAt>15000}};
    // Expire indicators locally even when an older cached result is served.
    for(const kind of ['individual','group'])for(const period of ['daily','yesterday','monthly'])for(const row of result.data[kind][period])if(row.live&&Date.parse(row.liveExpiresAt)<=clock())row.live=false;
    result.data.reconciliation=reconcile?.status()||{state:'unavailable',warnings:[]};return result;
  }};
}
// Default: 06:00 workday (DPM 18:00), the finished day held on the board until 14:00.
const DEFAULT_CONTEXT={resetHour:WORKDAY_HOUR,freezeUntil:'14:00'};
function createNextRanking(options){
 const services=new Map(),clock=options.clock||Date.now;
 return{
  invalidate(){services.forEach(service=>service.invalidate())},
  async get(force=false,context={}){
   const hour=context.resetHour===undefined?DEFAULT_CONTEXT.resetHour:Number(context.resetHour);
   if(!Number.isInteger(hour)||hour<0||hour>23)throw new RangeError('Invalid reset hour');
   const freeze=context.freezeUntil===undefined?DEFAULT_CONTEXT.freezeUntil:context.freezeUntil||'';
   if(typeof freeze!=='string'||(freeze&&!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(freeze)))throw new RangeError('Invalid freeze time');
   const key=hour+'|'+freeze;
   if(!services.has(key))services.set(key,createNextRankingForHour({...options,resetHour:hour,holdUntil:freeze}));
   const result=await services.get(key).get(force);
   // Held: the board still shows the workday that ended at the reset hour.
   result.data.frozen=result.data.dailyPeriod.today!==dayKey(clock(),hour);result.meta.contextKey=key;
   return result;
  }
 };
}
module.exports={WORKDAY_HOUR,DEFAULT_CONTEXT,dayKey,dayStart,displayDay,groupResetHours,sessionWorkday,sessionStart,shiftStarts,partitionSessions,liveGroups,scoreRows,sessionGiftPipeline,decorateLive,createNextRanking};

