(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./leaderboard-core'));else root.HeliosNext=factory(root.HeliosCore)})(typeof globalThis==='object'?globalThis:this,function(C){
 'use strict';
 function normalize(raw={}){return{...C.normalize(raw),resetHour:6,freezeUntil:'',showDaily:typeof raw.showDaily==='boolean'?raw.showDaily:true,dailyMode:raw.dailyMode==='yesterday'?'yesterday':'daily'}}
 function warningFor(data,kind,period,row){return(data?.reconciliation?.warnings||[]).find(w=>w.kind===kind&&w.period===period&&String(w.groupId)===String(row.groupId)&&w.name===row.name)||null}
 function panels(raw,config,history){const selected=config.lastMonth?'history':config.dailyMode;return[
  {key:'top-daily-group',kind:'group',period:config.dailyMode,rows:raw?.group?.[config.dailyMode],limit:10},
  {key:'top-daily-individual',kind:'individual',period:config.dailyMode,rows:raw?.individual?.[config.dailyMode],limit:10},
  {key:'top-monthly-group',kind:'group',period:'monthly',rows:raw?.group?.monthly,limit:10},
  {key:'top-monthly-individual',kind:'individual',period:'monthly',rows:raw?.individual?.monthly,limit:10},
  {key:'monthly-ranking',kind:'individual',period:'monthly',rows:raw?.individual?.monthly,limit:Infinity},
  {key:'side-talents',kind:'individual',period:selected,rows:config.lastMonth?history?.data?.individual:raw?.individual?.[selected],limit:Infinity},
  {key:'side-groups',kind:'group',period:selected,rows:config.lastMonth?history?.data?.group:raw?.group?.[selected],limit:Infinity}
 ].map(p=>({...p,rows:C.filtered(p.rows,config,raw?.locations||[]).filter(row=>p.kind!=='individual'||config.talents[row.name]!==false).slice(0,p.limit)}))}
 function isLive(row,now=Date.now()){return row?.live===true&&Number.isFinite(Date.parse(row.liveExpiresAt))&&Date.parse(row.liveExpiresAt)>now}
 return{normalize,panels,warningFor,isLive};
});
