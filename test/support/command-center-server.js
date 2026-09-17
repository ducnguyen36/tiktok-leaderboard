// Local-only verification server. Never imported by the production server.
const express=require('express');
const path=require('node:path');
const fs=require('node:fs');
function createFixtureServer(){
 const app=express(),state={fail:false,offset:0,delay:0,currentDelay:null,freshDelay:null,source:null,stale:false,freshStale:false,computedAt:Date.now(),empty:false,requests:[],historyRequests:0,historyComplete:true,frozen:false,streamConnections:0};
 const streams=new Set();state.invalidate=()=>streams.forEach(res=>res.write('data: {"status":"invalidate"}\n\n'));state.closeStreams=()=>streams.forEach(res=>res.end());
 const groups=Array.from({length:17},(_,i)=>({id:'g'+i,name:'TEST GROUP '+(i+1),locationId:'loc_hcm'}));
 function data(reset){
  const rows=Array.from({length:32},(_,i)=>({name:i===0?'TEST ALPHA':'TEST IDOL '+(i+1),value:5270072-i*12000+state.offset+reset,avatar:'/userdata/avatars/test.png',groupId:'g'+i%17,locationId:'loc_hcm',yesterday:{value:1000000-i}}));
  const gr=groups.map((g,i)=>({...g,name:g.name,groupId:g.id,value:1000000-i*1000+state.offset,avatar:'userdata/avatars/test.png',yesterday:{value:9999}}));
  const yesterdayGroups=gr.map(({yesterday,...e})=>({...e,value:100}));
  const yesterdayIdols=rows.map(({yesterday,...e})=>({...e,value:200}));
  return {
   group:{daily:state.empty?[]:state.frozen?yesterdayGroups:gr,monthly:state.empty?[]:gr,yesterday:yesterdayGroups},
   individual:{daily:state.empty?[]:state.frozen?yesterdayIdols:rows,monthly:state.empty?[]:rows,yesterday:yesterdayIdols},
   locations:[{id:'loc_hcm',name:'TEST HCM'},{id:'loc_hn',name:'TEST HANOI'}],groups,frozen:state.frozen,monthlyGrace:false
  };
 }
 app.get(['/api/leaderboard/fresh','/api/leaderboard/current'],(req,res)=>{const forced=req.path.endsWith('/fresh');state.requests.push({...req.query,forced});const fail=state.fail,payload=data(Number(req.query.resetHour)||0),meta={source:state.source||(forced?'computed':'cache'),stale:forced?state.freshStale:state.stale,computedAt:state.computedAt,contextKey:'fixture|'+req.query.resetHour+'|'+req.query.freezeUntil};setTimeout(()=>fail?res.status(503).json({status:'error',message:'Fixture unavailable'}):res.json({status:'ok',data:payload,meta}),((forced?state.freshDelay:state.currentDelay)??state.delay))});
 app.get('/api/leaderboard/history',(req,res)=>{state.historyRequests++;const month=req.query.month,[y,m]=month.split('-').map(Number);res.json({status:'ok',aggregationVersion:2,source:'snapshot',generatedAt:new Date().toISOString(),period:{month,start:new Date(Date.UTC(y,m-1,1)).toISOString(),end:new Date(Date.UTC(y,m,1)).toISOString(),complete:state.historyComplete},data:{individual:data(0).individual.monthly.map(e=>({...e,name:'PRIOR '+e.name,value:1234567})),group:[]}})});
 app.get('/api/leaderboard/stream',(req,res)=>{state.streamConnections++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': connected\n\n');streams.add(res);req.on('close',()=>{streams.delete(res);res.end()})});
 app.get('/userdata/avatars/test.png',(req,res)=>res.sendFile(path.join(__dirname,'../../public/helios-asset-23.png')));
 app.get('/',(req,res)=>res.type('html').send(fs.readFileSync(path.join(__dirname,'../../public/index.html'),'utf8').replace('<title>Helios Talent · Leaderboard</title>','<title>LOCAL TEST · Helios Leaderboard · Fixture data</title>').replace('<b id="connection">','<span>TEST DATA · </span><b id="connection">')));
 app.use(express.static(path.join(__dirname,'../../public')));
 return{app,state};
}
module.exports={createFixtureServer};
if(require.main===module){const {app}=createFixtureServer();app.listen(57021,'127.0.0.1',()=>console.log('Local verification only (TEST fixture data): http://localhost:57021'));}
