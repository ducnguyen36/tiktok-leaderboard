'use strict';
const A=require('./leaderboardAggregation');
const {decodeGiftBuckets}=require('./leaderboardPerformance');
const DAY=86400000, OFFSET=7*3600000;
function dayKey(value){const n=+new Date(value);return Number.isFinite(n)?new Date(n+OFFSET-6*3600000).toISOString().slice(0,10):null}
function dayStart(key){return Date.parse(key+'T06:00:00+07:00')}
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
function partitionSessions(sessions,now=Date.now()){
  const today=dayKey(now),yesterday=dayKey(dayStart(today)-DAY);
  const keys=new Map(sessions.map(s=>[String(s._id),dayKey(sessionStart(s))]));
  return{today,yesterday,keys};
}
function sessionGiftPipeline(ids){
  const fields=['receivedTalent','receivedTalents','receivedTalentUid','toMemberUid','cost','sessionId'];
  return[{$match:{sessionId:{$in:ids}}},{$group:{_id:Object.fromEntries(fields.map(f=>[f,'$'+f])),count:{$sum:1}}},{$project:{_id:0,gift:'$_id',count:1}}];
}
function decorateLive(rows,states,now){const groups=liveGroups(states,now);return rows.map(row=>({...row,...(groups.get(String(row.groupId))||{live:false})}))}
function createNextRanking({getDb,current,readProfiles,readLocations,avatar,reconcile,clock=Date.now}){
  let cached,pending,generation=0;
  async function build(){
    const revision=generation,started=clock(),db=getDb();if(!db)throw Error('Database unavailable');
    const today=dayKey(started),yesterday=dayKey(dayStart(today)-DAY);
    const [monthly,profiles,locations,sessions,states]=await Promise.all([current(6,''),readProfiles(),readLocations(),db.collection('sessions').find({$or:[{createdAt:{$gte:new Date(dayStart(yesterday))}},{sessionStartedAt:{$gte:new Date(dayStart(yesterday))}}]},{projection:{profileId:1,createdAt:1,sessionStartedAt:1,sessionName:1}}).toArray(),db.collection('leaderboard_live').find({live:true,heartbeatAt:{$gt:new Date(started-90000)}}).toArray()]);
    const buckets=sessions.length?decodeGiftBuckets(await db.collection('gifts').aggregate(sessionGiftPipeline(sessions.map(s=>s._id)),{allowDiskUse:true,maxTimeMS:60000}).toArray()):[];
    const days=partitionSessions(sessions,started);
    const scores=key=>scoreRows(profiles,buckets.filter(g=>days.keys.get(String(g.sessionId))===key),sessions,avatar);
    const daily=scores(today),prior=scores(yesterday);
    const data={...monthly.data,individual:{...monthly.data.individual,daily:daily.individual,yesterday:prior.individual},group:{...monthly.data.group,daily:daily.group,yesterday:prior.group},frozen:false,dailyPeriod:{today,yesterday,resetHour:6,attribution:'session-start'}};
    for(const kind of ['individual','group'])for(const period of ['daily','yesterday','monthly'])data[kind][period]=decorateLive(data[kind][period],states,started);
    cached={status:'ok',data,meta:{...monthly.meta,computedAt:new Date(started).toISOString(),dailyAttribution:'session-start',liveSource:'helioscontrol-heartbeat',stale:monthly.meta?.stale===true},builtAt:started,revision};
    reconcile?.refresh(profiles).catch(()=>{});return cached;
  }
  return{invalidate(){generation++},async get(force=false){
    if(!cached||dayKey(clock())!==cached.data.dailyPeriod.today||force||clock()-cached.builtAt>15000||cached.revision!==generation){if(!pending)pending=build().finally(()=>pending=null);if(!cached||force||dayKey(clock())!==cached.data.dailyPeriod.today)await pending;else pending.catch(()=>{})}
    const result={...cached,data:structuredClone(cached.data),meta:{...cached.meta,stale:cached.meta.stale||cached.revision!==generation||clock()-cached.builtAt>15000}};
    // Expire indicators locally even when an older cached result is served.
    for(const kind of ['individual','group'])for(const period of ['daily','yesterday','monthly'])for(const row of result.data[kind][period])if(row.live&&Date.parse(row.liveExpiresAt)<=clock())row.live=false;
    result.data.reconciliation=reconcile?.status()||{state:'unavailable',warnings:[]};return result;
  }};
}
module.exports={dayKey,dayStart,sessionStart,partitionSessions,liveGroups,scoreRows,sessionGiftPipeline,decorateLive,createNextRanking};
