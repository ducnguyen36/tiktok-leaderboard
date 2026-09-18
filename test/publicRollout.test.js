const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),net=require('node:net'),path=require('node:path');
test('temporary rollout keeps both frontends available without OAuth and omits access-loss guard',async t=>{
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,LEADERBOARD_ACCESS_CONTROL:'false',PORT:String(port),MONGODB_URI:'mongodb://127.0.0.1:1',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',PUBLIC_ORIGIN:'',NODE_TLS_REJECT_UNAUTHORIZED:'1'},stdio:'ignore'});t.after(()=>child.kill());
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<100;i++){try{await fetch(base+'/api/health');break}catch{await new Promise(r=>setTimeout(r,50))}}
 for(const route of ['/','/v1.html','/overlay.html']){const r=await fetch(base+route);assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/src="\/access-guard/);}
 const status=await(await fetch(base+'/auth/status')).json();assert.equal(status.accessControlEnabled,false);assert.equal(status.admin,false);
 const stream=await fetch(base+'/api/leaderboard/stream');const reader=stream.body.getReader();assert.ok((await reader.read()).value.length);await reader.cancel();
});
