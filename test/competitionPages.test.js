const test=require('node:test'),assert=require('node:assert/strict');
const {slugify,assignSlugs,scoreGifts,overallScores,buildBoard,snapshotEntry,validName,eliminatedMap}=require('../competitionPages');
const {createCompetitionFixture}=require('./support/competition-server');
test('slugs fold Vietnamese, styled letters and emoji; the newest namesake keeps the plain slug',()=>{
 assert.equal(slugify('PK BATTLE 16/10'),'pk-battle-16-10');assert.equal(slugify('  Cuộc thi Đại chiến 🔥 Mùa 2 '),'cuoc-thi-dai-chien-mua-2');
 assert.equal(slugify('𝓗𝓪𝓷𝓲 🐙'),'hani');assert.equal(slugify('🔥🔥'),'cuoc-thi');assert.equal(slugify('Crown__War--S8!!'),'crown-war-s8');
 const slugs=assignSlugs([{_id:'a',name:'CROWN WAR S8',createdAt:'2026-06-25'},{_id:'b',name:'CROWN WAR S8',createdAt:'2026-06-26'},{_id:'c',name:'Crown War S8',createdAt:'2026-01-01'},{_id:'d',name:'OLD',createdAt:'2026-01-02'},{_id:'e',name:'api',createdAt:'2026-01-03'}]);
 assert.equal(slugs.get('b'),'crown-war-s8');assert.equal(slugs.get('a'),'crown-war-s8-2');assert.equal(slugs.get('c'),'crown-war-s8-3');
 assert.equal(slugs.get('d'),'old-cuoc-thi','reserved paths are never shadowed');assert.equal(slugs.get('e'),'api-cuoc-thi');
 assert.equal(validName('  Kế   toán\u0000 A '),'Kế toán A');assert.equal(validName('x'.repeat(61)),'');assert.equal(validName(42),'');
});
test('Cuộc thi matches HeliosControl (name match, floor split, negative manual gifts, group gifts ignored); Tổng cộng adds window gifts by uid or name, once per gift',()=>{
 const participants=[{talentName:'A',talentUid:'1',profileId:'g1',profileName:'G1'},{talentName:'B',talentUid:'2',profileId:'g1',profileName:'G1'},{talentName:'C',talentUid:'',profileId:'g2',profileName:'G2'}];
 const gifts=[{_id:'c1',receivedTalents:[{name:'A',uid:'1'}],cost:100,timeStamp:10},{_id:'c2',receivedTalents:['A','B'],cost:7,timeStamp:20},{_id:'c3',receivedTalent:'C',cost:50,timeStamp:30},
  {_id:'c4',receivedTalent:'G1',cost:900,timeStamp:31},{_id:'c5',id:'Manual_manual_1',receivedTalents:[{name:'A'}],cost:-30,timeStamp:40},{_id:'c6',receivedTalents:[{name:'B'},{name:'C'}],cost:-5,timeStamp:50},{_id:'c7',cost:8,timeStamp:60}];
 const all=scoreGifts(gifts);assert.equal(all.get('A'),100+3-30);assert.equal(all.get('B'),3-3);assert.equal(all.get('C'),50-3);assert.equal(all.get('Unassigned'),8);
 const windowGifts=[{_id:'c1',receivedTalents:[{name:'A',uid:'1'}],cost:100},{_id:'w1',receivedTalents:[{name:'A tên cũ',uid:'1'}],cost:40},{_id:'w2',receivedTalent:'B',receivedTalentUid:'999',cost:11},
  {_id:'w3',receivedTalent:'Someone',receivedTalentUid:'2',cost:6},{_id:'w4',receivedTalents:[{name:'C',uid:''},{name:'X',uid:''}],cost:-9},{_id:'w5',receivedTalents:[{name:'Q',uid:''}],cost:1000}];
 assert.deepEqual(overallScores(participants,gifts,windowGifts),[73+40,0+11+6,47-5],'uid or name match; c1 is both a competition and a window gift and counts once; empty uids never match');
 const board=buildBoard(participants,gifts,{windowGifts});
 assert.deepEqual(board.rows.map(r=>[r.talentName,r.competition,r.overall]),[['A',73,113],['C',47,42],['B',0,17]]);
 assert.deepEqual(board.groups.map(g=>[g.profileName,g.competition,g.overall]),[['G1',73,130],['G2',47,42]]);
 assert.ok(board.rows.every(r=>!('round' in r)&&!('total' in r)),'no round split any more');
 assert.deepEqual(buildBoard(participants,gifts).rows.map(r=>r.overall),[73,47,0],'without window gifts overall is the competition gifts');
 assert.deepEqual(snapshotEntry({talentName:'A',talentUid:'1',profileId:'g1',profileName:'G1',round:5,total:73},true),{talentName:'A',talentUid:'1',profileId:'g1',profileName:'G1',competition:73,overall:null,eliminated:false,eliminatedAt:null},'old snapshot rows: total is the competition score');
 assert.deepEqual(snapshotEntry({profileId:'g1',profileName:'G1',round:1,total:9},false),{profileId:'g1',profileName:'G1',competition:9,overall:null});
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
 assert.deepEqual(Object.keys(board.json.live).sort(),['at','groups','rows']);assert.deepEqual(Object.keys(board.json.live.rows[0]).sort(),['competition','eliminated','eliminatedAt','overall','profileId','profileName','talentName','talentUid']);
 assert.deepEqual(board.json.live.rows.map(r=>[r.talentName,r.competition,r.overall]),[['LILY 🍉',104,154],['RYAN',40,1039],['Chanee🌸',4,4]],
  'Cuộc thi ignores the foreign-session gift with the same competitionId; Tổng cộng counts it, the uid-matched gift once, and nothing outside the window');
 assert.deepEqual(board.json.live.groups.map(g=>[g.profileName,g.competition,g.overall]),[['HT - DPM',108,158],['HT - ICONZ',40,1039]]);
 assert.equal((await call(slug+'/snapshots',{method:'POST',body:{name:'Snapshot 1'},cookie:visitor})).json.error,'role_required');
 const other=await call(slug+'/state',{cookie:'helios_comp='+'A'.repeat(43)});assert.equal(other.json.role,null,'another browser has no grant');
 assert.equal((await call(`${slug}/requests/${id}`,{method:'POST',body:{action:'revoke'},...admin})).status,200);
 assert.equal((await call(slug+'/board',{cookie:visitor})).status,401);assert.equal((await call(slug+'/state',{cookie:visitor})).json.request.status,'revoked');
 const listing=await call('/api/competitions',admin);assert.equal(listing.json.competitions[0].slug,'pk-battle-16-10');assert.equal(listing.json.competitions[0].url,'/pk-battle-16-10');
});
test('snapshots freeze both modes and groups; live stays cumulative; old snapshots still render',async t=>{
 const {state,call,advance,now}=await server(t),slug='/api/competitions/pk-battle-16-10',{ObjectId}=require('mongodb');
 state.db.rows('competition_snapshots').push({_id:new ObjectId(),competitionId:String(state.id),name:'Bản cũ',at:now()-600000,createdAt:new Date(now()-600000),createdBy:'x',
  rows:[{talentName:'RYAN',talentUid:'3',profileId:'g2',profileName:'HT - ICONZ',round:5,total:40}],groups:[{profileId:'g2',profileName:'HT - ICONZ',round:5,total:40}]});
 const sent=await call(slug+'/request',{method:'POST',body:{name:'Linh'}}),visitor=sent.headers.get('set-cookie').split(';')[0];
 const id=(await call(slug+'/requests',admin)).json.requests[0].id;await call(`${slug}/requests/${id}`,{method:'POST',body:{action:'snapshot'},...admin});
 const first=await call(slug+'/snapshots',{method:'POST',body:{name:'Snapshot 1'},cookie:visitor});assert.equal(first.status,200);
 assert.deepEqual(first.json.snapshot.rows.map(r=>[r.talentName,r.competition,r.overall]),[['LILY 🍉',104,154],['RYAN',40,1039],['Chanee🌸',4,4]]);
 assert.equal(state.db.rows('competition_snapshots')[1].createdBy,'Linh');assert.equal(first.json.snapshot.createdBy,undefined,'creator names are for admins only');
 advance(60000);state.db.rows('gifts').push(state.gift(['RYAN'],200,now()-1000),state.gift(['Chanee🌸'],-4,now()-500,state.session),state.gift([{name:'Chanee cũ',uid:'2'}],30,now()-400,state.foreign,null));
 const live=(await call(slug+'/board',{cookie:visitor})).json.live;assert.equal(live.roundFrom,undefined);
 assert.deepEqual(live.rows.map(r=>[r.talentName,r.competition,r.overall]),[['RYAN',240,1239],['LILY 🍉',104,154],['Chanee🌸',0,30]],'live is cumulative, not since the last snapshot');
 advance(1000);const second=(await call(slug+'/snapshots',{method:'POST',body:{name:'Snapshot 2'},...admin})).json.snapshot;
 assert.deepEqual(second.groups.map(g=>[g.profileName,g.competition,g.overall]),[['HT - ICONZ',240,1239],['HT - DPM',104,184]]);assert.equal(second.createdBy,'admin@example.test');
 const board=(await call(slug+'/board',{cookie:visitor})).json;assert.deepEqual(board.snapshots.map(s=>s.name),['Snapshot 2','Snapshot 1','Bản cũ'],'newest first');
 assert.deepEqual(board.snapshots[1].rows.map(r=>[r.talentName,r.competition,r.overall]),[['LILY 🍉',104,154],['RYAN',40,1039],['Chanee🌸',4,4]],'a snapshot stays frozen');
 assert.deepEqual(board.snapshots[2].rows,[{talentName:'RYAN',talentUid:'3',profileId:'g2',profileName:'HT - ICONZ',competition:40,overall:null,eliminated:false,eliminatedAt:null}],'old snapshot: total -> competition, overall unknown, nobody eliminated');
 assert.deepEqual(board.snapshots[2].groups,[{profileId:'g2',profileName:'HT - ICONZ',competition:40,overall:null}]);
 assert.equal((await call(`${slug}/snapshots/${second.id}/rename`,{method:'POST',body:{name:'Chung kết'},cookie:visitor})).status,200);
 assert.equal((await call(`${slug}/snapshots/${second.id}/delete`,{method:'POST',body:{},cookie:visitor})).status,403,'only admins delete');
 assert.equal((await call(slug+'/board',{cookie:visitor})).json.snapshots[0].name,'Chung kết');
 assert.equal((await call(`${slug}/snapshots/${second.id}/delete`,{method:'POST',body:{},...admin})).status,200);
 assert.deepEqual((await call(slug+'/board',{cookie:visitor})).json.snapshots.map(s=>s.name),['Snapshot 1','Bản cũ']);
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
test('eliminated talents: missing field means none, flags follow the gifts cache, groups still count them, snapshots keep the state',async t=>{
 assert.equal(eliminatedMap(undefined).size,0);assert.equal(eliminatedMap(null).size,0);assert.deepEqual([...eliminatedMap([{talentName:'A',at:new Date('2026-10-27T16:00:00Z')},{at:1},null])],[['A','2026-10-27T16:00:00.000Z']]);
 const parts=[{talentName:'A',profileId:'g',profileName:'G'},{talentName:'B',profileId:'g',profileName:'G'}],gifts=[{cost:10,timeStamp:1,receivedTalent:'A'},{cost:5,timeStamp:2,receivedTalent:'B'}];
 const b=buildBoard(parts,gifts,{eliminated:[{talentName:'A',at:new Date(0)}]});
 assert.deepEqual(b.rows.map(r=>[r.talentName,r.eliminated,r.eliminatedAt]),[['A',true,'1970-01-01T00:00:00.000Z'],['B',false,null]]);assert.equal(b.groups[0].competition,15,'eliminated points stay in the group total');
 assert.deepEqual(snapshotEntry({talentName:'A',competition:1,eliminated:true,eliminatedAt:'2026-10-27T16:00:00.000Z'},true).eliminated,true);
 const {state,call,advance,now}=await server(t),slug='/api/competitions/pk-battle-16-10';
 const flags=async()=>(await call(slug+'/board',admin)).json.live.rows.map(r=>[r.talentName,r.eliminated,r.eliminatedAt]);
 assert.deepEqual(await flags(),[['LILY 🍉',false,null],['RYAN',false,null],['Chanee🌸',false,null]],'no eliminated field: nobody is out');
 const comp=state.db.rows('competitions')[0],at=new Date(now());comp.eliminated=[{talentName:'RYAN',at}];comp.eliminatedLog=[{talentName:'RYAN',action:'out',at}];comp.eliminatedUpdatedAt=at;
 assert.equal((await flags())[1][1],false,'read at the gifts pace (8 s while active), not instantly');
 advance(9000);assert.deepEqual((await flags())[1],['RYAN',true,at.toISOString()]);
 const groups=(await call(slug+'/board',admin)).json.live.groups;assert.deepEqual(groups.map(g=>[g.profileName,g.competition]),[['HT - DPM',108],['HT - ICONZ',40]],'RYAN (out) still counts for ICONZ');
 const snap=(await call(slug+'/snapshots',{method:'POST',body:{name:'Vòng 1'},...admin})).json.snapshot;assert.deepEqual(snap.rows.find(r=>r.talentName==='RYAN').eliminated,true);
 comp.eliminated=[];advance(9000);assert.equal((await flags())[1][1],false,'revived');
 const board=(await call(slug+'/board',admin)).json;assert.equal(board.snapshots[0].rows.find(r=>r.talentName==='RYAN').eliminated,true,'snapshot keeps the state at capture time');
});
