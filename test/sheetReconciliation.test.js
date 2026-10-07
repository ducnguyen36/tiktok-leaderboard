const test=require('node:test'),assert=require('node:assert/strict');
const {sheetDate,parseSheet,discrepancy,matchingProfile}=require('../sheetReconciliation');
const headers=['Date','Alice','Bob','Chung','TỔNG','TOTAL'];
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
 assert.equal(parseSheet([headers,[],[46296,100,200,0,300,300]],'2026-10',['Unknown']).error,'talent_names_unmatched');
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
