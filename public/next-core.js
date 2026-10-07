(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./leaderboard-core'));else{const previous=root.HeliosCore;root.HeliosNext=factory(previous);root.HeliosCore={...previous,defaults:root.HeliosNext.normalize({}),normalize:root.HeliosNext.normalize,migrate:x=>root.HeliosNext.migrate(null,previous.migrate(x)),selectRows:root.HeliosNext.selectRows}}})(typeof globalThis==='object'?globalThis:this,function(C){
 'use strict';
 function normalize(raw={}){return{...C.normalize({resetHour:6,freezeUntil:'',...raw}),layout:['classic','studio','podium'].includes(raw.layout)?raw.layout:'podium',appearanceVersion:1,showDaily:typeof raw.showDaily==='boolean'?raw.showDaily:true,dailyMode:raw.dailyMode==='yesterday'?'yesterday':'daily'}}
 function migrate(saved,legacy){return normalize(saved?{...saved,layout:saved.appearanceVersion===1?saved.layout:'podium'}:{...(legacy||{language:'vi'}),layout:'podium',resetHour:6,freezeUntil:''})}
 function warningFor(data,kind,period,row){return(data?.reconciliation?.warnings||[]).find(w=>w.kind===kind&&w.period===period&&String(w.groupId)===String(row.groupId)&&w.name===row.name)||null}
 function panels(raw,config,history){const selected=config.lastMonth?'history':config.dailyMode;return[
  {key:'top-daily-group',kind:'group',period:config.dailyMode,rows:raw?.group?.[config.dailyMode],limit:config.layout==='podium'?11:10},
  {key:'top-daily-individual',kind:'individual',period:config.dailyMode,rows:raw?.individual?.[config.dailyMode],limit:config.layout==='podium'?11:10},
  {key:'top-monthly-group',kind:'group',period:'monthly',rows:raw?.group?.monthly,limit:config.layout==='podium'?11:10},
  {key:'top-monthly-individual',kind:'individual',period:'monthly',rows:raw?.individual?.monthly,limit:config.layout==='podium'?11:10},
  {key:'monthly-ranking',kind:'individual',period:'monthly',rows:raw?.individual?.monthly,limit:Infinity},
  {key:'side-talents',kind:'individual',period:selected,rows:config.lastMonth?history?.data?.individual:raw?.individual?.[selected],limit:Infinity},
  {key:'side-groups',kind:'group',period:selected,rows:config.lastMonth?history?.data?.group:raw?.group?.[selected],limit:Infinity}
 ].map(p=>({...p,rows:C.filtered(p.rows,config,raw?.locations||[]).filter(row=>p.kind!=='individual'||config.talents[row.name]!==false).slice(0,p.limit)}))}
 function isLive(row,now=Date.now()){return row?.live===true&&Number.isFinite(Date.parse(row.liveExpiresAt))&&Date.parse(row.liveExpiresAt)>now}
 function selectRows(raw,config,index,history,yesterday=false){
  if(index<5)return C.selectRows(raw,config,index,history,yesterday);
  const kind=index===5?'individual':'group',rows=config.lastMonth?history?.[kind]:raw?.[kind]?.[yesterday?'yesterday':'daily'];
  return C.filtered(rows,config,raw?.locations||[]).filter(e=>kind!=='individual'||config.talents[e.name]!==false);
 }
 return{normalize,migrate,panels,warningFor,isLive,selectRows};
});
/* Original UI and Settings are reused, with only feature-specific row decorations. */
if(typeof window==='object'){
 const N=window.HeliosNext,text=(config,vi,en)=>config.language==='vi'?vi:en;
 N.decorateRow=(row,avatar,name,entry,column,raw,config)=>{
  if(!(column>=5&&config.lastMonth)&&N.isLive(entry)){
   avatar.classList.add('live');avatar.title=text(config,'Đang live qua HeliosControl','Live through HeliosControl');
   const bars=document.createElement('span');bars.className='equalizer';bars.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)bars.append(document.createElement('i'));avatar.append(bars);
  }
  const kind=[0,2,6].includes(column)?'group':'individual',period=column>=5&&config.lastMonth?'history':[2,3,4].includes(column)?'monthly':'daily',warning=N.warningFor(raw,kind,period,entry);
  if(warning){const b=document.createElement('button');b.className='warning';b.textContent='!';b.setAttribute('aria-label',text(config,'Chênh lệch điểm so với sheet','Score differs from sheet')+' · '+entry.name);b.onclick=()=>N.showWarning(warning,config);name.parentElement.classList.add('has-warning');name.after(b)}
 };
 N.showWarning=(warning,config)=>{
  const d=document.getElementById('warning-dialog');document.getElementById('warning-title').textContent=text(config,'Chênh lệch điểm so với sheet','Score differs from sheet');document.getElementById('warning-name').textContent=warning.name+' · '+text(config,'Cùng ngày đã điền điểm và phiên hoàn tất, không phải tổng live chưa chốt.','Same filled days and completed sessions; not the unclosed live total.');
  const list=document.getElementById('warning-details');list.replaceChildren();for(const [label,value]of [[text(config,'Hệ thống','System'),warning.backend],[text(config,'Sheet','Sheet'),warning.sheet],[text(config,'Chênh lệch','Difference'),warning.delta],[text(config,'Ngày đối soát','Compared dates'),warning.dates.join(', ')],[text(config,'Kiểm tra lúc','Checked at'),new Date(warning.checkedAt).toLocaleString()]]){
   const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=typeof value==='number'?window.HeliosCore.formatPoints(value):value;list.append(dt,dd);
  }
  const link=document.getElementById('warning-sheet');link.href=warning.sheetUrl;link.textContent=text(config,'Mở sheet nguồn','Open source sheet');d.showModal();
 };
 document.addEventListener('keydown',e=>{const d=document.getElementById('warning-dialog');if(!d?.open)return;if(e.key==='Escape'||e.key==='BrowserBack'){e.preventDefault();d.close()}else if(e.key!=='Tab')e.stopImmediatePropagation()},true);
 N.translateExtras=(config,raw,history,yesterday)=>{
  const daily=yesterday||raw?.frozen,period=config.lastMonth?text(config,'Tháng trước','Last Month'):text(config,daily?'Hôm qua':'Hôm nay',daily?'Yesterday':'Today');
  for(const [index,kind]of [[5,text(config,'Talent','Talents')],[6,text(config,'Nhóm','Groups')]])document.querySelector('[data-column="'+index+'"] .board-head b').textContent=period+' · '+kind;
  const show=document.getElementById('show-daily-label');if(show?.firstChild)show.firstChild.nodeValue=text(config,'Hiển thị cột Today','Show Today ranking');
  document.getElementById('old-board').textContent=text(config,'Mở bảng xếp hạng cũ','Open old leaderboard');
  const check=raw?.reconciliation,issues=(check?.sources||[]).filter(s=>s.state!=='checked');
  const status=document.getElementById('sheet-status');
  status.textContent=check?.state==='checked'?text(config,'Sheets: chỉ đối soát phiên hoàn tất và ngày đã điền điểm.','Sheets: only verified closed sessions and filled days.'):check?.state==='pending'?text(config,'Sheets: đang kiểm tra…','Sheets: checking…'):text(config,'Sheets: chưa kết nối hoặc tạm không đọc được.','Sheets: disconnected or temporarily unavailable.');
  status.title=issues.map(s=>s.group+' ('+s.state+')').join(' · ');
 };
}

