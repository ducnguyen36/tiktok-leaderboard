const express=require('express'),path=require('node:path');
function createNextFixture(){
 const app=express(),streams=new Set(),state={fail:false,live:true,offset:0,historyRequests:0,nextRequests:0};
 state.invalidate=()=>streams.forEach(r=>r.write('data: {"status":"invalidate"}\n\n'));
 function row(name,value,kind){return{name,value:value+state.offset,groupId:'g',locationId:'loc_hcm',avatar:'/helios-asset-23.png',live:state.live,liveExpiresAt:new Date(Date.now()+90000).toISOString()}}
 function data(){return{individual:{monthly:Array.from({length:23},(_,i)=>row(i===0?'TEST ALICE':'TEST TALENT '+i,9000-i*100)),daily:[row('TEST TODAY',400)],yesterday:[row('TEST YESTERDAY',300)]},group:{monthly:[row('TEST GROUP',13000)],daily:[row('TEST GROUP',400)],yesterday:[row('TEST GROUP',300)]},groups:[{id:'g',name:'TEST GROUP',locationId:'loc_hcm'}],locations:[{id:'loc_hcm',name:'TEST HCM'}],dailyPeriod:{today:'2026-10-07',yesterday:'2026-10-06'},reconciliation:{state:'checked',warnings:[{kind:'individual',period:'monthly',groupId:'g',name:'TEST ALICE',backend:9000,sheet:7000,delta:2000,dates:['2026-10-01'],checkedAt:new Date().toISOString(),sheetUrl:'https://docs.google.com/spreadsheets/d/test/edit'}],sources:[]}}}
 app.get('/api/leaderboard/next',(req,res)=>{state.nextRequests++;if(state.fail)return res.status(503).json({status:'error'});res.json({status:'ok',data:data(),meta:{computedAt:new Date().toISOString(),stale:false}})});
 app.get('/api/leaderboard/history',(req,res)=>{state.historyRequests++;res.json({status:'ok',period:{month:req.query.month,complete:true},data:{individual:[row('TEST PRIOR TALENT',100)],group:[row('TEST PRIOR GROUP',100)]}})});
 app.get('/api/leaderboard/stream',(req,res)=>{res.set('Content-Type','text/event-stream');res.flushHeaders();streams.add(res);req.on('close',()=>streams.delete(res))});
 app.get('/new',(req,res)=>res.sendFile('new.html',{root:path.join(__dirname,'../../public')}));
 app.use(express.static(path.join(__dirname,'../../public')));return{app,state};
}
module.exports={createNextFixture};
if(require.main===module){const{app}=createNextFixture();app.listen(57022,'127.0.0.1',()=>console.log('LOCAL TEST fixture · http://127.0.0.1:57022/new'))}
