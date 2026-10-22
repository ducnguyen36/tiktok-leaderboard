const test=require('node:test'),assert=require('node:assert/strict');
const {sheetDate,parseSheet,discrepancy,matchingProfile,comparableDay,talentColumns}=require('../sheetReconciliation');
const N=require('../public/next-core');
test('only closed publisher-verified sessions are comparable, not reused legacy sessions',()=>{
 const sessions=[{_id:'s',profileId:'g',createdAt:new Date('2026-10-01T10:00:00+07:00')}];
 assert.equal(comparableDay('2026-10-01','g',sessions,new Set(),new Set()),false);
 assert.equal(comparableDay('2026-10-01','g',sessions,new Set(['s']),new Set(['s'])),false);
 assert.equal(comparableDay('2026-10-01','g',sessions,new Set(['s']),new Set()),true);
 assert.equal(comparableDay('2026-10-02','g',sessions,new Set(['s']),new Set()),false);
});
const headers=['Date','Alice','Bob','Chung','TỔNG','TOTAL'];
test('group-only reconciliation uses explicit totals without inventing talent mapping',()=>{
 const parsed=parseSheet([headers,[],[46296,100,200,20,320,300],[46297,null,null,0,0,0]],'2026-10',[]);
 assert.equal(parsed.days.length,1);assert.equal(parsed.days[0].group,320);assert.deepEqual(parsed.days[0].individual,{});
});
test('strict discrepancy threshold is greater than 1000, including negative differences',()=>{
 assert.equal(discrepancy(2000,1000,{}),null);assert.equal(discrepancy(2001,1000,{}).delta,1001);assert.equal(discrepancy(0,1001,{}).delta,-1001);assert.equal(discrepancy(NaN,0,{}),null);
});
test('sheet dates handle serials and wrong-month copies are rejected',()=>{
 assert.equal(sheetDate(46296),'2026-10-01');assert.equal(sheetDate('1/10/2026'),'2026-10-01');
 assert.equal(parseSheet([headers,[],[46266,100,200,0,300,300]],'2026-10',['Alice','Bob']).error,'date_month_mismatch');
});
test('two shifts with merged date aggregate once; common points split without double counting',()=>{
 const parsed=parseSheet([headers,[],[46296,100,200,20,320,300],[null,50,60,10,120,110],[46297,null,null,0,null,0]],'2026-10',['Alice','Bob']);
 assert.equal(parsed.days.length,1);assert.equal(parsed.days[0].group,440);assert.equal(parsed.days[0].individual.Alice,165);assert.equal(parsed.days[0].individual.Bob,275);
});
test('unfilled formula zeros are not treated as entered scores; explicit zero/off is supported',()=>{
 const parsed=parseSheet([headers,[],[46296,null,null,0,0,0],[46297,0,'OFF',0,0,0]],'2026-10',['Alice','Bob']);assert.equal(parsed.days.length,1);assert.equal(parsed.days[0].date,'2026-10-02');
 const unknown=parseSheet([headers,[],[46296,100,200,0,300,300]],'2026-10',['Unknown']);assert.equal(unknown.error,undefined);assert.deepEqual(unknown.names,[]);assert.equal(unknown.days[0].group,300);
 const partial=parseSheet([headers,[],[46296,100,null,0,100,100]],'2026-10',['Alice','Bob']);assert.equal(partial.days[0].provided.Alice,true);assert.equal(partial.days[0].provided.Bob,false);
});
test('profiles match explicit group names and DPM alias, not arbitrary partial strings',()=>{
 const profiles=[{_id:'g',name:'HT - DPM'},{_id:'a',name:'HT - AURA'}];assert.equal(matchingProfile(profiles,'DPM')._id,'g');assert.equal(matchingProfile(profiles,'AURA')._id,'a');assert.equal(matchingProfile(profiles,'AU'),null);
});
test('verified production group display aliases map without fuzzy matching',()=>{
 const profiles=[{_id:'x',name:'HT - LEVELX'},{_id:'d',name:'HT - DPM ( tuyen thanh vien )'},{_id:'v',name:'HT-VELIX🏖️ [TUYỂN THÀNH VIÊN]'}];
 assert.equal(matchingProfile(profiles,'LEVEL X')._id,'x');assert.equal(matchingProfile(profiles,'DPM')._id,'d');assert.equal(matchingProfile(profiles,'VELIX')._id,'v');
 assert.equal(matchingProfile([...profiles,{_id:'duplicate',name:'HT - LEVEL X'}],'LEVEL X'),null);
 assert.equal(matchingProfile([{name:'HT - LEVELX fake'}],'LEVEL X'),null);
});
test('night shifts after midnight belong to the previous 06:00 workday, like the sheets',()=>{
 const sessions=[{_id:'night',profileId:'g',createdAt:new Date('2026-10-02T01:00:00+07:00')}];
 assert.equal(comparableDay('2026-10-01','g',sessions,new Set(['night']),new Set()),true);
 assert.equal(comparableDay('2026-10-02','g',sessions,new Set(['night']),new Set()),false);
});
test('sheet nicknames match profile names without emoji or decorations',()=>{
 const head=['Date','Lapin','Wina','Katie','Zelzi','Chan','Ariel','Chung','TỔNG','TOTAL'];
 const cols=Object.fromEntries(talentColumns(head,['Lapin 🐰','Wina here 🐱','🎀 Hello Katie','ᴸᵘᶜᵏʸ ZELzii','Chanana🐲✨','Aliz🤍']).map(c=>[c.name,c.index]));
 assert.deepEqual(cols,{'Lapin 🐰':1,'Wina here 🐱':2,'🎀 Hello Katie':3,'ᴸᵘᶜᵏʸ ZELzii':4,'Chanana🐲✨':5,'Aliz🤍':-1});
 assert.deepEqual(talentColumns(['Date','Chan'],['Chanana','Chanee']).map(c=>c.index),[-1,-1],'an ambiguous column is not guessed');
});
test('a stray row from another month and text in a score cell do not drop the whole sheet',()=>{
 const parsed=parseSheet([headers,[],['2026-09-30',5,5,0,10,10],[46296,100,'11,5',0,300,300]],'2026-10',['Alice','Bob']);
 assert.equal(parsed.error,undefined);assert.equal(parsed.days.length,1);assert.equal(parsed.days[0].provided.Alice,true);assert.equal(parsed.days[0].provided.Bob,false);
});
test('unreadable sheets are surfaced as a board alert; normal waiting states are not',()=>{
 assert.equal(N.sheetProblems({state:'pending'}),null);
 assert.equal(N.sheetProblems({state:'checked',sources:[{group:'A',state:'checked'},{group:'B',state:'awaiting_verified_closed_sessions'},{group:'C',state:'checked_group_only'}]}),null);
 assert.equal(N.sheetProblems({state:'disconnected'}).all,true);
 assert.deepEqual(N.sheetProblems({state:'checked',sources:[{group:'A',state:'reconnect_required'},{group:'B',state:'checked'}]}).failed.map(s=>s.group),['A']);
});
test('a row with talent scores but blank totals still counts toward the group',()=>{
 const parsed=parseSheet([headers,[],[46296,100,200,0,300,300],[null,40,60,null,null,null]],'2026-10',['Alice','Bob']);
 assert.equal(parsed.days[0].group,400);assert.equal(parsed.days[0].individual.Alice,140);
});
