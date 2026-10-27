const test=require('node:test'),assert=require('node:assert/strict');
const {slugify,assignSlugs,scoreGifts,buildBoard,validName}=require('../competitionPages');
const {createCompetitionFixture}=require('./support/competition-server');
test('slugs fold Vietnamese, styled letters and emoji; the newest namesake keeps the plain slug',()=>{
 assert.equal(slugify('PK BATTLE 16/10'),'pk-battle-16-10');assert.equal(slugify('  Cuộc thi Đại chiến 🔥 Mùa 2 '),'cuoc-thi-dai-chien-mua-2');
 assert.equal(slugify('𝓗𝓪𝓷𝓲 🐙'),'hani');assert.equal(slugify('🔥🔥'),'cuoc-thi');assert.equal(slugify('Crown__War--S8!!'),'crown-war-s8');
 const slugs=assignSlugs([{_id:'a',name:'CROWN WAR S8',createdAt:'2026-06-25'},{_id:'b',name:'CROWN WAR S8',createdAt:'2026-06-26'},{_id:'c',name:'Crown War S8',createdAt:'2026-01-01'},{_id:'d',name:'OLD',createdAt:'2026-01-02'},{_id:'e',name:'api',createdAt:'2026-01-03'}]);
 assert.equal(slugs.get('b'),'crown-war-s8');assert.equal(slugs.get('a'),'crown-war-s8-2');assert.equal(slugs.get('c'),'crown-war-s8-3');
 assert.equal(slugs.get('d'),'old-cuoc-thi','reserved paths are never shadowed');assert.equal(slugs.get('e'),'api-cuoc-thi');
 assert.equal(validName('  Kế   toán\u0000 A '),'Kế toán A');assert.equal(validName('x'.repeat(61)),'');assert.equal(validName(42),'');
});
test('scoring matches HeliosControl: name match, floor split, negative manual gifts, group gifts ignored, rounds by time',()=>{
 const participants=[{talentName:'A',profileId:'g1',profileName:'G1'},{talentName:'B',profileId:'g1',profileName:'G1'},{talentName:'C',profileId:'g2',profileName:'G2'}];
 const gifts=[{receivedTalents:[{name:'A',uid:'1'}],cost:100,timeStamp:10},{receivedTalents:['A','B'],cost:7,timeStamp:20},{receivedTalent:'C',cost:50,timeStamp:30},
  {receivedTalent:'G1',cost:900,timeStamp:31},{id:'Manual_manual_1',receivedTalents:[{name:'A'}],cost:-30,timeStamp:40},{receivedTalents:[{name:'B'},{name:'C'}],cost:-5,timeStamp:50},{cost:8,timeStamp:60}];
 const all=scoreGifts(gifts);assert.equal(all.get('A'),100+3-30);assert.equal(all.get('B'),3-3);assert.equal(all.get('C'),50-3);assert.equal(all.get('Unassigned'),8);
 const board=buildBoard(participants,gifts,{roundFrom:30,at:50});
 assert.deepEqual(board.rows.map(r=>[r.talentName,r.round,r.total]),[['A',-30,73],['C',-3,47],['B',-3,0]]);
 assert.deepEqual(board.groups.map(g=>[g.profileName,g.round,g.total]),[['G1',-33,73],['G2',-3,47]]);
 assert.deepEqual(buildBoard(participants,gifts,{at:20}).rows.map(r=>r.total),[103,3,0],'total stops at the snapshot time');
});
async function server(t){
 let now=Date.parse('2026-10-27T12:00:00Z');const {app,state}=createCompetitionFixture({clock:()=>now}),srv=app.listen(0,'127.0.0.1');await new Promise(r=>srv.once('listening',r));
 t.after(()=>{srv.closeAllConnections();srv.close()});const base=`http://127.0.0.1:${srv.address().port}`;
 const call=async(path,{method='GET',body,cookie='',origin=base,csrf,type='application/json'}={})=>{const headers={cookie};if(origin)headers.origin=origin;if(body!==undefined)headers['content-type']=type;if(csrf)headers['x-csrf-token']=csrf;
  const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await res.text();let json;try{json=JSON.parse(text)}catch{}return{status:res.status,json,text,headers:res.headers}};
 return{state,call,base,advance:ms=>{now+=ms},now:()=>now};
}
const admin={cookie:'test_admin=1',csrf:'test-csrf'};
test('access requests, roles, revocation and same-origin checks',async t=>{
 const {state,call}=await server(t),slug='/api/competitions/pk-battle-16-10';
 const page=await call('/pk-battle-16-10');assert.equal(page.status,200);assert.match(page.text,/competition\.js\?v=test/);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
 assert.equal((await call('/old')).text,'old board');assert.equal((await call('/no-such-competition')).status,404);assert.equal((await call('/api/competitions')).status,403);
 const anon=await call(slug+'/state');assert.equal(anon.json.role,null);assert.equal(anon.json.competition.name,'PK BATTLE 16/10');
 assert.equal((await call(slug+'/board')).status,401);
 assert.equal((await call(slug+'/request',{method:'POST',body:{name:'Kế toán'},origin:'https://evil.example'})).status,403);
 assert.equal((await call(slug+'/request',{method:'POST',body:{name:'Kế toán'},type:'text/plain'})).status,403);
 assert.equal((await call(slug+'/request',{method:'POST',body:{name:'x'.repeat(61)}})).status,400);
 const sent=await call(slug+'/request',{method:'POST',body:{name:'Kế toán'}}),setCookie=sent.headers.get('set-cookie');
 assert.equal(sent.status,200);assert.match(setCookie,/helios_comp=[\w-]{43};/);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Lax/);
 const visitor=setCookie.split(';')[0],stored=state.db.rows('competition_access')[0];
 assert.equal(stored.status,'pending');assert.match(stored.secretHash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(stored).includes(visitor.split('=')[1]),'only the hash is stored');
 assert.equal((await call(slug+'/state',{cookie:visitor})).json.request.status,'pending');assert.equal((await call(slug+'/board',{cookie:visitor})).status,401);
 assert.equal((await call(slug+'/requests',{cookie:visitor})).status,403);
 const list=await call(slug+'/requests',admin);assert.equal(list.json.requests.length,1);assert.equal(list.json.requests[0].secretHash,undefined);const id=list.json.requests[0].id;
 assert.equal((await call(`${slug}/requests/${id}`,{method:'POST',body:{action:'viewer'},cookie:admin.cookie})).status,403,'admin actions need CSRF');
 assert.equal((await call(`${slug}/requests/${id}`,{method:'POST',body:{action:'viewer'},...admin})).status,200);
 const board=await call(slug+'/board',{cookie:visitor});assert.equal(board.status,200);assert.equal(board.json.role,'viewer');assert.equal(board.json.canSnapshot,false);
 assert.deepEqual(board.json.live.rows.map(r=>[r.talentName,r.total]),[['LILY 🍉',104],['RYAN',40],['Chanee🌸',4]],'foreign-session gift with the same competitionId is ignored');
 assert.deepEqual(board.json.live.groups.map(g=>[g.profileName,g.total]),[['HT - DPM',108],['HT - ICONZ',40]]);
 assert.equal((await call(slug+'/snapshots',{method:'POST',body:{name:'Vòng 1'},cookie:visitor})).json.error,'role_required');
 const other=await call(slug+'/state',{cookie:'helios_comp='+'A'.repeat(43)});assert.equal(other.json.role,null,'another browser has no grant');
 assert.equal((await call(`${slug}/requests/${id}`,{method:'POST',body:{action:'revoke'},...admin})).status,200);
 assert.equal((await call(slug+'/board',{cookie:visitor})).status,401);assert.equal((await call(slug+'/state',{cookie:visitor})).json.request.status,'revoked');
 const listing=await call('/api/competitions',admin);assert.equal(listing.json.competitions[0].slug,'pk-battle-16-10');assert.equal(listing.json.competitions[0].url,'/pk-battle-16-10');
});
test('snapshots freeze rounds and totals; live shows the round since the last snapshot',async t=>{
 const {state,call,advance,now}=await server(t),slug='/api/competitions/pk-battle-16-10';
 const sent=await call(slug+'/request',{method:'POST',body:{name:'Linh'}}),visitor=sent.headers.get('set-cookie').split(';')[0];
 const id=(await call(slug+'/requests',admin)).json.requests[0].id;await call(`${slug}/requests/${id}`,{method:'POST',body:{action:'snapshot'},...admin});
 const first=await call(slug+'/snapshots',{method:'POST',body:{name:'Vòng 1'},cookie:visitor});assert.equal(first.status,200);
 assert.deepEqual(first.json.snapshot.rows.map(r=>[r.talentName,r.round,r.total]),[['LILY 🍉',104,104],['RYAN',40,40],['Chanee🌸',4,4]]);
 assert.equal(state.db.rows('competition_snapshots')[0].createdBy,'Linh');assert.equal(first.json.snapshot.createdBy,undefined,'creator names are for admins only');
 advance(60000);state.db.rows('gifts').push(state.gift(['RYAN'],200,now()-1000),state.gift(['Chanee🌸'],-4,now()-500,state.session));
 const live=(await call(slug+'/board',{cookie:visitor})).json.live;
 assert.deepEqual(live.rows.map(r=>[r.talentName,r.round,r.total]),[['RYAN',200,240],['LILY 🍉',0,104],['Chanee🌸',-4,0]]);assert.equal(live.roundFrom,first.json.snapshot.at);
 advance(1000);const second=(await call(slug+'/snapshots',{method:'POST',body:{name:'Vòng 2'},...admin})).json.snapshot;
 assert.deepEqual(second.groups.map(g=>[g.profileName,g.round,g.total]),[['HT - ICONZ',200,240],['HT - DPM',-4,104]]);assert.equal(second.createdBy,'admin@example.test');
 const board=(await call(slug+'/board',{cookie:visitor})).json;assert.deepEqual(board.snapshots.map(s=>s.name),['Vòng 2','Vòng 1'],'newest first');assert.ok(board.live.rows.every(r=>r.round===0));
 assert.equal((await call(`${slug}/snapshots/${second.id}/rename`,{method:'POST',body:{name:'Chung kết'},cookie:visitor})).status,200);
 assert.equal((await call(`${slug}/snapshots/${second.id}/delete`,{method:'POST',body:{},cookie:visitor})).status,403,'only admins delete');
 assert.equal((await call(slug+'/board',{cookie:visitor})).json.snapshots[0].name,'Chung kết');
 assert.equal((await call(`${slug}/snapshots/${second.id}/delete`,{method:'POST',body:{},...admin})).status,200);
 assert.deepEqual((await call(slug+'/board',{cookie:visitor})).json.snapshots.map(s=>s.name),['Vòng 1']);
});
test('a browser may hold only a few pending requests',async t=>{
 const {state,call}=await server(t),{ObjectId}=require('mongodb');
 for(let i=0;i<3;i++)state.db.rows('competitions').push({_id:new ObjectId(),name:`Extra ${i}`,status:'ended',createdAt:new Date(),participants:[]});state.pages.reset();
 const first=await call('/api/competitions/pk-battle-16-10/request',{method:'POST',body:{name:'A'}}),cookie=first.headers.get('set-cookie').split(';')[0];
 assert.equal((await call('/api/competitions/extra-0/request',{method:'POST',body:{name:'A'},cookie})).status,200);
 assert.equal((await call('/api/competitions/extra-1/request',{method:'POST',body:{name:'A'},cookie})).status,200);
 assert.equal((await call('/api/competitions/extra-2/request',{method:'POST',body:{name:'A'},cookie})).json.error,'too_many_pending');
 assert.equal((await call('/api/competitions/extra-1/request',{method:'POST',body:{name:'A2'},cookie})).status,200,'renaming a pending request is fine');
});
