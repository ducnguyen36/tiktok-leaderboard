'use strict';
// Public competition score pages at /<slug> for people outside the company (accounting).
// They are mounted BEFORE the TV access middleware, so every route here does its own
// access control: admins (leaderboardAuth.isAdmin) see everything, anyone else needs a
// per-competition grant approved by an admin and tied to a random httpOnly browser cookie.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),express=require('express');
const {ObjectId}=require('mongodb');
const ACCESS='competition_access',SNAPSHOTS='competition_snapshots',COOKIE='helios_comp',COOKIE_AGE=180*86400000;
const ROLES=['viewer','snapshot'],MAX_PENDING_PER_BROWSER=3,MAX_REQUESTS_PER_COMPETITION=200,MAX_SNAPSHOTS=100,NAME_MAX=60;
const LIST_TTL=30000,MISS_REFRESH=10000,LIVE_TTL=8000,ENDED_TTL=60000;
// Single-segment paths that belong to the board itself; a competition never takes them.
const RESERVED=new Set(['old','new','auth','api','privacy','userdata','avatars','overlay','v1','index','competition','public','static','health','admin']);
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
// HeliosControl scoring, replicated from its control panel (public/newcontrol.js competition mode ->
// modules/giftProcessor.js processGiftsAndTalents):
//  * only gifts recorded in the competition's own sessions (sessions.profileId "competition_<id>"
//    from the server or "comp_<id>" from the panel) count. HeliosControl also stamps competitionId
//    on gifts of OTHER groups' sessions while its in-memory active competition lingers; the panel never shows those.
//  * a gift's talents are receivedTalents[].name (old string[] too), else receivedTalent, else "Unassigned";
//    each talent gets Math.floor(cost / talentCount). Manual corrections (negative cost) count the same way.
//  * a participant scores the sum for its exact talentName (HeliosControl keys scores by name, not uid);
//    group gifts addressed to the competition/group name count for nobody (auto-split is off in competition mode).
function giftTalents(gift){
  if(Array.isArray(gift.receivedTalents)&&gift.receivedTalents.length)return gift.receivedTalents.map(t=>t&&typeof t==='object'&&t.name?t.name:String(t));
  return gift.receivedTalent?[gift.receivedTalent]:['Unassigned'];
}
function scoreGifts(gifts,from=-Infinity,to=Infinity){
  const scores=new Map();
  for(const gift of gifts){const at=Number(gift.timeStamp)||0;if(!(at>from&&at<=to))continue;const names=giftTalents(gift),share=Math.floor((Number(gift.cost)||0)/names.length);for(const name of names)scores.set(name,(scores.get(name)||0)+share)}
  return scores;
}
// round = gifts in (roundFrom, at]; total = everything up to at.
function buildBoard(participants,gifts,{roundFrom=-Infinity,at=Infinity}={}){
  const total=scoreGifts(gifts,-Infinity,at),round=scoreGifts(gifts,roundFrom,at);
  const rows=(participants||[]).map(p=>({talentName:p.talentName||'',talentUid:String(p.talentUid||''),profileId:String(p.profileId||''),profileName:p.profileName||'',round:round.get(p.talentName)||0,total:total.get(p.talentName)||0}));
  rows.sort((a,b)=>b.total-a.total||b.round-a.round||a.talentName.localeCompare(b.talentName));
  const groups=new Map();
  for(const row of rows){const key=row.profileId||row.profileName,group=groups.get(key)||{profileId:row.profileId,profileName:row.profileName,round:0,total:0};group.round+=row.round;group.total+=row.total;groups.set(key,group)}
  return{rows,groups:[...groups.values()].sort((a,b)=>b.total-a.total||b.round-a.round)};
}
function cookieSecret(req){for(const part of (req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===COOKIE)return part.slice(i+1).trim()}return ''}
// Small in-memory budget; behind the Cloudflare tunnel every visitor shares one IP, so it is global.
function createBudget(max,windowMs,clock){let hits=[];return()=>{const now=clock();hits=hits.filter(t=>now-t<windowMs);if(hits.length>=max)return false;hits.push(now);return true}}
function createCompetitionPages({getDb,auth,publicDir=path.join(__dirname,'public'),assetVersion=()=>'',clock=Date.now}){
  const router=express.Router(),json=express.json({limit:'4kb'});
  const requestBudget=createBudget(40,600000,clock),snapshotBudget=createBudget(30,600000,clock);
  let list=null,listAt=0,listLoading=null,missAt=0;const giftCache=new Map();
  const db=()=>{const d=getDb();if(!d)throw Object.assign(Error('Database unavailable'),{status:503});return d};
  const noStore=res=>res.set({'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});
  const fail=(res,code,error)=>noStore(res).status(code).json({status:'error',error});
  const endpoint=handler=>async(req,res,next)=>{try{await handler(req,res,next)}catch(error){if(!res.headersSent)fail(res,error.status||503,error.status===503||!error.status?'unavailable':error.message)}};
  async function competitions(force=false){
    if(!force&&list&&clock()-listAt<LIST_TTL)return list;
    if(!listLoading)listLoading=db().collection('competitions').find({},{projection:{name:1,status:1,createdAt:1,startedAt:1,endedAt:1,participants:1,tiktokUsername:1}}).toArray().then(docs=>{const slugs=assignSlugs(docs);list=docs.map(doc=>({...doc,slug:slugs.get(String(doc._id))}));listAt=clock();return list}).finally(()=>listLoading=null);
    return listLoading;
  }
  async function bySlug(slug){
    if(typeof slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>90||RESERVED.has(slug))return null;
    let found=(await competitions()).find(c=>c.slug===slug);
    // A competition created in HeliosControl a moment ago: re-read, but at most every 10 s for unknown paths.
    if(!found&&clock()-missAt>MISS_REFRESH){missAt=clock();found=(await competitions(true)).find(c=>c.slug===slug)}
    return found||null;
  }
  async function loadGifts(comp,fresh=false){
    const key=String(comp._id),cached=giftCache.get(key),ttl=comp.status==='active'?LIVE_TTL:ENDED_TTL;
    if(!fresh&&cached&&clock()-cached.at<ttl)return cached.gifts;
    const d=db(),sessions=await d.collection('sessions').find({profileId:{$in:[`competition_${key}`,`comp_${key}`]}},{projection:{_id:1}}).toArray();
    const query={competitionId:comp._id};
    // Competitions recorded before session tagging fall back to every gift stamped with the competition.
    if(sessions.length){const ids=sessions.map(s=>s._id);query.sessionId={$in:[...ids,...ids.map(String)]}}
    const gifts=await d.collection('gifts').find(query,{projection:{_id:0,cost:1,timeStamp:1,receivedTalent:1,receivedTalents:1}}).toArray();
    giftCache.delete(key);giftCache.set(key,{at:clock(),gifts});if(giftCache.size>6)giftCache.delete(giftCache.keys().next().value);
    return gifts;
  }
  async function snapshotsOf(comp){return db().collection(SNAPSHOTS).find({competitionId:String(comp._id)}).sort({at:-1}).limit(MAX_SNAPSHOTS).toArray()}
  async function access(req,comp){
    if(await auth.isAdmin(req))return{admin:true,role:'admin',request:null};
    const secret=cookieSecret(req);if(!validSecret(secret))return{admin:false,role:null,request:null};
    const request=await db().collection(ACCESS).findOne({competitionId:String(comp._id),secretHash:hash(secret)});
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
  const publicCompetition=comp=>({id:String(comp._id),name:comp.name||'',slug:comp.slug,status:comp.status||'created',createdAt:comp.createdAt||null,startedAt:comp.startedAt||null,endedAt:comp.endedAt||null});
  const publicSnapshot=(snap,admin)=>({id:String(snap._id),name:snap.name,at:snap.at,createdAt:snap.createdAt,createdBy:admin?snap.createdBy:undefined,rows:snap.rows,groups:snap.groups});
  const competitionFor=handler=>endpoint(async(req,res)=>{const comp=await bySlug(req.params.slug);if(!comp)return fail(res,404,'not_found');return handler(req,res,comp)});
  async function liveBoard(comp,snaps,fresh=false){const gifts=await loadGifts(comp,fresh),at=clock(),roundFrom=snaps[0]?.at??-Infinity;return{at,roundFrom:Number.isFinite(roundFrom)?roundFrom:null,...buildBoard(comp.participants,gifts,{roundFrom,at})}}

  for(const file of STATIC_FILES)router.get(`/${file}`,(req,res)=>{res.set({'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.sendFile(file,{root:publicDir})});
  router.get('/api/competitions',endpoint(async(req,res)=>{
    if(!await auth.isAdmin(req))return fail(res,403,'admin_required');
    const [comps,pending]=await Promise.all([competitions(true),db().collection(ACCESS).find({status:'pending'},{projection:{competitionId:1}}).toArray()]);
    const counts={};for(const p of pending)counts[p.competitionId]=(counts[p.competitionId]||0)+1;
    noStore(res).json({status:'ok',competitions:[...comps].sort((a,b)=>+new Date(b.createdAt||0)-+new Date(a.createdAt||0)).map(c=>({...publicCompetition(c),url:`/${c.slug}`,participants:(c.participants||[]).length,pending:counts[String(c._id)]||0}))});
  }));
  router.get('/api/competitions/:slug/state',competitionFor(async(req,res,comp)=>{
    const grant=await access(req,comp);
    noStore(res).json({status:'ok',competition:publicCompetition(comp),admin:grant.admin,role:grant.role,request:grant.request?{name:grant.request.name,status:grant.request.status}:null});
  }));
  router.post('/api/competitions/:slug/request',json,competitionFor(async(req,res,comp)=>{
    if(!sameOrigin(req))return fail(res,403,'same_origin_required');
    const name=validName(req.body?.name);if(!name)return fail(res,400,'invalid_name');
    const col=db().collection(ACCESS);let secret=cookieSecret(req);
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
    const snaps=await snapshotsOf(comp),live=await liveBoard(comp,snaps);
    noStore(res).json({status:'ok',competition:publicCompetition(comp),admin:grant.admin,role:grant.role,canSnapshot:grant.admin||grant.role==='snapshot',live,snapshots:snaps.map(s=>publicSnapshot(s,grant.admin))});
  }));
  router.post('/api/competitions/:slug/snapshots',json,competitionFor(async(req,res,comp)=>{
    const who=await writer(req,res,comp,['snapshot']);if(!who)return;
    const name=validName(req.body?.name);if(!name)return fail(res,400,'invalid_name');
    if(!snapshotBudget())return fail(res,429,'rate_limited');
    const col=db().collection(SNAPSHOTS),competitionId=String(comp._id);
    if(await col.countDocuments({competitionId})>=MAX_SNAPSHOTS)return fail(res,409,'too_many_snapshots');
    const snaps=await snapshotsOf(comp),board=await liveBoard(comp,snaps,true);
    const doc={_id:new ObjectId(),competitionId,name,at:board.at,createdAt:new Date(board.at),createdBy:who.by,rows:board.rows,groups:board.groups};
    await col.insertOne(doc);noStore(res).json({status:'ok',snapshot:publicSnapshot(doc,who.admin)});
  }));
  router.post('/api/competitions/:slug/snapshots/:id/rename',json,competitionFor(async(req,res,comp)=>{
    if(!/^[a-f0-9]{24}$/.test(req.params.id))return fail(res,400,'invalid_snapshot');
    const who=await writer(req,res,comp,['snapshot']);if(!who)return;
    const name=validName(req.body?.name);if(!name)return fail(res,400,'invalid_name');
    const result=await db().collection(SNAPSHOTS).updateOne({_id:new ObjectId(req.params.id),competitionId:String(comp._id)},{$set:{name,renamedAt:new Date(clock()),renamedBy:who.by}});
    if(!result.matchedCount)return fail(res,404,'not_found');noStore(res).json({status:'ok'});
  }));
  router.post('/api/competitions/:slug/snapshots/:id/delete',json,competitionFor(async(req,res,comp)=>{
    if(!/^[a-f0-9]{24}$/.test(req.params.id))return fail(res,400,'invalid_snapshot');
    if(!await auth.isAdmin(req))return fail(res,403,'admin_required');if(!await auth.adminMutation(req,res))return;
    const result=await db().collection(SNAPSHOTS).deleteOne({_id:new ObjectId(req.params.id),competitionId:String(comp._id)});
    if(!result.deletedCount)return fail(res,404,'not_found');noStore(res).json({status:'ok'});
  }));
  router.get('/api/competitions/:slug/requests',competitionFor(async(req,res,comp)=>{
    if(!await auth.isAdmin(req))return fail(res,403,'admin_required');
    const docs=await db().collection(ACCESS).find({competitionId:String(comp._id),status:{$in:['pending','approved']}},{projection:{secretHash:0}}).sort({createdAt:-1}).toArray();
    noStore(res).json({status:'ok',requests:docs.map(d=>({id:d._id,name:d.name,status:d.status,role:d.role||null,createdAt:d.createdAt,updatedAt:d.updatedAt,decidedBy:d.decidedBy||null}))});
  }));
  router.post('/api/competitions/:slug/requests/:id',json,competitionFor(async(req,res,comp)=>{
    if(!/^[a-f0-9]{24}$/.test(req.params.id))return fail(res,400,'invalid_request');
    const admin=await auth.adminMutation(req,res);if(!admin)return;
    const action=req.body?.action;if(![...ROLES,'revoke'].includes(action))return fail(res,400,'invalid_action');
    const set=action==='revoke'?{status:'revoked',role:null}:{status:'approved',role:action};
    const result=await db().collection(ACCESS).updateOne({_id:req.params.id,competitionId:String(comp._id)},{$set:{...set,updatedAt:new Date(clock()),decidedBy:admin.email||'admin'}});
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
  async function ensureIndexes(){const d=db();await Promise.all([d.collection(ACCESS).createIndex({competitionId:1,secretHash:1}),d.collection(ACCESS).createIndex({secretHash:1,status:1}),d.collection(SNAPSHOTS).createIndex({competitionId:1,at:-1})])}
  return{router,ensureIndexes,competitions,bySlug,loadGifts,reset(){list=null;listAt=0;missAt=0;giftCache.clear()}};
}
module.exports={createCompetitionPages,slugify,assignSlugs,scoreGifts,buildBoard,giftTalents,validName,RESERVED};
