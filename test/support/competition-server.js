const express=require('express'),{ObjectId}=require('mongodb');
const {createCompetitionPages}=require('../../competitionPages');
// Minimal in-memory Mongo: equality, $in, $ne, $gte/$lte, $exists, $or/$and on (dotted) fields, sort/limit, $set updates.
const same=(a,b)=>a===b||(a!=null&&b!=null&&typeof a==='object'&&typeof b==='object'&&String(a)===String(b));
const clone=v=>Array.isArray(v)?v.map(clone):v&&typeof v==='object'&&v.constructor===Object?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
const field=(doc,key)=>key.split('.').reduce((v,k)=>v==null?v:v[k],doc);
const OPS=['$in','$ne','$gte','$lte','$exists'];
function matches(doc,query){return Object.entries(query||{}).every(([key,want])=>{
 if(key==='$or')return want.some(q=>matches(doc,q));if(key==='$and')return want.every(q=>matches(doc,q));
 const have=field(doc,key);
 if(want&&typeof want==='object'&&!(want instanceof ObjectId)&&!(want instanceof Date)&&Object.keys(want).some(k=>OPS.includes(k)))return Object.entries(want).every(([op,v])=>
  op==='$in'?v.some(x=>same(x,have)):op==='$ne'?!same(v,have):op==='$exists'?(have!==undefined)===Boolean(v):have!=null&&(op==='$gte'?+have>=+v:+have<=+v));
 return same(want,have)})}
function memoryDb(){
 const data=new Map(),rows=name=>{if(!data.has(name))data.set(name,[]);return data.get(name)};
 return{data,rows,collection(name){const list=rows(name);return{
  find(query){let out=list.filter(d=>matches(d,query)).map(d=>clone(d)),n=Infinity;const cursor={sort(spec){const [[k,dir]]=Object.entries(spec);out.sort((a,b)=>(+field(a,k)>+field(b,k)?1:+field(a,k)<+field(b,k)?-1:0)*dir);return cursor},limit(v){n=v;return cursor},async toArray(){return out.slice(0,n)}};return cursor},
  async findOne(query){const d=list.find(x=>matches(x,query));return d?clone(d):null},
  async insertOne(doc){list.push(clone(doc));return{insertedId:doc._id}},
  async updateOne(query,update){const d=list.find(x=>matches(x,query));if(d)Object.assign(d,clone(update.$set||{}));return{matchedCount:d?1:0}},
  async deleteOne(query){const i=list.findIndex(x=>matches(x,query));if(i>=0)list.splice(i,1);return{deletedCount:i>=0?1:0}},
  async countDocuments(query){return list.filter(d=>matches(d,query)).length},
  async createIndex(){return 'ok'}}}};
}
// One competition "PK BATTLE 16/10" with three participants in two groups, its own session and a
// foreign group session whose gifts also carry the competitionId (HeliosControl leak) and must not count
// for "Cuộc thi" but do count for "Tổng cộng" (revenue in the competition window), plus gifts outside the window.
// Cuộc thi: LILY 104, RYAN 40, Chanee 4. Tổng cộng: RYAN 1039, LILY 154 (50 matched by uid), Chanee 4.
function seed(db,now){
 const id=new ObjectId(),session=new ObjectId(),foreign=new ObjectId(),old=new ObjectId(),start=now-3600000;
 db.rows('competitions').push({_id:id,name:'PK BATTLE 16/10',status:'active',createdAt:new Date(start),startedAt:new Date(start),endedAt:null,participants:[
  {talentName:'LILY 🍉',talentUid:'1',profileId:'g1',profileName:'HT - DPM'},{talentName:'Chanee🌸',talentUid:'2',profileId:'g1',profileName:'HT - DPM'},{talentName:'RYAN',talentUid:'3',profileId:'g2',profileName:'HT - ICONZ'}]});
 db.rows('sessions').push({_id:session,profileId:`competition_${id}`,createdAt:new Date(start),updatedAt:new Date(now)},{_id:foreign,profileId:'g9',createdAt:new Date(now-7200000),updatedAt:new Date(now)},
  {_id:old,profileId:'g1',createdAt:new Date(now-90000000),updatedAt:new Date(now-80000000)});
 const gift=(talents,cost,at,sessionId=session,competitionId=id)=>({_id:new ObjectId(),...(competitionId?{competitionId}:{}),sessionId,cost,timeStamp:at,receivedTalent:typeof talents[0]==='object'?talents[0].name:talents[0],receivedTalents:talents.map(t=>typeof t==='object'?t:{name:t,uid:''})});
 db.rows('gifts').push(gift(['LILY 🍉'],100,now-5000),gift(['RYAN'],40,now-4000),gift(['LILY 🍉','Chanee🌸'],9,now-3000),gift(['PK BATTLE 16/10'],500,now-2000),gift(['RYAN'],999,now-1000,foreign),
  gift([{name:'Lily tên cũ',uid:'1'}],50,now-2500,foreign,null),gift(['RYAN'],10,start-60000,foreign,null),gift(['LILY 🍉'],1000,now-85000000,old,null));
 return{id,session,foreign,gift};
}
function createCompetitionFixture({clock=Date.now}={}){
 const db=memoryDb(),now=clock(),seeded=seed(db,now),app=express(),state={db,...seeded};
 const cookie=req=>(req.headers.cookie||'').includes('test_admin=1');
 const auth={origin:undefined,isAdmin:async req=>cookie(req),
  adminMutation:async(req,res)=>{if(cookie(req)&&req.get('x-csrf-token')==='test-csrf')return{email:'admin@example.test'};res.status(403).json({status:'error',error:'csrf_required'});return null}};
 const pages=createCompetitionPages({getDb:()=>db,auth,assetVersion:()=>'test',clock});state.pages=pages;
 app.use(pages.router);
 app.get('/auth/status',(req,res)=>res.json({authorized:cookie(req),admin:cookie(req),csrf:cookie(req)?'test-csrf':undefined}));
 app.get('/old',(req,res)=>res.type('text').send('old board'));
 app.use((req,res)=>res.status(404).type('text').send('not found'));
 return{app,state};
}
module.exports={memoryDb,matches,createCompetitionFixture};
