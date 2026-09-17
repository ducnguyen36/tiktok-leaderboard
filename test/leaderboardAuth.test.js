const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { createLeaderboardAuth } = require('../leaderboardAuth');

class MemoryStore {
  records = new Map();
  broken = false;
  check() { if (this.broken) throw Error('offline'); }
  async get(id) { this.check(); return structuredClone(this.records.get(id) || null); }
  async put(record) { this.check(); this.records.set(record._id, structuredClone(record)); }
  async consume(id, now) { this.check(); const value = this.records.get(id); this.records.delete(id); return value && value.expiresAt > now ? structuredClone(value) : null; }
  async approve(id, now, values) { this.check(); const record = this.records.get(id); if (!record || record.kind !== 'pending' || record.expiresAt <= now) return false; Object.assign(record, values); return true; }
  async setPair(id, pairId, now) { return this.approve(id, now, {pairId}); }
  async remove(id) { this.check(); this.records.delete(id); }
  async devices(now) { this.check(); return [...this.records.values()].filter(r => r.kind === 'device' && r.expiresAt > now).map(r => structuredClone(r)); }
  async touch(id, now) { this.check(); const r = this.records.get(id); if (r) r.lastSeen = now; }
  async limit(id, max, now) { this.check(); const old = this.records.get(id); const value = old && old.expiresAt > now ? old : {_id:id, count:0, expiresAt:new Date(+now+60000)}; value.count++; this.records.set(id,value); return value.count <= max; }
}

