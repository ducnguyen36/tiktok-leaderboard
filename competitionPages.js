'use strict';
// Public competition score pages at /<slug> for people outside the company (accounting).
// They are mounted BEFORE the TV access middleware, so every route here does its own
// access control: admins (leaderboardAuth.isAdmin) see everything, anyone else needs a
// per-competition grant approved by an admin and tied to a random httpOnly browser cookie.
//
// Test competitions: HeliosControl's "Test DB" mode writes competitions, sessions and gifts to the
// helioscontrol_test database (getTestDb). Such a competition lives at /test-<slug>, where <slug> is
// assignSlugs() over the test DB's competitions only (newest namesake keeps the plain slug there too).
// Everything for it (board, PK stage, eliminated, gifts, access grants, snapshots) is read from and
// written to the test DB, so test grants never unlock a real competition and vice versa.
// Resolution order: the path is first looked up among the REAL competitions; only when no real
// competition owns it and it starts with "test-" is the rest looked up among the test competitions.
// So a real competition named "Test ABC" (slug test-abc) wins over a test competition named "ABC".
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),express=require('express');
const {ObjectId}=require('mongodb');
const ACCESS='competition_access',SNAPSHOTS='competition_snapshots',COOKIE='helios_comp',COOKIE_AGE=180*86400000;
const ROLES=['viewer','snapshot'],MAX_PENDING_PER_BROWSER=3,MAX_REQUESTS_PER_COMPETITION=200,MAX_SNAPSHOTS=100,NAME_MAX=60;
const LIST_TTL=30000,MISS_REFRESH=10000,LIVE_TTL=8000,ENDED_TTL=60000,WINDOW_LIVE_TTL=30000,WINDOW_TTL=60000;
const GIFT_FIELDS={_id:1,cost:1,timeStamp:1,receivedTalent:1,receivedTalentUid:1,receivedTalents:1};
// Single-segment paths that belong to the board itself; a competition never takes them.
const RESERVED=new Set(['old','new','auth','api','privacy','userdata','avatars','overlay','v1','index','competition','public','static','health','admin']);
const TEST_PREFIX='test-';
const STATIC_FILES=['competition.js','competition.css','helios-asset-23.png'];
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const validSecret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const cleanName=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim():'';
const validName=value=>{const name=cleanName(value);return name&&[...name].length<=NAME_MAX?name:''};
// "PK BATTLE 16/10" -> "pk-battle-16-10": NFKD folds Vietnamese marks and styled Unicode letters, đ is not decomposable.
function slugify(name){return String(name||'').normalize('NFKD').replace(/\p{M}+/gu,'').replace(/[đĐ]/g,'d').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'')||'cuoc-thi'}
// Most recent competition (createdAt) keeps the plain slug; older namesakes get -2, -3 ...
function assignSlugs(competitions){
  const used=new Set(),out=new Map();
  const sorted=[...competitions].sort((a,b)=>(+new Date(b.createdAt||0)-+new Date(a.createdAt||0))||String(b._id).localeCompare(String(a._id)));
  for(const comp of sorted){const base=slugify(comp.name);let slug=RESERVED.has(base)?`${base}-cuoc-thi`:base;for(let n=2;used.has(slug);n++)slug=`${base}-${n}`;used.add(slug);out.set(String(comp._id),slug)}
  return out;
}
// Two scores per participant.
// "Cuộc thi" (competition) = HeliosControl scoring, replicated from its control panel (public/newcontrol.js
// competition mode -> modules/giftProcessor.js processGiftsAndTalents):
//  * only gifts recorded in the competition's own sessions (sessions.profileId "competition_<id>"
//    from the server or "comp_<id>" from the panel) count. HeliosControl also stamps competitionId
//    on gifts of OTHER groups' sessions while its in-memory active competition lingers; the panel never shows those.
//  * a gift's talents are receivedTalents[].name (old string[] too), else receivedTalent, else "Unassigned";
//    each talent gets Math.floor(cost / talentCount). Manual corrections (negative cost) count the same way.
//  * a participant scores the sum for its exact talentName (HeliosControl keys scores by name, not uid);
//    group gifts addressed to the competition/group name count for nobody (auto-split is off in competition mode).
// "Tổng cộng" (overall) = revenue view: every gift a participant received during the competition window
// [startedAt, endedAt||now]; none before Start, also outside the competition (own group's sessions, battles ...):
//  * gifts = the competition gifts above UNION gifts of every session overlapping the window (createdAt or
//    sessionStartedAt <= window end and updatedAt >= window start) whose timeStamp lies inside the window,
//    deduplicated by gift _id (read through the gifts {sessionId,timeStamp} index, never a range scan over all gifts).
//  * receivers are receivedTalents[] ({name,uid}) else receivedTalent/receivedTalentUid; each receiver gets
//    Math.floor(cost / receiverCount); a receiver counts for a participant when its uid equals the participant's
//    talentUid (both non-empty) OR its name equals talentName. Negative manual corrections count too.
function giftTalents(gift){
  if(Array.isArray(gift.receivedTalents)&&gift.receivedTalents.length)return gift.receivedTalents.map(t=>t&&typeof t==='object'&&t.name?t.name:String(t));
  return gift.receivedTalent?[gift.receivedTalent]:['Unassigned'];
}
function giftReceivers(gift){
  if(Array.isArray(gift.receivedTalents)&&gift.receivedTalents.length)return gift.receivedTalents.map(t=>t&&typeof t==='object'?{name:String(t.name||''),uid:String(t.uid||'')}:{name:String(t),uid:''});
  return gift.receivedTalent?[{name:String(gift.receivedTalent),uid:String(gift.receivedTalentUid||'')}]:[{name:'Unassigned',uid:''}];
}
function scoreGifts(gifts){
  const scores=new Map();
  for(const gift of gifts){const names=giftTalents(gift),share=Math.floor((Number(gift.cost)||0)/names.length);for(const name of names)scores.set(name,(scores.get(name)||0)+share)}
  return scores;
}
// Overall scores by participant index. Gifts whose _id is in skip (or already seen here) are counted once only.
function scoreOverall(participants,gifts,{skip=null,scores=null}={}){
  const byUid=new Map(),byName=new Map(),ids=new Set(),out=scores?[...scores]:(participants||[]).map(()=>0);
  const add=(map,key,i)=>{if(!key)return;const list=map.get(key);if(list)list.push(i);else map.set(key,[i])};
  (participants||[]).forEach((p,i)=>{add(byUid,String(p.talentUid||''),i);add(byName,String(p.talentName||''),i)});
  for(const gift of gifts){
    const id=gift._id==null?null:String(gift._id);if(id!==null){if(ids.has(id)||skip?.has(id))continue;ids.add(id)}
    const receivers=giftReceivers(gift),share=Math.floor((Number(gift.cost)||0)/receivers.length);
    for(const r of receivers){const hit=new Set([...(r.uid&&byUid.get(r.uid)||[]),...(byName.get(r.name)||[])]);for(const i of hit)out[i]+=share}
  }
  return{scores:out,ids};
}
function overallScores(participants,gifts,windowGifts=[]){const window=scoreOverall(participants,windowGifts);return scoreOverall(participants,gifts,{skip:window.ids,scores:window.scores}).scores}
// HeliosControl writes competitions.eliminated [{talentName,at}] = who is OUT right now (revived names drop off).
// Missing on older competitions: nobody is out. Returns talentName -> ISO time of elimination.
// Each entry may carry rank/of: HeliosControl's panel position when the talent went out (1 = best) and how
// many were still in just before. Returns talentName -> {at: ISO|null, rank, of} (rank/of null when missing).
const posInt=v=>Number.isInteger(Number(v))&&Number(v)>0?Number(v):null;
// Entries may also carry round: the phase label when it happened ('PK', 'Voting', 'Chasing 1'), shown grouped.
const LABEL_MAX=40;
const cleanLabel=value=>{const text=cleanName(value);return text?[...text].slice(0,LABEL_MAX).join(''):''};
function eliminatedMap(list){
  const out=new Map();if(!Array.isArray(list))return out;
  for(const e of list){const name=typeof e?.talentName==='string'?e.talentName:'';if(!name)continue;const at=new Date(e?.at);out.set(name,{at:Number.isFinite(+at)?at.toISOString():null,rank:posInt(e?.rank),of:posInt(e?.of),round:cleanLabel(e?.round)||null})}
  return out;
}
// Fill rank/of (and round) from eliminatedLog when an eliminated[] entry lacks them: the 'out' line of the same talent and moment.
function withLogRanks(list,log){
  if(!Array.isArray(list))return [];if(!Array.isArray(log))return list;
  return list.map(e=>{
    const needRank=!posInt(e?.rank),needRound=!cleanLabel(e?.round);if(!needRank&&!needRound)return e;
    const at=+new Date(e?.at),lines=[...log].reverse().filter(l=>l?.action==='out'&&l.talentName===e?.talentName&&+new Date(l.at)===at);
    const rank=needRank&&lines.find(l=>posInt(l.rank)),round=needRound&&lines.find(l=>cleanLabel(l.round));
    return rank||round?{...e,...(rank?{rank:rank.rank,of:rank.of}:{}),...(round?{round:round.round}:{})}:e;
  });
}
// "Who went out in each round", when HeliosControl labels eliminations with a round: from the eliminatedLog
// 'out' lines (a talent revived since stays listed, flagged back:true) plus labelled eliminated[] entries the
// log lacks. Newest round (by its latest elimination) first; null when nothing carries a round.
function eliminationRounds(eliminated,log){
  const now=eliminatedMap(eliminated),seen=new Set(),groups=new Map();
  const add=(round,talentName,at)=>{const key=`${round}\u0000${talentName}\u0000${at}`;if(seen.has(key))return;seen.add(key);const group=groups.get(round)||groups.set(round,{round,last:-Infinity,talents:[]}).get(round);const t=msOf(at);if(t>group.last)group.last=t;group.talents.push({talentName,at:at||null,back:!now.has(talentName)||msOf(now.get(talentName).at)>t})};
  if(Array.isArray(log))for(const l of log){const round=cleanLabel(l?.round),name=typeof l?.talentName==='string'?l.talentName:'';if(l?.action!=='out'||!round||!name)continue;const at=new Date(l.at);add(round,name,Number.isFinite(+at)?at.toISOString():null)}
  for(const [name,e] of now)if(e.round)add(e.round,name,e.at);
  if(!groups.size)return null;
  return [...groups.values()].sort((a,b)=>b.last-a.last).slice(0,30).map(g=>({round:g.round,talents:g.talents.sort((a,b)=>msOf(a.at)-msOf(b.at)||a.talentName.localeCompare(b.talentName)).slice(0,60)}));
}
// competitions.pkStage (written by HeliosControl, see the PK stage contract): read defensively, since older
// competitions have none and a newer panel may write it partially. Names ≤ 60, ≤ 60 talents, ≤ 40 matches,
// ≤ 6 talents per match, labels ≤ 40. Returns null when there is nothing usable.
const REVIVE_MODES=['gap','fixed','formula','manual'],LOWER_BY=['seed','score'];
const PK_PHASES=['setup','pk','voting','chasing','done'],MATCH_STATUS=['pending','running','reviving','done'],VOTING_STATUS=['pending','running','done'];
const iso=v=>{if(v==null||v==='')return null;const d=new Date(v);return Number.isFinite(+d)?d.toISOString():null};
const names=(list,max=60)=>{const out=[];if(Array.isArray(list))for(const v of list){const n=validName(v);if(n&&!out.includes(n))out.push(n);if(out.length>=max)break}return out};
const oneName=v=>validName(v)||null;
const nonNeg=v=>Number.isFinite(Number(v))&&Number(v)>=0?Math.floor(Number(v)):0;
function cleanPkStage(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const phase=PK_PHASES.includes(raw.phase)?raw.phase:'setup',firstTo=posInt(raw.firstTo)||2,takeLower=posInt(raw.takeLower);
  const tracks=[];if(Array.isArray(raw.tracks))for(const t of raw.tracks.slice(0,6)){const id=cleanLabel(t?.id);if(!id||tracks.some(x=>x.id===id))continue;tracks.push({id,label:cleanLabel(t?.label)||id,fromRank:posInt(t?.fromRank),toRank:posInt(t?.toRank)})}
  const matches=[];
  if(Array.isArray(raw.matches))for(const m of raw.matches.slice(0,40)){
    const id=cleanLabel(m?.id),talents=names(m?.talents,6);if(!id||!talents.length||matches.some(x=>x.id===id))continue;
    const points={};for(const n of talents)points[n]=nonNeg(m?.points&&typeof m.points==='object'?m.points[n]:0);
    const winner=talents.includes(validName(m?.winner))?validName(m.winner):null;
    const revives=[];if(Array.isArray(m?.revives))for(const r of m.revives.slice(0,20)){const n=validName(r?.talentName);if(!n||!talents.includes(n))continue;const target=r?.target==null||r.target===''||!Number.isFinite(Number(r.target))||Number(r.target)<0?null:Math.round(Number(r.target));revives.push({talentName:n,at:iso(r?.at),success:r?.success===true?true:r?.success===false?false:null,mode:REVIVE_MODES.includes(r?.mode)?r.mode:null,target,round:posInt(r?.round)})}
    // Round history (organiser update): a tie gives no point and is replayed; a successful revive cancels the winning round.
    const rounds=[];if(Array.isArray(m?.rounds))m.rounds.slice(0,30).forEach((r,i)=>{if(!r||typeof r!=='object')return;const diamonds={};if(r.diamonds&&typeof r.diamonds==='object')for(const n of talents)if(Number.isFinite(Number(r.diamonds[n])))diamonds[n]=Math.round(Number(r.diamonds[n]));
      const win=talents.includes(validName(r.winner))?validName(r.winner):null,cancel=talents.includes(validName(r.cancelledByRevive))?validName(r.cancelledByRevive):null;rounds.push({n:posInt(r.n)||i+1,winner:win,tied:win?[]:names(r.tied,6).filter(n=>talents.includes(n)),diamonds,cancelledByRevive:win?cancel:null})});
    matches.push({id,track:cleanLabel(m?.track)||null,order:posInt(m?.order),talents,status:MATCH_STATUS.includes(m?.status)?m.status:'pending',points,winner,losers:names(m?.losers,6).filter(n=>talents.includes(n)&&n!==winner),rounds,revives,startedAt:iso(m?.startedAt),endedAt:iso(m?.endedAt)});
  }
  const tables=raw.tables&&typeof raw.tables==='object'?{upper:names(raw.tables.upper),lower:names(raw.tables.lower),cut:names(raw.tables.cut),lowerBy:LOWER_BY.includes(raw.tables.lowerBy)?raw.tables.lowerBy:'seed'}:null;
  const v=raw.voting&&typeof raw.voting==='object'?raw.voting:null;
  const voting=v?{order:names(v.order),done:names(v.done),current:oneName(v.current),status:VOTING_STATUS.includes(v.status)?v.status:'pending'}:null;
  const seed=names(raw.seed),revivesUsed=names(raw.revivesUsed);
  if(!matches.length&&!seed.length&&!(tables&&(tables.upper.length||tables.lower.length))&&!(voting&&voting.order.length))return null;
  return{phase,firstTo,takeLower,seed,tracks,matches,revivesUsed,tables,voting,updatedAt:iso(raw.updatedAt)};
}
// competitions.standing (HeliosControl's panel zones): passed through cleaned, for snapshots and future use.
const STANDING_GROUPS=['upper','lower','out'];
function cleanStanding(raw){
  if(!raw||typeof raw!=='object'||!Array.isArray(raw.rows))return null;
  const rows=[];for(const r of raw.rows.slice(0,60)){const n=validName(r?.talentName);if(!n||rows.some(x=>x.talentName===n))continue;rows.push({talentName:n,place:posInt(r?.place),group:STANDING_GROUPS.includes(r?.group)?r.group:null,zone:cleanLabel(r?.zone)||null})}
  if(!rows.length)return null;
  return{rows,safeAfter:posInt(raw.safeAfter),cutAfter:posInt(raw.cutAfter),safeLabel:cleanLabel(raw.safeLabel)||null,cutLabel:cleanLabel(raw.cutLabel)||null,updatedAt:iso(raw.updatedAt)};
}
// Successful PK revives per talent (match.revives success:true); they are not in eliminatedLog since a PK loser is not out.
function pkReviveCounts(pk){const out=new Map();for(const m of pk?.matches||[])for(const r of m.revives)if(r.success===true)out.set(r.talentName,(out.get(r.talentName)||0)+1);return out}
// Fallback when HeliosControl wrote no rank (older competitions or panel versions): M = players still in just
// before that elimination; talents out at the same moment take M-g+1..M by their score at that moment
// (higher score = better rank). With eliminatedLog, "still in" is replayed from the log (revivals at that
// same moment count first, as on the panel); without it: those competing now + everyone out then or later.
const msOf=v=>{const t=Date.parse(v instanceof Date?v.toISOString():v||'');return Number.isFinite(t)?t:-Infinity};
function stillInAt(names,log,t){
  const last=new Map();for(const l of log){const at=msOf(l?.at);if(!names.includes(l?.talentName)||!['out','in'].includes(l?.action))continue;if(at<t||(at===t&&l.action==='in')){const prev=last.get(l.talentName);if(!prev||at>=prev.at)last.set(l.talentName,{at,action:l.action})}}
  return names.filter(n=>last.get(n)?.action!=='out').length;
}
function fallbackRanks(out,participants,gifts,log=null){
  const names=(participants||[]).map(p=>p.talentName||''),active=names.filter(n=>!out.has(n)).length,moments=new Map(),useLog=Array.isArray(log)&&log.length>0;
  for(const [name,e] of out){if(e.rank||!names.includes(name))continue;const key=msOf(e.at);(moments.get(key)||moments.set(key,[]).get(key)).push(name)}
  for(const [t,group] of moments){
    // Out together at t: from the log (including talents revived since), else those still out with that time.
    const fromLog=useLog?[...new Set(log.filter(l=>l?.action==='out'&&msOf(l.at)===t&&names.includes(l.talentName)).map(l=>l.talentName))]:[];
    const together=fromLog.length?[...new Set([...fromLog,...group])]:[...out.entries()].filter(([n,e])=>names.includes(n)&&msOf(e.at)===t).map(([n])=>n);
    const m=useLog&&fromLog.length?stillInAt(names,log,t):active+[...out.values()].filter(e=>msOf(e.at)>t).length+together.length;
    const scores=scoreGifts((gifts||[]).filter(g=>(Number(g.timeStamp)||0)<=t));
    together.sort((a,b)=>(scores.get(b)||0)-(scores.get(a)||0)||a.localeCompare(b)).forEach((n,i)=>{const e=out.get(n);if(e&&!e.rank&&group.includes(n))out.set(n,{...e,rank:m-together.length+1+i,of:m,computed:true})});
  }
  return out;
}
// Successful revivals per talent: the 'in' lines of eliminatedLog (shown as ↺N).
function reviveCounts(log){const out=new Map();if(Array.isArray(log))for(const l of log)if(l?.action==='in'&&typeof l.talentName==='string')out.set(l.talentName,(out.get(l.talentName)||0)+1);return out}
const eliminatedFields=e=>e?{eliminated:true,eliminatedAt:e.at,eliminatedRank:e.rank,eliminatedOf:e.of,eliminatedRankSource:e.rank?(e.computed?'computed':'helioscontrol'):null,eliminatedRound:e.round||null}:{eliminated:false,eliminatedAt:null,eliminatedRank:null,eliminatedOf:null,eliminatedRankSource:null,eliminatedRound:null};
// rows/groups carry both modes; overall (array by participant index) defaults to the competition gifts alone.
// Eliminated talents keep their rows (flagged) and still count in their group: the gifts are the group's income.
// revives = eliminatedLog 'in' lines + successful PK revives. pkStage/standing/rounds are added only when present.
function buildBoard(participants,gifts,{windowGifts=[],overall=null,eliminated=null,eliminatedLog=null,pkStage=null,standing=null}={}){
  const pk=cleanPkStage(pkStage),stand=cleanStanding(standing),rounds=eliminationRounds(eliminated,eliminatedLog);
  const competition=scoreGifts(gifts),total=overall||overallScores(participants,gifts,windowGifts),out=fallbackRanks(eliminatedMap(eliminated),participants,gifts,eliminatedLog),revives=reviveCounts(eliminatedLog),pkRevives=pkReviveCounts(pk);
  const rows=(participants||[]).map((p,i)=>({talentName:p.talentName||'',talentUid:String(p.talentUid||''),profileId:String(p.profileId||''),profileName:p.profileName||'',competition:competition.get(p.talentName)||0,overall:total[i]||0,...eliminatedFields(out.get(p.talentName||'')),revives:(revives.get(p.talentName||'')||0)+(pkRevives.get(p.talentName||'')||0)}));
  rows.sort((a,b)=>b.competition-a.competition||b.overall-a.overall||a.talentName.localeCompare(b.talentName));
  const groups=new Map();
  for(const row of rows){const key=row.profileId||row.profileName,group=groups.get(key)||{profileId:row.profileId,profileName:row.profileName,competition:0,overall:0};group.competition+=row.competition;group.overall+=row.overall;groups.set(key,group)}
  return{rows,groups:[...groups.values()].sort((a,b)=>b.competition-a.competition||b.overall-a.overall),...(pk?{pkStage:pk}:{}),...(stand?{standing:stand}:{}),...(rounds?{rounds}:{})};
}
// Snapshots taken before the two modes only stored rows[].total (= competition); overall is then unknown (null).
const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
function snapshotEntry(entry,row){const out={profileId:String(entry?.profileId||''),profileName:entry?.profileName||'',competition:num(entry?.competition)??num(entry?.total)??0,overall:num(entry?.overall)};return row?{talentName:entry?.talentName||'',talentUid:String(entry?.talentUid||''),...out,eliminated:entry?.eliminated===true,eliminatedAt:entry?.eliminated===true&&entry?.eliminatedAt?String(entry.eliminatedAt):null,eliminatedRank:entry?.eliminated===true?posInt(entry?.eliminatedRank):null,eliminatedOf:entry?.eliminated===true?posInt(entry?.eliminatedOf):null,eliminatedRankSource:entry?.eliminated===true&&posInt(entry?.eliminatedRank)?(entry.eliminatedRankSource==='computed'?'computed':'helioscontrol'):null,eliminatedRound:entry?.eliminated===true&&cleanLabel(entry?.eliminatedRound)||null,revives:posInt(entry?.revives)||0}:out}
// Stored rounds (snapshots) are re-cleaned on the way out like everything else read back from the database.
function cleanRounds(list){if(!Array.isArray(list))return null;const out=[];for(const g of list.slice(0,30)){const round=cleanLabel(g?.round);if(!round)continue;const talents=[];for(const t of Array.isArray(g?.talents)?g.talents.slice(0,60):[]){const n=validName(t?.talentName);if(n)talents.push({talentName:n,at:iso(t?.at),back:t?.back===true})}if(talents.length)out.push({round,talents})}return out.length?out:null}
function cookieSecret(req){for(const part of (req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===COOKIE)return part.slice(i+1).trim()}return ''}
// Small in-memory budget; behind the Cloudflare tunnel every visitor shares one IP, so it is global.
function createBudget(max,windowMs,clock){let hits=[];return()=>{const now=clock();hits=hits.filter(t=>now-t<windowMs);if(hits.length>=max)return false;hits.push(now);return true}}
// Each competition object carries its source (real or test DB) under this symbol; the JSON never shows it.
const SOURCE=Symbol('competitionSource');
function createCompetitionPages({getDb,getTestDb=null,auth,publicDir=path.join(__dirname,'public'),assetVersion=()=>'',clock=Date.now}){
  const router=express.Router(),json=express.json({limit:'4kb'});
  const requestBudget=createBudget(40,600000,clock),snapshotBudget=createBudget(30,600000,clock);
  // One source per database: its own competition list, slugs and caches.
  const makeSource=(test,get)=>({test,prefix:test?TEST_PREFIX:'',db(){const d=get();if(!d)throw Object.assign(Error('Database unavailable'),{status:503});return d},
    list:null,listAt:0,listLoading:null,missAt:0,giftCache:new Map(),eliminatedCache:new Map(),windowCache:new Map(),windowLoading:new Map()});
  const real=makeSource(false,getDb),testSource=typeof getTestDb==='function'?makeSource(true,getTestDb):null;
  const src=comp=>comp[SOURCE]||real,db=comp=>src(comp).db();
  const noStore=res=>res.set({'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});
  const fail=(res,code,error)=>noStore(res).status(code).json({status:'error',error});
  const endpoint=handler=>async(req,res,next)=>{try{await handler(req,res,next)}catch(error){if(!res.headersSent)fail(res,error.status||503,error.status===503||!error.status?'unavailable':error.message)}};
  // comp.slug is the full path segment: "<slug>" for real competitions, "test-<slug>" for test ones.
  async function competitions(force=false,source=real){
    if(!force&&source.list&&clock()-source.listAt<LIST_TTL)return source.list;
    if(!source.listLoading)source.listLoading=source.db().collection('competitions').find({},{projection:{name:1,status:1,createdAt:1,startedAt:1,endedAt:1,participants:1,tiktokUsername:1}}).toArray().then(docs=>{const slugs=assignSlugs(docs);source.list=docs.map(doc=>({...doc,slug:source.prefix+slugs.get(String(doc._id)),[SOURCE]:source}));source.listAt=clock();return source.list}).finally(()=>source.listLoading=null);
    return source.listLoading;
  }
  async function findIn(source,slug){
    let found=(await competitions(false,source)).find(c=>c.slug===slug);
    // A competition created in HeliosControl a moment ago: re-read, but at most every 10 s for unknown paths.
    if(!found&&clock()-source.missAt>MISS_REFRESH){source.missAt=clock();found=(await competitions(true,source)).find(c=>c.slug===slug)}
    return found||null;
  }
  // Real competitions first; "test-..." falls back to the test DB only when no real competition owns the path.
  async function bySlug(slug){
    if(typeof slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>96||RESERVED.has(slug))return null;
    const found=slug.length<=90?await findIn(real,slug):null;
    if(found||!testSource||!slug.startsWith(TEST_PREFIX)||slug.length===TEST_PREFIX.length)return found;
    return findIn(testSource,slug);
  }
  async function loadGifts(comp,fresh=false){
    const {giftCache}=src(comp),key=String(comp._id),cached=giftCache.get(key),ttl=comp.status==='active'?LIVE_TTL:ENDED_TTL;
    if(!fresh&&cached&&clock()-cached.at<ttl)return cached.gifts;
    const d=db(comp),sessions=await d.collection('sessions').find({profileId:{$in:[`competition_${key}`,`comp_${key}`]}},{projection:{_id:1}}).toArray();
    const query={competitionId:comp._id};
    // Competitions recorded before session tagging fall back to every gift stamped with the competition.
    if(sessions.length){const ids=sessions.map(s=>s._id);query.sessionId={$in:[...ids,...ids.map(String)]}}
    const gifts=await d.collection('gifts').find(query,{projection:GIFT_FIELDS}).toArray();
    giftCache.delete(key);giftCache.set(key,{at:clock(),gifts});if(giftCache.size>6)giftCache.delete(giftCache.keys().next().value);
    return gifts;
  }
  // Elimination and PK state (pkStage, standing) are read fresh at the gifts' pace, not from the 30 s competition list.
  async function loadEliminated(comp,fresh=false){
    const {eliminatedCache}=src(comp),key=String(comp._id),cached=eliminatedCache.get(key),ttl=comp.status==='active'?LIVE_TTL:ENDED_TTL;
    if(!fresh&&cached&&clock()-cached.at<ttl)return cached.list;
    const doc=await db(comp).collection('competitions').findOne({_id:comp._id},{projection:{eliminated:1,eliminatedLog:1,pkStage:1,standing:1}}),log=Array.isArray(doc?.eliminatedLog)?doc.eliminatedLog:[],list=withLogRanks(Array.isArray(doc?.eliminated)?doc.eliminated:[],log);list.log=log;list.pkStage=doc?.pkStage||null;list.standing=doc?.standing||null;
    eliminatedCache.delete(key);eliminatedCache.set(key,{at:clock(),list});if(eliminatedCache.size>6)eliminatedCache.delete(eliminatedCache.keys().next().value);
    return list;
  }
  // "Tổng cộng" part outside the competition gifts: scores of every gift in sessions overlapping the window.
  // Heavier, so it is cached longer and concurrent loads share one query; the competition gifts are added per request.
  const participantSig=comp=>JSON.stringify((comp.participants||[]).map(p=>[p.talentName||'',String(p.talentUid||'')]));
  async function loadWindow(comp,fresh=false){
    const {windowCache,windowLoading}=src(comp),key=String(comp._id),sig=participantSig(comp),cached=windowCache.get(key),ttl=comp.status==='active'?WINDOW_LIVE_TTL:WINDOW_TTL;
    if(!fresh&&cached&&cached.sig===sig&&clock()-cached.at<ttl)return cached;
    if(!fresh&&windowLoading.has(key))return windowLoading.get(key);
    const load=(async()=>{
      // Not started yet (HeliosControl lets a competition sit in 'created' while it is prepared): no window,
      // so "Tổng cộng" is just the competition gifts, which only exist after Start.
      const started=comp.status!=='created'&&comp.startedAt,start=started?+new Date(comp.startedAt):0,end=comp.endedAt?+new Date(comp.endedAt):clock();let gifts=[];
      if(start>0&&end>=start){
        const d=db(comp),from=new Date(start),to=new Date(end);
        const sessions=await d.collection('sessions').find({$and:[{$or:[{createdAt:{$lte:to}},{sessionStartedAt:{$lte:to}}]},{updatedAt:{$gte:from}}]},{projection:{_id:1}}).toArray();
        if(sessions.length){const ids=sessions.map(s=>s._id);gifts=await d.collection('gifts').find({sessionId:{$in:[...ids,...ids.map(String)]},timeStamp:{$gte:start,$lte:end}},{projection:GIFT_FIELDS}).toArray()}
      }
      const {scores,ids}=scoreOverall(comp.participants,gifts),entry={at:clock(),sig,scores,ids};
      windowCache.delete(key);windowCache.set(key,entry);if(windowCache.size>6)windowCache.delete(windowCache.keys().next().value);
      return entry;
    })().finally(()=>{if(windowLoading.get(key)===load)windowLoading.delete(key)});
    windowLoading.set(key,load);return load;
  }
  async function snapshotsOf(comp){return db(comp).collection(SNAPSHOTS).find({competitionId:String(comp._id)}).sort({at:-1}).limit(MAX_SNAPSHOTS).toArray()}
  async function access(req,comp){
    if(await auth.isAdmin(req))return{admin:true,role:'admin',request:null};
    const secret=cookieSecret(req);if(!validSecret(secret))return{admin:false,role:null,request:null};
    const request=await db(comp).collection(ACCESS).findOne({competitionId:String(comp._id),secretHash:hash(secret)});
    return{admin:false,role:request?.status==='approved'&&ROLES.includes(request.role)?request.role:null,request};
  }
  // Non-admin writes: browser-enforced same origin plus a JSON body (a cross-site form cannot send one).
  function sameOrigin(req){
    const origin=auth.origin||`${req.protocol}://${req.get('host')}`;
    return req.get('origin')===origin&&req.get('sec-fetch-site')!=='cross-site'&&req.is('application/json')==='application/json';
  }
  // Admins pass leaderboardAuth's CSRF check; everyone else needs same origin + the given role.
  async function writer(req,res,comp,roles){
    if(await auth.isAdmin(req)){const admin=await auth.adminMutation(req,res);return admin?{admin:true,by:admin.email||'admin'}:null}
    if(!sameOrigin(req)){fail(res,403,'same_origin_required');return null}
    const grant=await access(req,comp);if(!grant.role){fail(res,401,'access_required');return null}
    if(!roles.includes(grant.role)){fail(res,403,'role_required');return null}
    return{admin:false,by:grant.request.name};
  }
  const publicCompetition=comp=>({id:String(comp._id),name:comp.name||'',slug:comp.slug,status:comp.status||'created',createdAt:comp.createdAt||null,startedAt:comp.startedAt||null,endedAt:comp.endedAt||null,...(src(comp).test?{test:true}:{})});
  // A snapshot taken during the PK stage keeps the PK state (matches, tables, voting) and round list of its time.
  const publicSnapshot=(snap,admin)=>{const pk=cleanPkStage(snap.pkStage),stand=cleanStanding(snap.standing),rounds=cleanRounds(snap.rounds);return{id:String(snap._id),name:snap.name,at:snap.at,createdAt:snap.createdAt,createdBy:admin?snap.createdBy:undefined,rows:(snap.rows||[]).map(r=>snapshotEntry(r,true)),groups:(snap.groups||[]).map(g=>snapshotEntry(g,false)),...(pk?{pkStage:pk}:{}),...(stand?{standing:stand}:{}),...(rounds?{rounds}:{})}};
  const competitionFor=handler=>endpoint(async(req,res)=>{const comp=await bySlug(req.params.slug);if(!comp)return fail(res,404,'not_found');return handler(req,res,comp)});
  async function liveBoard(comp,fresh=false){
    const [gifts,window,eliminated]=await Promise.all([loadGifts(comp,fresh),loadWindow(comp,fresh),loadEliminated(comp,fresh)]);
    const overall=scoreOverall(comp.participants,gifts,{skip:window.ids,scores:window.scores}).scores;
    return{at:clock(),...buildBoard(comp.participants,gifts,{overall,eliminated,eliminatedLog:eliminated.log,pkStage:eliminated.pkStage,standing:eliminated.standing})};
  }

  for(const file of STATIC_FILES)router.get(`/${file}`,(req,res)=>{res.set({'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.sendFile(file,{root:publicDir})});
  router.get('/api/competitions',endpoint(async(req,res)=>{
    if(!await auth.isAdmin(req))return fail(res,403,'admin_required');
    // Test competitions are listed too (test:true, url /test-<slug>); an unreachable test DB just leaves them out.
    const load=async source=>{const d=source.db();return Promise.all([competitions(true,source),d.collection(ACCESS).find({status:'pending'},{projection:{competitionId:1}}).toArray()])};
    const [[comps,pending],[tests,testPending]]=await Promise.all([load(real),testSource?load(testSource).catch(()=>[[],[]]):[[],[]]]);
    const counts=new Map();for(const [source,list] of [[real,pending],[testSource,testPending]]){const c={};for(const p of list)c[p.competitionId]=(c[p.competitionId]||0)+1;counts.set(source,c)}
    // A test competition whose path a real one owns is unreachable, so it is left out of the list.
    const realSlugs=new Set(comps.map(c=>c.slug)),all=[...comps,...tests.filter(c=>!realSlugs.has(c.slug))];
    noStore(res).json({status:'ok',competitions:all.sort((a,b)=>+new Date(b.createdAt||0)-+new Date(a.createdAt||0)).map(c=>({...publicCompetition(c),url:`/${c.slug}`,participants:(c.participants||[]).length,pending:counts.get(src(c))[String(c._id)]||0}))});
  }));
  router.get('/api/competitions/:slug/state',competitionFor(async(req,res,comp)=>{
    const grant=await access(req,comp);
    noStore(res).json({status:'ok',competition:publicCompetition(comp),admin:grant.admin,role:grant.role,request:grant.request?{name:grant.request.name,status:grant.request.status}:null});
  }));
  router.post('/api/competitions/:slug/request',json,competitionFor(async(req,res,comp)=>{
    if(!sameOrigin(req))return fail(res,403,'same_origin_required');
    const name=validName(req.body?.name);if(!name)return fail(res,400,'invalid_name');
    const col=db(comp).collection(ACCESS);let secret=cookieSecret(req);
    if(!validSecret(secret)){secret=crypto.randomBytes(32).toString('base64url');res.cookie(COOKIE,secret,{httpOnly:true,sameSite:'lax',secure:Boolean(auth.origin?.startsWith('https:')),path:'/',maxAge:COOKIE_AGE})}
    const secretHash=hash(secret),competitionId=String(comp._id),existing=await col.findOne({competitionId,secretHash}),now=new Date(clock());
    if(existing?.status==='approved')return noStore(res).json({status:'ok',request:{name:existing.name,status:existing.status}});
    if(existing?.status!=='pending'){
      if(!requestBudget())return fail(res,429,'rate_limited');
      if(await col.countDocuments({secretHash,status:'pending'})>=MAX_PENDING_PER_BROWSER)return fail(res,429,'too_many_pending');
      if(!existing&&await col.countDocuments({competitionId})>=MAX_REQUESTS_PER_COMPETITION)return fail(res,429,'too_many_requests');
    }
    if(existing)await col.updateOne({_id:existing._id},{$set:{name,status:'pending',role:null,updatedAt:now}});
    else await col.insertOne({_id:crypto.randomBytes(12).toString('hex'),competitionId,name,secretHash,status:'pending',role:null,createdAt:now,updatedAt:now});
    noStore(res).json({status:'ok',request:{name,status:'pending'}});
  }));
  router.get('/api/competitions/:slug/board',competitionFor(async(req,res,comp)=>{
    const grant=await access(req,comp);if(!grant.role)return fail(res,401,'access_required');
    const [snaps,live]=await Promise.all([snapshotsOf(comp),liveBoard(comp)]);
    noStore(res).json({status:'ok',competition:publicCompetition(comp),admin:grant.admin,role:grant.role,canSnapshot:grant.admin||grant.role==='snapshot',live,snapshots:snaps.map(s=>publicSnapshot(s,grant.admin))});
  }));
  router.post('/api/competitions/:slug/snapshots',json,competitionFor(async(req,res,comp)=>{
    const who=await writer(req,res,comp,['snapshot']);if(!who)return;
    const name=validName(req.body?.name);if(!name)return fail(res,400,'invalid_name');
    if(!snapshotBudget())return fail(res,429,'rate_limited');
    const col=db(comp).collection(SNAPSHOTS),competitionId=String(comp._id);
    if(await col.countDocuments({competitionId})>=MAX_SNAPSHOTS)return fail(res,409,'too_many_snapshots');
    const board=await liveBoard(comp,true);
    const doc={_id:new ObjectId(),competitionId,name,at:board.at,createdAt:new Date(board.at),createdBy:who.by,rows:board.rows,groups:board.groups,...(board.pkStage?{pkStage:board.pkStage}:{}),...(board.standing?{standing:board.standing}:{}),...(board.rounds?{rounds:board.rounds}:{})};
    await col.insertOne(doc);noStore(res).json({status:'ok',snapshot:publicSnapshot(doc,who.admin)});
  }));
  router.post('/api/competitions/:slug/snapshots/:id/rename',json,competitionFor(async(req,res,comp)=>{
    if(!/^[a-f0-9]{24}$/.test(req.params.id))return fail(res,400,'invalid_snapshot');
    const who=await writer(req,res,comp,['snapshot']);if(!who)return;
    const name=validName(req.body?.name);if(!name)return fail(res,400,'invalid_name');
    const result=await db(comp).collection(SNAPSHOTS).updateOne({_id:new ObjectId(req.params.id),competitionId:String(comp._id)},{$set:{name,renamedAt:new Date(clock()),renamedBy:who.by}});
    if(!result.matchedCount)return fail(res,404,'not_found');noStore(res).json({status:'ok'});
  }));
  router.post('/api/competitions/:slug/snapshots/:id/delete',json,competitionFor(async(req,res,comp)=>{
    if(!/^[a-f0-9]{24}$/.test(req.params.id))return fail(res,400,'invalid_snapshot');
    if(!await auth.isAdmin(req))return fail(res,403,'admin_required');if(!await auth.adminMutation(req,res))return;
    const result=await db(comp).collection(SNAPSHOTS).deleteOne({_id:new ObjectId(req.params.id),competitionId:String(comp._id)});
    if(!result.deletedCount)return fail(res,404,'not_found');noStore(res).json({status:'ok'});
  }));
  router.get('/api/competitions/:slug/requests',competitionFor(async(req,res,comp)=>{
    if(!await auth.isAdmin(req))return fail(res,403,'admin_required');
    const docs=await db(comp).collection(ACCESS).find({competitionId:String(comp._id),status:{$in:['pending','approved']}},{projection:{secretHash:0}}).sort({createdAt:-1}).toArray();
    noStore(res).json({status:'ok',requests:docs.map(d=>({id:d._id,name:d.name,status:d.status,role:d.role||null,createdAt:d.createdAt,updatedAt:d.updatedAt,decidedBy:d.decidedBy||null}))});
  }));
  router.post('/api/competitions/:slug/requests/:id',json,competitionFor(async(req,res,comp)=>{
    if(!/^[a-f0-9]{24}$/.test(req.params.id))return fail(res,400,'invalid_request');
    const admin=await auth.adminMutation(req,res);if(!admin)return;
    const action=req.body?.action;if(![...ROLES,'revoke'].includes(action))return fail(res,400,'invalid_action');
    const set=action==='revoke'?{status:'revoked',role:null}:{status:'approved',role:action};
    const result=await db(comp).collection(ACCESS).updateOne({_id:req.params.id,competitionId:String(comp._id)},{$set:{...set,updatedAt:new Date(clock()),decidedBy:admin.email||'admin'}});
    if(!result.matchedCount)return fail(res,404,'not_found');noStore(res).json({status:'ok'});
  }));
  // Last: any other single-segment path that names a competition. Everything else falls through untouched.
  router.get('/:slug',endpoint(async(req,res,next)=>{
    const slug=req.params.slug;
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||RESERVED.has(slug)||fs.existsSync(path.join(publicDir,slug)))return next();
    const comp=await bySlug(slug).catch(()=>null);if(!comp)return next();
    const version=encodeURIComponent(assetVersion()||'');
    const html=fs.readFileSync(path.join(publicDir,'competition.html'),'utf8').replace('/competition.css',`/competition.css?v=${version}`).replace('/competition.js',`/competition.js?v=${version}`);
    noStore(res).set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'").type('html').send(html);
  }));
  const indexes=d=>Promise.all([d.collection(ACCESS).createIndex({competitionId:1,secretHash:1}),d.collection(ACCESS).createIndex({secretHash:1,status:1}),d.collection(SNAPSHOTS).createIndex({competitionId:1,at:-1})]);
  // The test DB's indexes are best effort: a failure there never blocks the real pages.
  async function ensureIndexes(){await indexes(real.db());if(testSource)await indexes(testSource.db()).catch(error=>console.error('[Competition] test DB index setup failed:',error.message))}
  const resetSource=s=>{s.list=null;s.listAt=0;s.missAt=0;s.giftCache.clear();s.windowCache.clear();s.eliminatedCache.clear()};
  return{router,ensureIndexes,competitions,bySlug,loadGifts,loadEliminated,reset(){resetSource(real);if(testSource)resetSource(testSource)}};
}
module.exports={createCompetitionPages,slugify,assignSlugs,scoreGifts,scoreOverall,overallScores,buildBoard,eliminatedMap,withLogRanks,fallbackRanks,reviveCounts,snapshotEntry,cleanPkStage,cleanStanding,eliminationRounds,giftTalents,giftReceivers,validName,RESERVED,TEST_PREFIX};
