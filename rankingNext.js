'use strict';
const A=require('./leaderboardAggregation');
const {decodeGiftBuckets}=require('./leaderboardPerformance');
const DAY=86400000, OFFSET=7*3600000;
function dayKey(value,resetHour=6){const n=+new Date(value);return Number.isFinite(n)?new Date(n+OFFSET-resetHour*3600000).toISOString().slice(0,10):null}
function dayStart(key,resetHour=6){return Date.parse(key+'T'+String(resetHour).padStart(2,'0')+':00:00+07:00')}
function sessionStart(session){
  const explicit=session.sessionStartedAt||session.createdAt;
  if(explicit&&Number.isFinite(+new Date(explicit)))return +new Date(explicit);
  const m=/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(session.sessionName||'');
  return m?Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`):NaN;
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
function partitionSessions(sessions,now=Date.now(),resetHour=6){
  const today=dayKey(now,resetHour),yesterday=dayKey(dayStart(today,resetHour)-DAY,resetHour);
  const keys=new Map(sessions.map(s=>[String(s._id),dayKey(sessionStart(s),resetHour)]));
  return{today,yesterday,keys};
}
function sessionGiftPipeline(ids){
  const fields=['receivedTalent','receivedTalents','receivedTalentUid','toMemberUid','cost','sessionId'];
  return[{$match:{sessionId:{$in:ids}}},{$group:{_id:Object.fromEntries(fields.map(f=>[f,'$'+f])),count:{$sum:1}}},{$project:{_id:0,gift:'$_id',count:1}}];
}
function decorateLive(rows,states,now){const groups=liveGroups(states,now);return rows.map(row=>({...row,...(groups.get(String(row.groupId))||{live:false})}))}
function createNextRankingForHour({getDb,current,readProfiles,readLocations,avatar,reconcile,clock=Date.now,resetHour=6}){
  let cached,pending,generation=0;
  async function build(force=false){
    const revision=generation,started=clock(),db=getDb();if(!db)throw Error('Database unavailable');
    const today=dayKey(started,resetHour),yesterday=dayKey(dayStart(today,resetHour)-DAY,resetHour);
    const [monthly,profiles,locations,sessions,states]=await Promise.all([current(resetHour,'',{force}),readProfiles(),readLocations(),db.collection('sessions').find({$or:[{createdAt:{$gte:new Date(dayStart(yesterday,resetHour))}},{sessionStartedAt:{$gte:new Date(dayStart(yesterday,resetHour))}}]},{projection:{profileId:1,createdAt:1,sessionStartedAt:1,sessionName:1}}).toArray(),db.collection('leaderboard_live').find({live:true,heartbeatAt:{$gt:new Date(started-90000)}}).toArray()]);
    const buckets=sessions.length?decodeGiftBuckets(await db.collection('gifts').aggregate(sessionGiftPipeline(sessions.map(s=>s._id)),{allowDiskUse:true,maxTimeMS:60000}).toArray()):[];
    const days=partitionSessions(sessions,started,resetHour);
    const scores=key=>scoreRows(profiles,buckets.filter(g=>days.keys.get(String(g.sessionId))===key),sessions,avatar);
    const daily=scores(today),prior=scores(yesterday);
    for(const kind of ['group','individual'])daily[kind]=daily[kind].map(row=>({...row,yesterday:prior[kind].find(p=>p.name===row.name&&p.groupId===row.groupId)||null}));
    const data={...monthly.data,individual:{...monthly.data.individual,daily:daily.individual,yesterday:prior.individual},group:{...monthly.data.group,daily:daily.group,yesterday:prior.group},frozen:false,dailyPeriod:{today,yesterday,resetHour,attribution:'session-start'}};
    for(const kind of ['individual','group'])for(const period of ['daily','yesterday','monthly'])data[kind][period]=decorateLive(data[kind][period],states,started);
    cached={status:'ok',data,meta:{...monthly.meta,computedAt:new Date(started).toISOString(),dailyAttribution:'session-start',liveSource:'helioscontrol-heartbeat',stale:monthly.meta?.stale===true},builtAt:started,revision};
    reconcile?.refresh(profiles).catch(()=>{});return cached;
  }
  return{invalidate(){generation++},async get(force=false){
    if(force&&pending)await pending;
    if(!cached||dayKey(clock(),resetHour)!==cached.data.dailyPeriod.today||force||clock()-cached.builtAt>15000||cached.revision!==generation){if(!pending)pending=build(force).finally(()=>pending=null);if(!cached||force||dayKey(clock(),resetHour)!==cached.data.dailyPeriod.today)await pending;else pending.catch(()=>{})}
    const result={...cached,data:structuredClone(cached.data),meta:{...cached.meta,stale:cached.meta.stale||cached.revision!==generation||clock()-cached.builtAt>15000}};
    // Expire indicators locally even when an older cached result is served.
    for(const kind of ['individual','group'])for(const period of ['daily','yesterday','monthly'])for(const row of result.data[kind][period])if(row.live&&Date.parse(row.liveExpiresAt)<=clock())row.live=false;
    result.data.reconciliation=reconcile?.status()||{state:'unavailable',warnings:[]};return result;
  }};
}
// Keep all original timing settings functional while 06:00 remains the new default.
function createNextRanking(options){
 const services=new Map(),clock=options.clock||Date.now;
 return{
  invalidate(){services.forEach(service=>service.invalidate())},
  async get(force=false,context={}){
   const hour=context.resetHour===undefined?6:Number(context.resetHour);
   if(!Number.isInteger(hour)||hour<0||hour>23)throw new RangeError('Invalid reset hour');
   const freeze=context.freezeUntil||'';
   if(typeof freeze!=='string'||(freeze&&!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(freeze)))throw new RangeError('Invalid freeze time');
   if(!services.has(hour))services.set(hour,createNextRankingForHour({...options,resetHour:hour}));
   const result=await services.get(hour).get(force),now=clock();
   const calendar=new Date(now+OFFSET).toISOString().slice(0,10);
   const frozen=!!freeze&&now<Date.parse(calendar+'T'+freeze+':00+07:00')&&now>=dayStart(dayKey(now,hour),hour);
   if(frozen)for(const kind of ['individual','group'])result.data[kind].daily=structuredClone(result.data[kind].yesterday);
   result.data.frozen=frozen;result.meta.contextKey=hour+'|'+freeze;
   return result;
  }
 };
}
module.exports={dayKey,dayStart,sessionStart,partitionSessions,liveGroups,scoreRows,sessionGiftPipeline,decorateLive,createNextRanking};

