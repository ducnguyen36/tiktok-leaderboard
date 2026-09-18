/* Shared pure data/settings helpers. Works in the browser and node:test. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HeliosCore=factory()})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 // Stable profile ids verified against the live roster: Kayzen and HT-VELORA; TEAM A/B are talents.
 const defaults={schemaVersion:2,language:'en',scores:[true,true,true,true,true],total:true,lastMonth:false,resetHour:0,freezeUntil:'09:00',yesterdayGroups:false,yesterdayIdols:false,speed:60,pause:2,tickerSpeed:165,locations:{loc_hcm:true,loc_quynhon:true},groups:{'1775469403434':false,'1784445344024':false},talents:{'TEAM A':false,'TEAM B':false}};
 const clone=x=>JSON.parse(JSON.stringify(x));
 const bool=(x,d)=>typeof x==='boolean'?x:d;
 const number=(x,d,min,max)=>Number.isFinite(Number(x))&&x!==null&&x!==''?Math.max(min,Math.min(max,Number(x))):d;
 function flags(x,fallback){if(!x||typeof x!=='object'||Array.isArray(x))return clone(fallback);return Object.fromEntries(Object.entries(x).filter(([k,v])=>!['__proto__','constructor','prototype'].includes(k)&&typeof v==='boolean'))}
 function normalize(raw){const x=raw&&typeof raw==='object'?raw:{},c=clone(defaults);
  c.scores=c.scores.map((v,i)=>bool(x.scores?.[i],v));
  for(const key of ['total','lastMonth','yesterdayGroups','yesterdayIdols'])c[key]=bool(x[key],c[key]);
  c.speed=number(x.speed,60,10,150);c.pause=number(x.pause,2,0,10);c.tickerSpeed=number(x.tickerSpeed,165,30,300);c.resetHour=Math.floor(number(x.resetHour,0,0,23));
  c.freezeUntil=x.freezeUntil===''||/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x.freezeUntil)?x.freezeUntil:defaults.freezeUntil;
  c.language=x.language==='vi'?'vi':'en';c.layout=['studio','podium'].includes(x.layout)?x.layout:'classic';
  c.rankOrder=x.rankOrder==='horizontal'?'horizontal':'vertical';
  c.celebrationSound=bool(x.celebrationSound,true);
  c.locations=flags(x.locations,defaults.locations);c.groups={...defaults.groups,...flags(x.groups,{})};c.talents={...defaults.talents,...flags(x.talents,{})};return c;
 }
 function migrate(x){if(!x||typeof x!=='object')return normalize({});return normalize({scores:['group-daily','individual-daily','group-monthly','individual-monthly','individual-monthly'].map(k=>x.showIncome?.[k]),total:x.total,resetHour:x.resetHour,freezeUntil:x.freezeUntil,yesterdayGroups:x.showYesterday?.['group-daily'],yesterdayIdols:x.showYesterday?.['individual-daily'],locations:x.visibleLocations,groups:x.visibleGroups,lastMonth:false})}
 function filtered(rows,c,locations=[]){return (Array.isArray(rows)?rows:[]).filter(e=>{
  if(!e||typeof e.name!=='string'||!Number.isFinite(Number(e.value)))return false;
  if(e.groupId&&c.groups[String(e.groupId)]===false)return false;
  if(locations.length||Object.keys(c.locations).length)return c.locations[String(e.locationId||'')]===true;
  return true;
 }).slice().sort((a,b)=>Number(b.value)-Number(a.value)||a.name.localeCompare(b.name));}
 const mapping=[['group','daily'],['individual','daily'],['group','monthly'],['individual','monthly'],['individual','monthly']];
 function selectRows(raw,c,index,history=null,yesterday=false){const [kind,period]=mapping[index]||['individual','history'];const rows=index===5?history?.individual:raw?.[kind]?.[yesterday&&index<2?'yesterday':period];const result=filtered(rows,c,raw?.locations||[]).filter(e=>kind!=='individual'||c.talents?.[e.name]!==false);return index<4?result.slice(0,c.layout==='podium'?11:10):result}
 function total(raw,c,yesterday=false){return filtered(raw?.group?.[yesterday?'yesterday':'daily'],c,raw?.locations||[]).reduce((sum,e)=>sum+Number(e.value),0)}
 function formatPoints(n){return Math.ceil(Number(n)||0).toLocaleString('en-US')}
 function historyMonth(date=new Date()){const vn=new Date(date.getTime()+7*3600000);const prev=new Date(Date.UTC(vn.getUTCFullYear(),vn.getUTCMonth()-1,1));return prev.toISOString().slice(0,7)}
 function historyValid(h,month){if(!h||h.aggregationVersion!==2||h.period?.month!==month||h.period.complete!==true||!Array.isArray(h.data?.individual)||!Array.isArray(h.data?.group)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return false;const [y,m]=month.split('-').map(Number);return h.period.start===new Date(Date.UTC(y,m-1,1)).toISOString()&&h.period.end===new Date(Date.UTC(y,m,1)).toISOString()}
 function scrollFrames(overflow,speed,pause){if(overflow<=1)return null;const travel=overflow/speed*1000,p= pause*1000,duration=2*(travel+p);return{duration,frames:[{transform:'translateY(0px)',offset:0},{transform:'translateY(0px)',offset:p/duration},{transform:`translateY(-${overflow}px)`,offset:(p+travel)/duration},{transform:`translateY(-${overflow}px)`,offset:(2*p+travel)/duration},{transform:'translateY(0px)',offset:1}]}}
 return{defaults,clone,normalize,migrate,filtered,selectRows,total,formatPoints,historyMonth,historyValid,scrollFrames};
});
