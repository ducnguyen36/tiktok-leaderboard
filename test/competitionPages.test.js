const test=require('node:test'),assert=require('node:assert/strict');
const {slugify,assignSlugs,scoreGifts,overallScores,buildBoard,snapshotEntry,validName,eliminatedMap,withLogRanks}=require('../competitionPages');
const {createCompetitionFixture,seed:seedCompetition}=require('./support/competition-server');
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
 assert.deepEqual(snapshotEntry({talentName:'A',talentUid:'1',profileId:'g1',profileName:'G1',round:5,total:73},true),{talentName:'A',talentUid:'1',profileId:'g1',profileName:'G1',competition:73,overall:null,eliminated:false,eliminatedAt:null,eliminatedRank:null,eliminatedOf:null,eliminatedRankSource:null,eliminatedRound:null,revives:0},'old snapshot rows: total is the competition score');
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
 assert.deepEqual(Object.keys(board.json.live).sort(),['at','groups','rows']);assert.deepEqual(Object.keys(board.json.live.rows[0]).sort(),['competition','eliminated','eliminatedAt','eliminatedOf','eliminatedRank','eliminatedRankSource','eliminatedRound','overall','profileId','profileName','revives','talentName','talentUid']);
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
 assert.deepEqual(board.snapshots[2].rows,[{talentName:'RYAN',talentUid:'3',profileId:'g2',profileName:'HT - ICONZ',competition:40,overall:null,eliminated:false,eliminatedAt:null,eliminatedRank:null,eliminatedOf:null,eliminatedRankSource:null,eliminatedRound:null,revives:0}],'old snapshot: total -> competition, overall unknown, nobody eliminated');
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
 assert.equal(eliminatedMap(undefined).size,0);assert.equal(eliminatedMap(null).size,0);assert.deepEqual([...eliminatedMap([{talentName:'A',at:new Date('2026-10-27T16:00:00Z'),rank:12,of:13},{at:1},null])],[['A',{at:'2026-10-27T16:00:00.000Z',rank:12,of:13,round:null}]]);
 const parts=[{talentName:'A',profileId:'g',profileName:'G'},{talentName:'B',profileId:'g',profileName:'G'}],gifts=[{cost:10,timeStamp:1,receivedTalent:'A'},{cost:5,timeStamp:2,receivedTalent:'B'}];
 const b=buildBoard(parts,gifts,{eliminated:[{talentName:'A',at:new Date(0)}]});
 assert.deepEqual(b.rows.map(r=>[r.talentName,r.eliminated,r.eliminatedAt,r.eliminatedRank,r.eliminatedOf,r.eliminatedRankSource]),[['A',true,'1970-01-01T00:00:00.000Z',2,2,'computed'],['B',false,null,null,null,null]],'no rank from HeliosControl: computed');assert.equal(b.groups[0].competition,15,'eliminated points stay in the group total');
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
test('elimination rank: HeliosControl rank/of used as is, missing ones computed (M rule, score at that moment), out-in-out takes the new rank',async t=>{
 const P=['A','B','C','D','E'].map(n=>({talentName:n,profileId:'g',profileName:'G'})),g=(n,cost,at)=>({cost,timeStamp:at,receivedTalent:n});
 // Scores now: A 50, B 40, C 30, D 20 (D had 5 at t=100 and 15 more later), E 1.
 const gifts=[g('A',50,1),g('B',40,1),g('C',30,1),g('D',5,1),g('D',15,300),g('E',1,1)];
 const rows=list=>Object.fromEntries(buildBoard(P,gifts,{eliminated:list}).rows.map(r=>[r.talentName,[r.eliminatedRank,r.eliminatedOf,r.eliminatedRankSource]]));
 // Given: used verbatim even when it disagrees with a score-based guess.
 assert.deepEqual(rows([{talentName:'E',at:new Date(100),rank:4,of:5},{talentName:'D',at:new Date(200),rank:3,of:4}]).E,[4,5,'helioscontrol']);
 // Missing: E and D out together at t=100 with 5 still in: M=5; score at t=100: D 5 > E 1 -> D 4/5, E 5/5. Then C out at 200: M=3 -> 3/3.
 const fb=rows([{talentName:'E',at:new Date(100)},{talentName:'D',at:new Date(100)},{talentName:'C',at:new Date(200)}]);
 assert.deepEqual([fb.D,fb.E,fb.C],[[4,5,'computed'],[5,5,'computed'],[3,3,'computed']]);
 // Mixed: newer lines carry rank, older ones not.
 const mixed=rows([{talentName:'E',at:new Date(100)},{talentName:'C',at:new Date(200),rank:4,of:4}]);assert.deepEqual([mixed.E,mixed.C],[[5,5,'computed'],[4,4,'helioscontrol']]);
 // eliminatedLog fills a missing rank only from the 'out' line of the same moment; out -> in -> out keeps the latest.
 const log=[{talentName:'E',action:'out',at:new Date(100),rank:5,of:5},{talentName:'E',action:'in',at:new Date(150)},{talentName:'E',action:'out',at:new Date(250),rank:3,of:3}];
 assert.deepEqual(withLogRanks([{talentName:'E',at:new Date(250)}],log)[0].rank,3,'re-eliminated: new rank, old one dropped');
 assert.equal(withLogRanks([{talentName:'E',at:new Date(999)}],log)[0].rank,undefined,'no line for that moment: left to the fallback');
 assert.deepEqual(rows(withLogRanks([{talentName:'E',at:new Date(250)}],log)).E,[3,3,'helioscontrol']);
 // Snapshots keep rank/of; older snapshots without them stay null.
 assert.deepEqual([snapshotEntry({talentName:'E',eliminated:true,eliminatedAt:'x',eliminatedRank:3,eliminatedOf:3,eliminatedRankSource:'helioscontrol'},true).eliminatedRank,snapshotEntry({talentName:'E',eliminated:true},true).eliminatedRank],[3,null]);
 // Through the API: rank/of and the eliminatedLog are read with the gifts.
 const {state,call,advance,now}=await server(t),slug='/api/competitions/pk-battle-16-10',comp=state.db.rows('competitions')[0],at=new Date(now());
 comp.eliminated=[{talentName:'RYAN',at,rank:2,of:3}];advance(9000);
 const live=(await call(slug+'/board',admin)).json.live;assert.deepEqual(live.rows.find(r=>r.talentName==='RYAN').eliminatedRank,2);
 const snap=(await call(slug+'/snapshots',{method:'POST',body:{name:'V'},...admin})).json.snapshot;assert.deepEqual([snap.rows.find(r=>r.talentName==='RYAN').eliminatedRank,snap.rows.find(r=>r.talentName==='RYAN').eliminatedOf],[2,3]);
});
test('fallback rank replays eliminatedLog: revived talents count as still in, revivals at the same moment first',()=>{
 const P=['A','B','C','D','E','F'].map(n=>({talentName:n,profileId:'g',profileName:'G'})),gifts=['A','B','C','D','E','F'].map((n,i)=>({cost:60-i*10,timeStamp:1,receivedTalent:n}));
 // t=100: E,F out (6 in). t=200: E revived and D out at the same moment (E counts as in: 5 in -> D 5/5). t=300: E out again (4 in: A,B,C,E).
 const log=[{talentName:'E',action:'out',at:new Date(100)},{talentName:'F',action:'out',at:new Date(100)},{talentName:'E',action:'in',at:new Date(200)},{talentName:'D',action:'out',at:new Date(200)},{talentName:'E',action:'out',at:new Date(300)}];
 const eliminated=[{talentName:'F',at:new Date(100)},{talentName:'D',at:new Date(200)},{talentName:'E',at:new Date(300)}];
 const rows=Object.fromEntries(buildBoard(P,gifts,{eliminated,eliminatedLog:log}).rows.map(r=>[r.talentName,r.eliminatedRank+'/'+r.eliminatedOf]));
 assert.deepEqual([rows.E,rows.D,rows.F],['4/4','5/5','6/6'],'E (revived, out again) gets the later rank; F keeps 6/6 although E left with it');
 // Without the log the old estimate (current state) is used.
 const plain=Object.fromEntries(buildBoard(P,gifts,{eliminated}).rows.map(r=>[r.talentName,r.eliminatedRank+'/'+r.eliminatedOf]));assert.deepEqual([plain.E,plain.D,plain.F],['4/4','5/5','6/6']);
});
test('revive counts come from the eliminatedLog "in" lines and are kept in snapshots',()=>{
 const P=['A','B'].map(n=>({talentName:n,profileId:'g',profileName:'G'})),log=[{talentName:'A',action:'out',at:new Date(1)},{talentName:'A',action:'in',at:new Date(2)},{talentName:'A',action:'out',at:new Date(3)}];
 const rows=buildBoard(P,[],{eliminated:[{talentName:'A',at:new Date(3)}],eliminatedLog:log}).rows;assert.deepEqual(rows.map(r=>[r.talentName,r.revives]),[['A',1],['B',0]]);
 assert.equal(snapshotEntry({talentName:'A',revives:1},true).revives,1);assert.equal(snapshotEntry({talentName:'A'},true).revives,0,'old snapshots: none');
});
test('fallback rank survives a talent revived after going out with others (still in the log group, no longer out)',()=>{
 const P=['A','B','C'].map(n=>({talentName:n,profileId:'g',profileName:'G'})),gifts=[{cost:5,timeStamp:1,receivedTalent:'A'}];
 const log=[{talentName:'B',action:'out',at:new Date(100)},{talentName:'C',action:'out',at:new Date(100)},{talentName:'C',action:'in',at:new Date(200)}];
 const rows=Object.fromEntries(buildBoard(P,gifts,{eliminated:[{talentName:'B',at:new Date(100)}],eliminatedLog:log}).rows.map(r=>[r.talentName,[r.eliminated,r.eliminatedRank,r.revives]]));
 assert.deepEqual(rows,{A:[false,null,0],B:[true,2,0],C:[false,null,1]},'C left the group (revived): B still gets 2/3 by score at that moment (B 0 = C 0, name order)');
});
test('a competition not started yet (status created) shows Tổng cộng from competition gifts only, not revenue since it was created',async t=>{
 const {state,call}=await server(t),slug='/api/competitions/pk-battle-16-10',comp=state.db.rows('competitions')[0];
 const before=(await call(slug+'/board',admin)).json.live.rows.find(r=>r.talentName==='RYAN');assert.equal(before.overall,1039,'started: window gifts count');
 const startedAt=comp.startedAt;comp.status='created';comp.startedAt=null;state.pages.reset();
 const rows=(await call(slug+'/board',admin)).json.live.rows;
 assert.deepEqual(rows.map(r=>[r.talentName,r.overall]),rows.map(r=>[r.talentName,r.competition]),'overall = competition gifts only');
 assert.equal(rows.find(r=>r.talentName==='RYAN').overall,40);
 comp.status='active';comp.startedAt=startedAt;state.pages.reset();
 assert.equal((await call(slug+'/board',admin)).json.live.rows.find(r=>r.talentName==='RYAN').overall,1039,'after Start the window counts again');
});
const pkFixtures=require('./support/pk-fixtures');
const {cleanPkStage,cleanStanding,eliminationRounds}=require('../competitionPages');
test('pkStage is read defensively: missing or junk means none, partial data is kept, limits and types enforced',()=>{
 for(const junk of [undefined,null,'pk',[],{},{phase:'pk'},{matches:[{id:'X',talents:[]}]}])assert.equal(cleanPkStage(junk),null,JSON.stringify(junk));
 const mid=cleanPkStage(pkFixtures.midPk(Date.parse('2026-11-14T12:00:00Z')));
 assert.equal(mid.phase,'pk');assert.equal(mid.firstTo,2);assert.equal(mid.takeLower,2);assert.deepEqual(mid.tracks.map(t=>t.id),['A'],'one competition = one track');
 assert.deepEqual(mid.matches.map(m=>[m.id,m.status,m.winner,m.rounds.length]),[['A1','done','RYAN',5],['A2','running',null,2],['A3','done','G',4]]);
 assert.deepEqual(mid.matches[0].points,{'LILY 🍉':1,RYAN:2},'points = the current score');
 assert.deepEqual(mid.matches[0].rounds.slice(1,3),[{n:2,winner:null,tied:['LILY 🍉','RYAN'],diamonds:{'LILY 🍉':400,RYAN:400},cancelledByRevive:null},{n:3,winner:'LILY 🍉',tied:[],diamonds:{'LILY 🍉':900,RYAN:300},cancelledByRevive:'RYAN'}],'a tie, then a round cancelled by a revive');
 assert.deepEqual(mid.matches[0].revives,[{talentName:'RYAN',at:'2026-11-14T11:45:00.000Z',success:true,mode:'gap',target:1200,round:3},{talentName:'LILY 🍉',at:'2026-11-14T11:50:00.000Z',success:false,mode:'fixed',target:2000,round:5}],'dates become ISO strings');
 assert.deepEqual(mid.tables,{upper:['RYAN','G'],lower:['LILY 🍉','E','F'],cut:['F'],lowerBy:'seed'});assert.equal(mid.updatedAt,'2026-11-14T12:00:00.000Z');
 // Partial (only matches, odd values): defaults filled, unknown values dropped, never thrown.
 const partial=cleanPkStage({phase:'??',takeLower:null,matches:[{id:'M1',talents:['A','B','A',' ','x'.repeat(61)],points:{A:'2',B:-1},winner:'Z',status:'weird',revives:[{talentName:'Q',success:true},{talentName:'B',success:'yes',mode:'magic',target:-5,play:2}],plays:3,rounds:[null,{winner:'Z',tied:['A','Q'],diamonds:{A:'12.6',Q:9,B:'x'},cancelledByRevive:'B'}]}],tables:{lowerBy:'rank'}});
 assert.equal(partial.phase,'setup');assert.equal(partial.firstTo,2);assert.equal(partial.takeLower,null);assert.equal(partial.voting,null);
 assert.deepEqual(partial.matches[0],{id:'M1',track:null,order:null,talents:['A','B'],status:'pending',points:{A:2,B:0},winner:null,losers:[],rounds:[{n:2,winner:null,tied:['A'],diamonds:{A:13},cancelledByRevive:null}],revives:[{talentName:'B',at:null,success:null,mode:null,target:null,round:null}],startedAt:null,endedAt:null},'old plays/play dropped; a round without a winner is a tie and cannot be cancelled');
 assert.deepEqual(partial.tables,{upper:[],lower:[],cut:[],lowerBy:'seed'});
 // Limits: ≤ 40 matches, ≤ 6 talents per match, ≤ 60 names, labels ≤ 40.
 const many=cleanPkStage({phase:'pk',seed:Array.from({length:80},(_,i)=>`T${i}`),tracks:[{id:'A',label:'L'.repeat(50)}],matches:Array.from({length:50},(_,i)=>({id:`M${i}`,talents:Array.from({length:9},(_,j)=>`T${j}`)}))});
 assert.equal(many.seed.length,60);assert.equal(many.matches.length,40);assert.equal(many.matches[0].talents.length,6);assert.equal([...many.tracks[0].label].length,40);
 // standing passes through cleaned.
 assert.equal(cleanStanding(null),null);assert.equal(cleanStanding({rows:[]}),null);
 assert.deepEqual(cleanStanding({rows:[{talentName:'A',place:1,group:'upper',zone:'safe'},{talentName:'B',place:'x',group:'nope'}],safeAfter:1,cutAfter:3,safeLabel:'An toàn',cutLabel:'Cắt',updatedAt:new Date(0)}),
  {rows:[{talentName:'A',place:1,group:'upper',zone:'safe'},{talentName:'B',place:null,group:null,zone:null}],safeAfter:1,cutAfter:3,safeLabel:'An toàn',cutLabel:'Cắt',updatedAt:'1970-01-01T00:00:00.000Z'});
});
test('PK stage reaches the board and snapshots: mid-PK, voting, done, and nothing for a competition without it',async t=>{
 const {state,call,advance,now}=await server(t),slug='/api/competitions/pk-battle-16-10',comp=state.db.rows('competitions')[0];
 const live=async()=>(await call(slug+'/board',admin)).json.live;
 const plain=await live();assert.equal('pkStage' in plain,false,'no pkStage: no key');assert.equal('standing' in plain,false);assert.equal('rounds' in plain,false);
 comp.pkStage=pkFixtures.midPk(now());comp.standing={rows:[{talentName:'RYAN',place:1,group:'upper',zone:'safe'}],safeAfter:1,cutAfter:2,updatedAt:new Date(now())};advance(9000);
 const mid=await live();assert.equal(mid.pkStage.phase,'pk');assert.equal(mid.pkStage.matches.find(m=>m.id==='A2').status,'running');assert.deepEqual(mid.standing.rows.map(r=>r.talentName),['RYAN']);
 assert.deepEqual(mid.rows.map(r=>[r.talentName,r.revives]),[['LILY 🍉',0],['RYAN',1],['Chanee🌸',0]],'a successful PK revive counts as a revive (a failed one does not)');
 const snap=(await call(slug+'/snapshots',{method:'POST',body:{name:'Giữa PK'},...admin})).json.snapshot;assert.equal(snap.pkStage.phase,'pk');assert.equal(snap.standing.rows.length,1);
 comp.pkStage=pkFixtures.voting(now());advance(9000);
 const vote=await live();assert.equal(vote.pkStage.phase,'voting');assert.deepEqual(vote.pkStage.voting,{order:['RYAN','Chanee🌸','G','LILY 🍉','D'],done:['RYAN','Chanee🌸'],current:'G',status:'running'});
 const board=(await call(slug+'/board',admin)).json;assert.equal(board.snapshots[0].pkStage.phase,'pk','the snapshot keeps the PK state of its time');
 assert.equal(board.snapshots[0].pkStage.matches.find(m=>m.id==='A2').status,'running');
 comp.pkStage=pkFixtures.done(now());advance(9000);const end=await live();assert.equal(end.pkStage.phase,'done');assert.equal(end.pkStage.voting.status,'done');
 assert.deepEqual(end.rows.map(r=>r.talentName),['LILY 🍉','RYAN','Chanee🌸'],'the score ranking is unchanged by the PK stage');
 comp.pkStage={phase:'pk',matches:'broken'};advance(9000);assert.equal('pkStage' in await live(),false,'unusable pkStage is dropped');
});
test('eliminations grouped by round label (newest round first), revived talents flagged; no labels keeps the old shape',()=>{
 assert.equal(eliminationRounds([{talentName:'A',at:new Date(1)}],[{talentName:'A',action:'out',at:new Date(1)}]),null,'no round labels: snapshot rounds stay the fallback');
 const log=[{talentName:'A',action:'out',at:new Date(100),round:'PK'},{talentName:'B',action:'out',at:new Date(100),round:'PK'},{talentName:'B',action:'in',at:new Date(150)},
  {talentName:'C',action:'out',at:new Date(200),round:'Voting'},{talentName:'B',action:'out',at:new Date(300),round:'Chasing 1'}];
 const eliminated=[{talentName:'A',at:new Date(100),round:'PK'},{talentName:'C',at:new Date(200)},{talentName:'B',at:new Date(300),round:'Chasing 1'}];
 const rounds=eliminationRounds(eliminated,log);
 assert.deepEqual(rounds.map(g=>[g.round,g.talents.map(t=>[t.talentName,t.back])]),[['Chasing 1',[['B',false]]],['Voting',[['C',false]]],['PK',[['A',false],['B',true]]]],'B went out in PK, was revived, then went out again in Chasing 1');
 const P=['A','B','C','D'].map(n=>({talentName:n,profileId:'g',profileName:'G'}));
 const b=buildBoard(P,[],{eliminated:withLogRanks(eliminated,log),eliminatedLog:log});
 assert.deepEqual(Object.fromEntries(b.rows.map(r=>[r.talentName,r.eliminatedRound])),{A:'PK',B:'Chasing 1',C:'Voting',D:null},'C takes its round from the log line of the same moment');
 assert.deepEqual(b.rounds.map(g=>g.round),['Chasing 1','Voting','PK']);assert.equal(b.rows.find(r=>r.talentName==='B').revives,1);
 assert.equal(snapshotEntry({talentName:'C',eliminated:true,eliminatedRound:'Voting'},true).eliminatedRound,'Voting');assert.equal(snapshotEntry({talentName:'C',eliminated:false,eliminatedRound:'Voting'},true).eliminatedRound,null);
});
// --- Test DB competitions (HeliosControl "Test DB" mode -> helioscontrol_test) served at /test-<slug> ---
// The test DB gets the same seeded "PK BATTLE 16/10" (same name as the real one) plus a test-only "Giải Thử" with an older namesake.
function seedTestDb(state,now){
 const {ObjectId}=require('mongodb'),seeded=seedCompetition(state.testDb,now);
 const thu=new ObjectId(),thuOld=new ObjectId();
 state.testDb.rows('competitions').push({_id:thu,name:'Giải Thử',status:'active',createdAt:new Date(now-1000),startedAt:new Date(now-1000),participants:[]},
  {_id:thuOld,name:'GIẢI THỬ',status:'ended',createdAt:new Date(now-86400000),participants:[]});
 // Only the test DB: RYAN +5000 in the test competition's own session, so its board differs from the real one.
 state.testDb.rows('gifts').push(seeded.gift(['RYAN'],5000,now-1500,seeded.session,seeded.id));
 return{...seeded,thu,thuOld};
}
// Records which collections a memory DB is asked for.
function spy(db){const seen=[],collection=db.collection.bind(db);db.collection=name=>{seen.push(name);return collection(name)};return seen}
test('test competitions: /test-<slug> from the test DB slugs only; test-only names never resolve without the prefix',async t=>{
 const {state,call,now}=await server(t),tdb=seedTestDb(state,now());
 const real=(await call('/api/competitions/pk-battle-16-10/state')).json.competition;
 assert.equal(real.id,String(state.id));assert.equal(real.slug,'pk-battle-16-10');assert.equal('test' in real,false,'real competitions carry no test flag');
 const test=(await call('/api/competitions/test-pk-battle-16-10/state')).json.competition;
 assert.equal(test.id,String(tdb.id),'the namesake in the test DB is a different competition');assert.equal(test.slug,'test-pk-battle-16-10');assert.equal(test.test,true);
 assert.equal((await call('/test-pk-battle-16-10')).status,200);assert.equal((await call('/test-giai-thu')).status,200);
 assert.equal((await call('/api/competitions/test-giai-thu/state')).json.competition.id,String(tdb.thu),'newest namesake keeps the plain slug');
 assert.equal((await call('/api/competitions/test-giai-thu-2/state')).json.competition.id,String(tdb.thuOld),'older namesake gets -2 inside the test DB');
 assert.equal((await call('/giai-thu')).status,404,'a test competition is never reachable without test-');
 assert.equal((await call('/api/competitions/giai-thu/state')).status,404);
 assert.equal((await call('/test-')).status,404);assert.equal((await call('/test-nope')).status,404);assert.equal((await call('/api/competitions/test-nope/state')).status,404);
});
test('test competitions: board, PK stage, eliminated, gifts, grants and snapshots all use the test DB',async t=>{
 const {state,call,now}=await server(t),tdb=seedTestDb(state,now()),slug='/api/competitions/test-pk-battle-16-10',realSlug='/api/competitions/pk-battle-16-10';
 const tcomp=state.testDb.rows('competitions').find(c=>String(c._id)===String(tdb.id)),at=new Date(now());
 tcomp.eliminated=[{talentName:'Chanee🌸',at,rank:3,of:3}];tcomp.pkStage={phase:'pk',matches:[{id:'A1',talents:['LILY 🍉','RYAN'],status:'running'}]};
 await call(realSlug+'/state');const realSeen=spy(state.db);
 const board=(await call(slug+'/board',admin)).json;
 assert.deepEqual(board.live.rows.map(r=>[r.talentName,r.competition,r.overall]),[['RYAN',5040,6039],['LILY 🍉',104,154],['Chanee🌸',4,4]],'gifts and window gifts come from the test DB');
 assert.equal(board.live.rows.find(r=>r.talentName==='Chanee🌸').eliminated,true);assert.equal(board.live.pkStage.matches[0].id,'A1');assert.equal(board.competition.test,true);
 assert.deepEqual([...new Set(realSeen)].filter(n=>n!=='competitions'),[],'the real DB is only asked whether a real competition owns the path (throttled list refresh); no gifts, sessions or grants');
 const realBoard=(await call(realSlug+'/board',admin)).json.live;
 assert.deepEqual(realBoard.rows.map(r=>[r.talentName,r.competition,r.eliminated]),[['LILY 🍉',104,false],['RYAN',40,false],['Chanee🌸',4,false]],'the real competition is untouched');assert.equal('pkStage' in realBoard,false);
 // Access grants live in the test DB and only open the test competition.
 const sent=await call(slug+'/request',{method:'POST',body:{name:'Kế toán'}}),visitor=sent.headers.get('set-cookie').split(';')[0];
 assert.equal(state.testDb.rows('competition_access').length,1);assert.equal(state.db.rows('competition_access').length,0);
 const requests=(await call(slug+'/requests',admin)).json.requests;assert.equal(requests.length,1);assert.equal((await call(realSlug+'/requests',admin)).json.requests.length,0);
 assert.equal((await call(`${slug}/requests/${requests[0].id}`,{method:'POST',body:{action:'snapshot'},...admin})).status,200);
 assert.equal((await call(slug+'/board',{cookie:visitor})).status,200);assert.equal((await call(realSlug+'/board',{cookie:visitor})).status,401,'a test grant never opens the real competition');
 const snap=await call(slug+'/snapshots',{method:'POST',body:{name:'Thử 1'},cookie:visitor});assert.equal(snap.status,200);
 assert.equal(state.testDb.rows('competition_snapshots').length,1);assert.equal(state.db.rows('competition_snapshots').length,0);
 assert.deepEqual((await call(slug+'/board',{cookie:visitor})).json.snapshots.map(s=>s.name),['Thử 1']);assert.deepEqual((await call(realSlug+'/board',admin)).json.snapshots,[]);
 // Admin list: real and test competitions, test ones flagged with their /test- url and their own pending counts.
 await call('/api/competitions/test-giai-thu/request',{method:'POST',body:{name:'B'}});
 const list=(await call('/api/competitions',admin)).json.competitions,find=url=>list.find(c=>c.url===url);
 assert.equal(find('/pk-battle-16-10').test,undefined);assert.equal(find('/test-pk-battle-16-10').test,true);assert.equal(find('/test-giai-thu').pending,1);assert.equal(find('/test-giai-thu-2').test,true);
 // Test DB unavailable: real pages and the list keep working, test pages are simply not there.
 state.testDb=null;state.pages.reset();
 assert.equal((await call(realSlug+'/state')).status,200);assert.equal((await call('/test-giai-thu')).status,404);assert.equal((await call('/api/competitions/test-giai-thu/state')).status,503);
 assert.deepEqual((await call('/api/competitions',admin)).json.competitions.map(c=>c.url),['/pk-battle-16-10']);
});
test('a real competition whose own slug starts with test- wins over a test competition with the same path',async t=>{
 const {state,call,now}=await server(t),{ObjectId}=require('mongodb'),realId=new ObjectId(),testId=new ObjectId();
 state.db.rows('competitions').push({_id:realId,name:'Test ABC',status:'active',createdAt:new Date(now()),participants:[]});
 state.testDb.rows('competitions').push({_id:testId,name:'ABC',status:'active',createdAt:new Date(now()),participants:[]});
 const comp=(await call('/api/competitions/test-abc/state')).json.competition;assert.equal(comp.id,String(realId));assert.equal('test' in comp,false);
 assert.equal((await call('/test-abc')).status,200);
 const list=(await call('/api/competitions',admin)).json.competitions;
 assert.deepEqual(list.filter(c=>c.url==='/test-abc').map(c=>c.id),[String(realId)],'the shadowed test competition is left out of the list');
});