async function harness(t, options = {}) {
  const store = new MemoryStore();
  let now = Date.now(); let authParams; let claims = {};
  const provider = {
    generateAuthUrl(params) { authParams = params; return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(params); },
    async getToken({code, codeVerifier}) { assert.equal(code, 'good'); assert.equal(crypto.createHash('sha256').update(codeVerifier).digest('base64url'), authParams.code_challenge); return {tokens:{id_token:'verified-by-injected-provider'}}; },
    async verifyIdToken({audience}) { assert.equal(audience, 'test-client'); return {getPayload:()=>({email:'ducnguyen36@gmail.com',email_verified:true,nonce:authParams.nonce,sub:'google-user',...claims})}; }
  };
  const config = {publicOrigin:'http://localhost', googleClientId:'test-client', googleClientSecret:'test-secret', adminEmails:['ducnguyen36@gmail.com'], ...options};
  const auth = createLeaderboardAuth({getDb:()=>null, config:options.fromEnvironment?undefined:config, googleClient:provider, store, now:()=>new Date(now), streamCheckMs:20});
  const app = express(); app.use(auth.middleware);
  app.get('/api/leaderboard/stream', (req,res) => { res.set('Content-Type','text/event-stream'); res.flushHeaders(); const stream=auth.guardStream(req,res); stream.send('data: private\n\n'); });
  app.get('/index.html', (req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
  app.use((req,res)=>res.json({private:true}));
  const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base = `http://127.0.0.1:${server.address().port}`;
  function browser() {
    const jar = new Map(); let csrf;
    return {jar, async request(url, {method='GET',body,headers={}}={}) {
      const response=await fetch(base+url,{method,redirect:'manual',headers:{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(method==='POST'?{'Content-Type':'application/json',Origin:config.publicOrigin,'X-CSRF-Token':csrf||''}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
      for(const line of response.headers.getSetCookie()){const [pair]=line.split(';');const [key,value]=pair.split('=');jar.set(key,value);}
      return response;
    }, async status(){const r=await this.request('/auth/status');const data=await r.json();csrf=data.csrf;return data;}, async login(overrides={}) {claims=overrides;await this.status();const start=await this.request('/auth/google');assert.equal(start.status,302);const callback='/auth/google/callback?code=good&state='+authParams.state;return {response:await this.request(callback),callback};}};
  }
  return {store,browser,advance:ms=>now+=ms,params:()=>authParams};
}

test('unknown browsers cannot obtain any private route, including static assets and SSE', async t=>{
  const h=await harness(t);const b=h.browser();
  for(const route of ['/', '/index.html','/overlay.html','/userdata/avatars/x.jpg','/api/debug','/api/leaderboard/current','/api/leaderboard/history','/api/leaderboard/stream','/app.js','/auth/../api/debug','/auth/not-public']){
    const r=await b.request(route);assert.equal(r.status,401,route);assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.equal(r.headers.get('access-control-allow-origin'),null);
  }
  assert.equal((await b.request('/auth')).status,200);
});
test('missing OAuth configuration serves setup shell but cannot unlock data',async t=>{
 const h=await harness(t,{googleClientSecret:''});const b=h.browser();assert.equal((await b.status()).setupRequired,true);assert.equal((await b.request('/api/debug')).status,401);assert.equal((await b.request('/auth/google')).status,503);
});
test('verified allowlisted Google account receives expiring administrator session; callback cannot replay',async t=>{
 const h=await harness(t);const b=h.browser();const {response,callback}=await b.login();assert.equal(response.status,302);assert.equal((await b.status()).admin,true);assert.equal((await b.request('/index.html')).status,200);assert.match((await b.request('/index.html')).headers.get('cache-control'),/private.*no-store/);assert.equal((await b.request(callback)).status,400);
 h.advance(12*60*60*1000+1);assert.equal((await b.request('/api/debug')).status,401);
});
test('wrong identity, verification, nonce or callback state is rejected',async t=>{
 const h=await harness(t);
 for(const claims of [{email:'intruder@example.com'},{email_verified:false},{email_verified:'true'},{nonce:'wrong'}]){const b=h.browser();assert.equal((await b.login(claims)).response.status,403);assert.equal((await b.status()).authorized,false);}
 const b=h.browser();await b.status();await b.request('/auth/google');assert.equal((await b.request('/auth/google/callback?code=good&state=wrong')).status,400);
 const stolen=h.browser();assert.equal((await stolen.request('/auth/google/callback?code=good&state='+h.params().state)).status,400);
});
test('pairing approval is one-time and bound to requesting browser; admin can revoke',async t=>{
 const h=await harness(t);const admin=h.browser();await admin.login();await admin.status();const tv=h.browser();await tv.status();const pair=await (await tv.request('/auth/pair',{method:'POST',body:{}})).json();assert.match(pair.code,/^[A-Z0-9-]{8,12}$/);
 const outsider=h.browser();await outsider.status();assert.equal((await outsider.request('/auth/approve',{method:'POST',body:{code:pair.code,name:'Stolen'}})).status,403);
 assert.equal((await admin.request('/auth/approve',{method:'POST',body:{code:pair.code,name:'TV <script>'}})).status,200);
 assert.equal((await admin.request('/auth/approve',{method:'POST',body:{code:pair.code,name:'Again'}})).status,400);
 assert.equal((await tv.status()).authorized,true);assert.equal((await outsider.status()).authorized,false);
 const devices=await (await admin.request('/auth/devices')).json();assert.equal(devices.devices.length,1);assert.equal(devices.devices[0].name,'TV <script>');
 const rawSecrets=[...tv.jar.values()];assert.ok(!JSON.stringify([...h.store.records.values()]).includes(rawSecrets[0]));
 assert.equal((await admin.request('/auth/revoke',{method:'POST',body:{id:devices.devices[0].id}})).status,200);assert.equal((await tv.request('/api/debug')).status,401);
});
test('expired pairing codes and device credentials fail even before TTL cleanup',async t=>{
 const h=await harness(t);const admin=h.browser();await admin.login();await admin.status();const tv=h.browser();await tv.status();const pair=await (await tv.request('/auth/pair',{method:'POST',body:{}})).json();h.advance(600001);assert.equal((await admin.request('/auth/approve',{method:'POST',body:{code:pair.code,name:'Expired'}})).status,400);
 await tv.status();const next=await (await tv.request('/auth/pair',{method:'POST',body:{}})).json();assert.equal((await admin.request('/auth/approve',{method:'POST',body:{code:next.code,name:'TV'}})).status,200);h.advance(180*86400000+1);assert.equal((await tv.request('/api/debug')).status,401);
});
test('mutations reject cross-origin and missing CSRF; requests are bounded',async t=>{
 const h=await harness(t);const b=h.browser();await b.login();await b.status();
 assert.equal((await b.request('/auth/logout',{method:'POST',body:{},headers:{Origin:'https://evil.test'}})).status,403);
 assert.equal((await b.request('/auth/logout',{method:'POST',body:{},headers:{'X-CSRF-Token':''}})).status,403);
 let limited=false;for(let i=0;i<35;i++){if((await b.request('/auth/approve',{method:'POST',body:{code:'WRONGCODE',name:'TV'}})).status===429)limited=true;}assert.equal(limited,true);
});
test('store outages deny status/data and independently terminate existing SSE',async t=>{
 const h=await harness(t);const b=h.browser();await b.login();await b.status();const response=await b.request('/api/leaderboard/stream');const reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/private/);
 h.store.broken=true;assert.equal((await b.request('/api/debug')).status,503);assert.equal((await b.request('/auth/status')).status,503);const done=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('stream remained open')),1000))]);assert.equal(done.done,true);
});
test('logout removes authorization and independent SSE lifetime expires without broadcasts',async t=>{
 const h=await harness(t);const b=h.browser();await b.login();await b.status();const response=await b.request('/api/leaderboard/stream');const reader=response.body.getReader();await reader.read();h.advance(12*3600000+1);assert.equal((await reader.read()).done,true);
 const other=h.browser();await other.login();await other.status();assert.equal((await other.request('/auth/logout',{method:'POST',body:{}})).status,200);assert.equal((await other.request('/api/debug')).status,401);
});
test('revocation closes approved browser SSE independently, and regenerating a pair code invalidates the old one',async t=>{
 const h=await harness(t);const admin=h.browser();await admin.login();await admin.status();const tv=h.browser();await tv.status();
 const first=await (await tv.request('/auth/pair',{method:'POST',body:{}})).json();const second=await (await tv.request('/auth/pair',{method:'POST',body:{}})).json();
 assert.equal((await admin.request('/auth/approve',{method:'POST',body:{code:first.code,name:'Old'}})).status,400);
 assert.equal((await admin.request('/auth/approve',{method:'POST',body:{code:second.code,name:'TV'}})).status,200);
 const stream=await tv.request('/api/leaderboard/stream');const reader=stream.body.getReader();await reader.read();
 const list=await (await admin.request('/auth/devices')).json();await admin.request('/auth/revoke',{method:'POST',body:{id:list.devices[0].id}});assert.equal((await reader.read()).done,true);
});
test('a concurrent approval is never overwritten by a stale pairing request',async t=>{
 const h=await harness(t);const tv=h.browser();await tv.status();const oldPut=h.store.put.bind(h.store);
 h.store.put=async record=>{await oldPut(record);if(record._id.startsWith('pair:')){const browser=h.store.records.get(record.browserId);browser.kind='device';browser.name='Concurrent approval';browser.expiresAt=new Date(Date.now()+86400000);}};
 const response=await tv.request('/auth/pair',{method:'POST',body:{}});assert.equal(response.status,409);
 assert.equal((await tv.status()).authorized,true);
});
test('OAuth transaction expires, wrong browser cannot use callback, and HTTPS cookies are hardened',async t=>{
 const h=await harness(t,{publicOrigin:'https://ranking.example.test'});const b=h.browser();await b.status();const start=await b.request('/auth/google');
 const cookie=start.headers.getSetCookie().join(';');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
 h.advance(600001);assert.equal((await b.request('/auth/google/callback?code=good&state='+h.params().state)).status,400);
 await b.request('/auth/google');const stranger=h.browser();await stranger.request('/auth/google');assert.equal((await b.request('/auth/google/callback?code=good&state='+h.params().state)).status,400);
});
test('configured OAuth defaults to the three confirmed administrators only',async t=>{
 const keys=['PUBLIC_ORIGIN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','ADMIN_EMAILS'], previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 t.after(()=>{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
 Object.assign(process.env,{PUBLIC_ORIGIN:'http://localhost',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret'});delete process.env.ADMIN_EMAILS;
 const h=await harness(t,{fromEnvironment:true});
 for(const email of ['ducnguyen36@gmail.com','heliostalentofficial@gmail.com','kimlinh727@gmail.com']){const b=h.browser();assert.equal((await b.login({email})).response.status,302);assert.equal((await b.status()).admin,true);}
 assert.equal((await h.browser().login({email:'other@gmail.com'})).response.status,403);
});
test('actual server locks every private route and serves only a setup shell without credentials',async t=>{
 const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),MONGODB_URI:'mongodb://127.0.0.1:1',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',PUBLIC_ORIGIN:'',ADMIN_EMAILS:'',NODE_TLS_REJECT_UNAUTHORIZED:'1'},stdio:'ignore'});t.after(()=>child.kill());
 const base=`http://127.0.0.1:${port}`;let started=false;
 for(let i=0;i<100;i++){try { await fetch(base+'/api/health');started=true;break; }catch {await new Promise(resolve=>setTimeout(resolve,50));}}
 assert.equal(started,true);
 for(const route of ['/','/?overlay=true','/index.html','/overlay.html','/api/debug','/api/leaderboard/current','/api/leaderboard/history','/api/leaderboard/stream','/userdata/avatars/x.jpg','/app.js']) {
   const response=await fetch(base+route);assert.equal(response.status,401,route);assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('access-control-allow-origin'),null);
 }
 assert.equal((await fetch(base+'/auth')).status,200);assert.equal((await (await fetch(base+'/auth/status')).json()).setupRequired,true);
 assert.deepEqual(await (await fetch(base+'/api/health')).json(),{status:'ok'});
});
