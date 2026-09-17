'use strict';
const C=window.HeliosCore;
const stage=document.querySelector('.tv'),grid=document.querySelector('.boards-zone');
const boards=[...document.querySelectorAll('.board')],sixth=boards[5];
const dialog=document.getElementById('settings-dialog'),gear=document.getElementById('settings-open');
const message=document.querySelector('.toast');let toastTimer;
function notify(text){message.textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>message.textContent='',5000)}
const storageKey='helios_leaderboard_v2';
let saved=null,config=C.normalize({});
function readStored(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch(e){notify('Saved settings could not be read. Using initial settings.');return null}}
saved=readStored(storageKey+'_default');
const stored=readStored(storageKey+'_current');
config=stored?C.normalize(stored):saved?C.normalize(saved):C.migrate(readStored('leaderboard_config'));
const defaults=C.clone(C.defaults);
function persist(){try{localStorage.setItem(storageKey+'_current',JSON.stringify(config))}catch(e){notify('Storage unavailable. Changes apply for this session only.')}}
let rawData=null,historyPayload=null,allLocations=[],allGroups=[],dailyHistory=false,unfreezeUntil=0;
let dataError=false;const manualPending=new Map(),manualEpoch=new Map();
const columnData=Array(6).fill(null),columnVersion=Array(6).fill(0),rowSignatures=Array(6).fill('');
const columnMeta=Array(5).fill(null);
let scrollAnimations=[],tickerAnimation,tickerMessage='',lastContext='',historyMonth='',historyRequest=0,requestCounter=0,liveInFlight=new Map(),lastMotion='',lastTickerSpeed=0;
const configInputs=[...dialog.querySelectorAll('[data-config]')],scoreInputs=[...dialog.querySelectorAll('[data-score]')];
const camera=document.querySelector('.camera-notice');
camera.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/><path d="M2 2l20 20"/></svg>';
camera.append(document.createTextNode('NO PHOTOS OR VIDEOS ALLOWED'));
function syncInputs(){document.getElementById('quick-lastmonth').setAttribute('aria-pressed',String(config.lastMonth));configInputs.forEach(e=>{const value=config[e.dataset.config];if(e.type==='checkbox')e.checked=Boolean(value);else if(e!==document.activeElement)e.value=value});scoreInputs.forEach(e=>e.checked=config.scores[+e.dataset.score])}
function safeAvatar(value){if(typeof value!=='string')return '';if(value.startsWith('userdata/avatars/')||value.startsWith('avatars/'))value='/'+value;if(value.startsWith('/userdata/avatars/')||value.startsWith('/avatars/'))return value;try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
function makeRow(entry,index,column){
 const row=document.createElement('div');row.className='row'+(index<3?' top'+(index+1):'');
 const rank=document.createElement('i');rank.className='rank';rank.textContent=index+1;
 const avatar=document.createElement('i');avatar.className='avatar';avatar.textContent=entry.name.charAt(0).toUpperCase();
 const src=safeAvatar(entry.avatar);if(src){const img=document.createElement('img');img.alt='';img.src=src;img.decoding='async';img.onerror=()=>{avatar.textContent=entry.name.charAt(0).toUpperCase()};avatar.replaceChildren(img)}
 const identity=document.createElement('div');identity.className='identity';
 const name=document.createElement('div');name.className='name';name.textContent=entry.name;name.title=entry.name;
 const points=document.createElement('div');points.className='points';points.textContent=C.formatPoints(entry.value);
 identity.append(name,points);
 const showComparison=(column===0&&config.yesterdayGroups)||(column===1&&config.yesterdayIdols);
 if(!dailyHistory&&showComparison&&entry.yesterday&&Number.isFinite(Number(entry.yesterday.value))){
  const hint=document.createElement('div');hint.className='yesterday';hint.textContent='Yesterday: '+C.formatPoints(entry.yesterday.value);identity.append(hint);
 }
 row.append(rank,avatar,identity);return row;
}
function renderRows(index){
 const source=columnData[index],rows=C.selectRows(source,config,index,historyPayload?.data,dailyHistory);
 const ready=index===5?Boolean(historyPayload):Boolean(source);
 const signature=JSON.stringify([rows,ready,dailyHistory,config.yesterdayGroups,config.yesterdayIdols]);if(signature===rowSignatures[index])return false;
 rowSignatures[index]=signature;const list=boards[index].querySelector('.list');const wrapper=index>=4?document.createElement('div'):list;
 list.replaceChildren();if(index>=4){wrapper.className='all-track';list.append(wrapper)}
 if(!rows.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent=ready?'No entries for this selection':'Waiting for data…';list.replaceChildren(empty)}
 else rows.forEach((entry,i)=>wrapper.append(makeRow(entry,i,index)));
 return true;
}
function setupScroll(){
 const previous=new Map(scrollAnimations.map(a=>[a.column,{progress:(Number(a.currentTime)||0)/a.effect.getTiming().duration}]));
 scrollAnimations.forEach(a=>a.cancel());scrollAnimations=[];
 stage.style.setProperty('--row-height',boards[0].querySelector('.list').clientHeight/10+'px');
 for(const index of [4,5]){if(boards[index].hidden)continue;const viewport=boards[index].querySelector('.list'),track=viewport.querySelector('.all-track');if(!track||typeof track.animate!=='function')continue;
  const motion=C.scrollFrames(track.scrollHeight-viewport.clientHeight,config.speed*innerHeight/1080,config.pause);if(!motion)continue;
  const animation=track.animate(motion.frames,{duration:motion.duration,iterations:Infinity,easing:'linear'});animation.column=index;
  if(previous.has(index))animation.currentTime=(previous.get(index).progress%1)*motion.duration;
  if(!dialog.hidden)animation.pause();scrollAnimations.push(animation);
 }
}
const ticker=document.querySelector('.ticker-line');
function buildTicker(){
 const leaders=C.filtered(rawData?.group?.daily,config,allLocations).filter(e=>e.value>=100000).slice(0,5);
 return leaders.length?leaders.map(e=>'CONGRATULATIONS TO '+e.name+' ON REACHING '+C.formatPoints(Math.floor(e.value/100000)*100000)+' POINTS').join('   ·   '):'HELIOS TALENT · KEEP SHINING · LIVE PERFORMANCE';
}
function setupTicker(){
 if(tickerAnimation)tickerAnimation.cancel();ticker.textContent=tickerMessage;
 if(ticker.scrollWidth<=ticker.parentElement.clientWidth||!ticker.animate)return;
 const span=document.createElement('span');span.textContent=tickerMessage+'   ·   ';span.style.display='inline-block';span.style.paddingRight='40px';ticker.replaceChildren(span);
 const duplicate=span.cloneNode(true);duplicate.setAttribute('aria-hidden','true');ticker.append(duplicate);
 const distance=span.getBoundingClientRect().width;tickerAnimation=ticker.animate([{transform:'translateX(0)'},{transform:'translateX(-'+distance+'px)'}],{duration:distance/(config.tickerSpeed*innerWidth/1920)*1000,iterations:Infinity,easing:'linear'});
 if(!dialog.hidden)tickerAnimation.pause();
}
function renderSummary(){
 document.querySelector('.kpi b').textContent=rawData?C.formatPoints(C.total(rawData,config,dailyHistory)):'—';
 const totalYesterday=dailyHistory||rawData?.frozen;
 document.querySelector('.kpi span').textContent=totalYesterday?"Yesterday's Total Points":"Today's Total Points";
 document.querySelector('.kpi').title='Sum of group points for selected locations/groups; idols are not added again.';
 const groupsYesterday=dailyHistory||columnData[0]?.frozen,idolsYesterday=dailyHistory||columnData[1]?.frozen;
 boards[0].querySelector('.board-head b').textContent=groupsYesterday?'Yesterday Top Groups':'Daily Top Groups';boards[1].querySelector('.board-head b').textContent=idolsYesterday?'Yesterday Top Idols':'Daily Top Idols';
 const p=historyPayload?.period,historyHead=boards[5].querySelector('.board-head');historyHead.querySelector('b').title=p?'Last Month · '+p.month+(p.complete?'':' · Provisional until 07:00'):'Last Month Ranking';
 let period=historyHead.querySelector('.history-period');if(!period){period=document.createElement('span');period.className='history-period';historyHead.append(period)}
 period.textContent=p?p.month+' · '+(p.complete?'CLOSED':'PROVISIONAL'):'';
 document.getElementById('history-note').textContent=p?'Last month: '+p.month+' · '+(p.complete?'Closed snapshot':'Provisional until 07:00 on day 1')+' · '+historyPayload.source:'Last month: not loaded yet.';
 const dailySnapshots=[columnData[0],columnData[1]].filter(Boolean),frozenDaily=dailySnapshots.filter(data=>data.frozen).length;
 const scoreStatus=dailyHistory?'YESTERDAY':frozenDaily&&frozenDaily===dailySnapshots.length&&rawData?.frozen?'FROZEN · YESTERDAY':frozenDaily||rawData?.frozen?'MIXED · RETAINED FROZEN DAILY':'LIVE SCORES';
 document.getElementById('data-status').textContent=rawData?' · '+scoreStatus+(rawData.monthlyGrace?' · MONTHLY GRACE':''):' · Waiting for data';
 const next=buildTicker();if(next!==tickerMessage){tickerMessage=next;setupTicker()}
}
function apply(){
 config=C.normalize(config);boards.forEach((b,i)=>b.classList.toggle('hide-points',i<5&&!config.scores[i]));
 const changedLayout=sixth.hidden===config.lastMonth;sixth.hidden=!config.lastMonth;stage.classList.toggle('six',config.lastMonth);grid.style.setProperty('--columns',config.lastMonth?6:5);
 document.querySelector('.kpi').classList.toggle('hide-total',!config.total);
 let changed=false;boards.forEach((b,i)=>{changed=renderRows(i)||changed});const motion=config.speed+'|'+config.pause;if(changed||changedLayout||motion!==lastMotion)setupScroll();lastMotion=motion;renderSummary();if(lastTickerSpeed!==config.tickerSpeed)setupTicker();lastTickerSpeed=config.tickerSpeed;syncInputs();persist();
 const context=requestContext();if(context!==lastContext){lastContext=context;loadCurrent([0,1,2,3,4])}
 if(config.lastMonth)loadHistory(false);
}
function requestContext(){return new URLSearchParams({resetHour:String(config.resetHour),freezeUntil:Date.now()<unfreezeUntil?'':config.freezeUntil}).toString()}
// Real monthly aggregation can take several minutes over the remote database link.
// Keep the shared in-flight request alive instead of repeatedly aborting/retrying it.
async function fetchJSON(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),600000);try{const response=await fetch(url,{signal:controller.signal,cache:'no-store'});const payload=await response.json();if(!response.ok||payload.status!=='ok'||!payload.data)throw Error(payload.message||'Data unavailable');return payload}finally{clearTimeout(timer)}}
function connection(text){document.getElementById('connection').textContent=text}
function visibleMetadata(){
 const entries=columnMeta.filter((_,i)=>Boolean(columnData[i])),knownSources=new Set(['computed','cache','snapshot']);
 const fingerprint=meta=>meta?JSON.stringify([meta.source||'',meta.stale===true,meta.computedAt||'',meta.contextKey||'']):'unknown';
 const times=entries.map(meta=>meta?.computedAt).filter(value=>value!==null&&value!==undefined&&value!=='').map(value=>new Date(value).getTime()).filter(Number.isFinite);
 return{entries,mixed:new Set(entries.map(fingerprint)).size>1,cached:entries.some(meta=>meta?.source==='cache'||meta?.source==='snapshot'),stale:entries.some(meta=>meta?.stale===true),allComputed:Boolean(entries.length)&&entries.every(meta=>meta?.source==='computed'),unknown:entries.some(meta=>!knownSources.has(meta?.source)),oldest:times.length?new Date(Math.min(...times)):null};
}
function renderUpdated(meta=visibleMetadata()){
 const label=meta.oldest?'Updated: '+meta.oldest.toLocaleString('en-GB',{timeZone:'Asia/Ho_Chi_Minh'}):'Updated: unknown';
 document.querySelector('.footer>span:last-child').textContent=label+(meta.mixed?' · MIXED':'');
}
function renderConnection(){
 const meta=visibleMetadata();renderUpdated(meta);
 if(dataError){connection(rawData?'OFFLINE · RETAINED':'OFFLINE · NO DATA');return}
 if(!rawData){connection('CONNECTING');return}
 const parts=[];if(meta.mixed)parts.push('MIXED');if(meta.cached)parts.push('CACHED');if(meta.stale)parts.push('STALE','UPDATING');
 if(!parts.length)parts.push(meta.allComputed&&!meta.unknown&&streamConnected?'● LIVE':'● CONNECTED');
 if(!streamConnected)parts.push('RECONNECTING');connection(parts.join(' · '));
}
async function loadCurrent(indices=[0,1,2,3,4],manual=false){
 const context=requestContext();if(!manual&&manualPending.get(context))return;
 if(manual){manualPending.set(context,(manualPending.get(context)||0)+1);manualEpoch.set(context,(manualEpoch.get(context)||0)+1)}
 const epoch=manualEpoch.get(context)||0,key=context+'|'+(manual?'fresh':'current'),request=++requestCounter;indices.forEach(i=>{columnVersion[i]=request;boards[i].classList.add('loading');boards[i].querySelector('.column-refresh')?.setAttribute('disabled','')});
 if(!liveInFlight.has(key)){const promise=fetchJSON('/api/leaderboard/'+(manual?'fresh':'current')+'?'+context).finally(()=>liveInFlight.delete(key));liveInFlight.set(key,promise)}
 try{const result=await liveInFlight.get(key);if(context!==requestContext()||(!manual&&epoch!==(manualEpoch.get(context)||0)))return;
  const accepted=indices.filter(i=>columnVersion[i]===request);if(!accepted.length)return;
  rawData=result.data;dataError=false;allLocations=(rawData.locations||[]).map(l=>({...l,id:String(l.id)}));allGroups=(rawData.groups||[]).map(g=>({...g,id:String(g.id),locationId:String(g.locationId||'')}));
  accepted.forEach(i=>{columnData[i]=rawData;columnMeta[i]=result.meta||null});let changed=false;accepted.forEach(i=>{changed=renderRows(i)||changed});if(changed)setupScroll();renderSummary();renderLocations();syncInputs();
  renderConnection();if(manual)notify(result.meta?.stale===true?'Snapshot refreshed · newer updates pending':'Points refreshed');
 }catch(e){if(context===requestContext()&&(manual||epoch===(manualEpoch.get(context)||0))){dataError=true;renderConnection();if(manual||!rawData)notify('Unable to refresh. Previous data is kept.')}}
 finally{if(manual){const remaining=(manualPending.get(context)||1)-1;if(remaining)manualPending.set(context,remaining);else manualPending.delete(context)}indices.forEach(i=>{if(columnVersion[i]===request){boards[i].classList.remove('loading');boards[i].querySelector('.column-refresh')?.removeAttribute('disabled')}})}
}
let historyInFlight=null;
async function loadHistory(force=false){
 const month=C.historyMonth();if(historyMonth!==month){historyMonth=month;historyPayload=null;historyRequest++;rowSignatures[5]='';renderRows(5);setupScroll()}
 if(historyPayload&&C.historyValid(historyPayload,month)&&!force)return;
 if(historyInFlight?.month===month)return historyInFlight.promise;
 if(!force){const cached=readStored(storageKey+'_history_'+month);if(C.historyValid(cached,month)){historyPayload={...cached,source:'device cache'};renderRows(5);setupScroll();renderSummary();renderTalents();return}}
 const version=++historyRequest;boards[5].classList.add('loading');
 const promise=(async()=>{try{const payload=await fetchJSON('/api/leaderboard/history?month='+month);if(version!==historyRequest||month!==C.historyMonth())return;
   if(payload.period?.month!==month||!Array.isArray(payload.data?.individual)||!Array.isArray(payload.data?.group))throw Error('Invalid history');
   historyPayload=payload;columnData[5]=rawData;if(C.historyValid(payload,month)){try{localStorage.setItem(storageKey+'_history_'+month,JSON.stringify(payload))}catch{notify('Month loaded; device cache could not be saved.')}}
   renderRows(5);setupScroll();renderSummary();renderTalents();if(force)notify('Last month snapshot refreshed');
  }catch(e){if(version===historyRequest)notify('Unable to load last month. Existing snapshot is kept.')}
  finally{if(version===historyRequest)boards[5].classList.remove('loading');if(historyInFlight?.version===version)historyInFlight=null}
 })();historyInFlight={month,version,promise};return promise;
}
function refreshColumn(index){return index===5?loadHistory(true):loadCurrent([index],true)}
function refreshAll(){return Promise.all([loadCurrent([0,1,2,3,4],true),...(config.lastMonth?[loadHistory(true)]:[])])}
let page=0,selectedLocation='';
function renderLocations(){
 const select=document.getElementById('location-choice');const locations=allLocations.length?allLocations:[{id:'',name:'All / unassigned'}];
 if(!locations.some(l=>l.id===selectedLocation))selectedLocation=locations.find(l=>config.locations[l.id])?.id||locations[0].id;
 const signature=JSON.stringify(locations);if(select.dataset.signature!==signature){select.replaceChildren();locations.forEach(l=>{const option=document.createElement('option');option.value=l.id;option.textContent=l.name;select.append(option)});select.dataset.signature=signature}
 select.value=selectedLocation;renderGroups();renderTalents();
}
function renderGroups(){
 const groupList=allGroups.filter(g=>g.locationId===selectedLocation),size=innerWidth<700?4:6,total=Math.max(1,Math.ceil(groupList.length/size));page=Math.max(0,Math.min(page,total-1));
 const holder=document.getElementById('location-toggles');let locInput=holder.querySelector('input');if(!locInput){const label=document.createElement('label');label.textContent='Show this location';locInput=document.createElement('input');locInput.type='checkbox';locInput.id='location-visible';label.append(locInput);holder.append(label);locInput.onchange=()=>{if(selectedLocation){config.locations[selectedLocation]=locInput.checked;apply()}}}
 locInput.checked=selectedLocation?config.locations[selectedLocation]===true:true;locInput.disabled=!selectedLocation;
 const container=document.getElementById('group-items');const signature=JSON.stringify([selectedLocation,page,size,groupList.map(g=>[g.id,g.name,config.groups[g.id]!==false])]);
 if(container.dataset.signature!==signature){container.replaceChildren();groupList.slice(page*size,page*size+size).forEach(g=>{const label=document.createElement('label'),span=document.createElement('span'),input=document.createElement('input');span.textContent=g.name;span.title=g.name;input.type='checkbox';input.checked=config.groups[g.id]!==false;input.setAttribute('aria-label',g.name);label.append(span,input);container.append(label);input.onchange=()=>{config.groups[g.id]=input.checked;apply()}});container.dataset.signature=signature}
 document.getElementById('groups-page').textContent=(page+1)+' / '+total;document.getElementById('groups-prev').disabled=page===0;document.getElementById('groups-next').disabled=page>=total-1;
}


let talentPage=0;
function renderTalents(){
 const sources=[rawData,...columnData.slice(0,5)],names=new Set(Object.keys(config.talents||{}));
 for(const source of sources)for(const rows of Object.values(source?.individual||{}))for(const row of rows||[])if(typeof row.name==='string')names.add(row.name);
 for(const row of historyPayload?.data?.individual||[])if(typeof row.name==='string')names.add(row.name);
 const list=[...names].sort((a,b)=>a.localeCompare(b)),size=innerWidth<700?4:6,total=Math.max(1,Math.ceil(list.length/size));talentPage=Math.max(0,Math.min(talentPage,total-1));
 const container=document.getElementById('talent-items'),shown=list.slice(talentPage*size,(talentPage+1)*size),signature=JSON.stringify(shown);
 if(container.dataset.signature!==signature){
  container.replaceChildren();for(const name of shown){const label=document.createElement('label'),span=document.createElement('span'),input=document.createElement('input');span.textContent=name;span.title=name;input.type='checkbox';input.dataset.talent=name;input.setAttribute('aria-label',name);label.append(span,input);container.append(label);
   input.onchange=()=>{config.talents[name]=input.checked;apply();document.getElementById('save-status').textContent='Changes saved on this device'};
  }container.dataset.signature=signature;
 }
 for(const input of container.querySelectorAll('input'))input.checked=config.talents[input.dataset.talent]!==false;
 document.getElementById('talents-page').textContent=(talentPage+1)+' / '+total;
 document.getElementById('talents-prev').disabled=talentPage===0;document.getElementById('talents-next').disabled=talentPage>=total-1;
}
document.getElementById('talents-prev').onclick=()=>{talentPage--;renderTalents();document.querySelector('#talent-items input')?.focus()};
document.getElementById('talents-next').onclick=()=>{talentPage++;renderTalents();document.querySelector('#talent-items input')?.focus()};
function showSettings(){renderTalents();cancelHold();clearTimeout(remoteTimer);dialog.hidden=false;gear.classList.remove('idle');document.querySelector('.quick-toolbar').classList.remove('idle');scrollAnimations.forEach(a=>a.pause());tickerAnimation?.pause();dialog.querySelector('.settings-nav button.active').focus()}
function closeSettings(){finishEdit(false);dialog.hidden=true;scrollAnimations.forEach(a=>a.play());tickerAnimation?.play();stage.tabIndex=-1;stage.focus();revealGear()}
document.getElementById('quick-lastmonth').onclick=()=>{config.lastMonth=!config.lastMonth;apply();revealGear()};
document.getElementById('quick-refresh').onclick=()=>{refreshAll();revealGear()};
gear.onclick=showSettings;['close-settings','done-settings'].forEach(id=>document.getElementById(id).onclick=closeSettings);
function saveDefault(){try{localStorage.setItem(storageKey+'_default',JSON.stringify(config));saved=JSON.parse(JSON.stringify(config));document.getElementById('save-status').textContent='Default saved on this device';notify('Default saved')}catch(e){notify('Storage unavailable. Settings could not be saved.')}}
['save-default','save-default-page'].forEach(id=>document.getElementById(id).onclick=saveDefault);
document.getElementById('restore-default').onclick=()=>{config=C.normalize(saved||defaults);apply();renderLocations();notify('Saved default restored')};
document.getElementById('factory').onclick=()=>{config=C.normalize(defaults);apply();renderLocations();notify('Initial settings applied. Save as Default to keep them.')};
configInputs.forEach(e=>e.onchange=()=>{if(editing===e)return;let value=e.type==='checkbox'?e.checked:e.type==='number'?Number(e.value):e.value;
 if(e.type==='number'){value=Math.max(Number(e.min),Math.min(Number(e.max),value));if(!Number.isFinite(value))return}
 config[e.dataset.config]=value;apply();if(['speed','pause'].includes(e.dataset.config))setupScroll();if(e.dataset.config==='tickerSpeed')setupTicker();document.getElementById('save-status').textContent='Changes saved on this device'});
scoreInputs.forEach(e=>e.onchange=()=>{config.scores[+e.dataset.score]=e.checked;apply();document.getElementById('save-status').textContent='Changes saved on this device'});
function openPage(index){document.querySelectorAll('[data-page]').forEach(e=>e.classList.toggle('active',+e.dataset.page===index));document.querySelectorAll('[data-pane]').forEach(e=>e.classList.toggle('active',+e.dataset.pane===index))}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>openPage(+b.dataset.page));

boards.forEach((b,i)=>{
 const header=b.querySelector('.board-head');header.tabIndex=0;header.setAttribute('role','button');header.setAttribute('aria-label','Show refresh for '+header.textContent);
 const btn=document.createElement('button');btn.className='column-refresh';btn.textContent='↻';btn.setAttribute('aria-label','Refresh '+header.querySelector('b').textContent);
 btn.tabIndex=-1;btn.setAttribute('aria-hidden','true');
 header.append(btn);
 let idleTimer;
 function hideRefresh(){
  clearTimeout(idleTimer);
  if(document.activeElement===btn)header.focus();
  header.classList.remove('reveal');btn.tabIndex=-1;btn.setAttribute('aria-hidden','true');
 }
 function resetRefreshIdle(){clearTimeout(idleTimer);idleTimer=setTimeout(hideRefresh,3000)}
 function showRefresh(){header.classList.add('reveal');btn.tabIndex=0;btn.setAttribute('aria-hidden','false');resetRefreshIdle()}
 header.onclick=e=>{if(e.target.closest('.column-refresh'))return;showRefresh()};
 header.onkeydown=e=>{if(e.target===header&&(e.key==='Enter'||e.key===' ')){e.preventDefault();showRefresh()}};
 ['pointermove','pointerdown','keydown','focusin'].forEach(type=>header.addEventListener(type,()=>{if(header.classList.contains('reveal'))resetRefreshIdle()}));
 btn.onclick=e=>{e.stopPropagation();refreshColumn(i);resetRefreshIdle()};
});

let holdTimer,holdStart,remoteTimer;
function cancelHold(){clearTimeout(holdTimer)}
document.addEventListener('pointerdown',e=>{if(!dialog.hidden||e.button!==0||e.target.closest('button,input,select,[role=button]'))return;holdStart={x:e.clientX,y:e.clientY};holdTimer=setTimeout(showSettings,1200)});
document.addEventListener('pointermove',e=>{if(holdStart&&Math.hypot(e.clientX-holdStart.x,e.clientY-holdStart.y)>12)cancelHold()});
['pointerup','pointercancel'].forEach(type=>document.addEventListener(type,cancelHold));
document.addEventListener('contextmenu',e=>e.preventDefault());

let editing=null,editOriginal=null;
function beginEdit(el){
 editing=el;editOriginal=el.value;el.classList.add('remote-editing');el.focus();
 document.getElementById('save-status').textContent='Editing · OK to apply · Back to cancel';
}
function finishEdit(commit){
 if(!editing)return;
 const el=editing;editing=null;
 if(!commit)el.value=editOriginal;
 el.classList.remove('remote-editing');
 if(commit)el.dispatchEvent(new Event('change',{bubbles:true}));
 document.getElementById('save-status').textContent=commit?'Changes applied':'Edit cancelled';
 el.focus();
}
function navButtons(){return [...dialog.querySelectorAll('.settings-nav button')]}
function pageControls(){return [...dialog.querySelectorAll('.settings-page.active button,.settings-page.active input,.settings-page.active select,.settings-actions button')].filter(el=>el.getClientRects().length&&!el.disabled)}
function modalControls(){return [document.getElementById('close-settings'),...navButtons(),...pageControls()].filter(el=>el.getClientRects().length&&!el.disabled)}
function goSidebar(){const button=dialog.querySelector('.settings-nav button.active');button.focus()}
function goBack(){
 if(editing){finishEdit(false);return}
 if(document.activeElement.closest('.settings-nav'))closeSettings();else goSidebar();
}
dialog.addEventListener('pointerdown',e=>{
 if(editing&&e.target!==editing)finishEdit(true);
 if(e.target.matches('input:not([type=checkbox]),select'))beginEdit(e.target);
});
document.addEventListener('keydown',e=>{
 const ok=e.key==='Enter'||e.key==='Accept'||e.key==='Select'||e.keyCode===23;
 const back=e.key==='Escape'||e.key==='BrowserBack'||e.key==='GoBack'||e.keyCode===10009||e.keyCode===461;
 if(!dialog.hidden){
  if(back){e.preventDefault();goBack();return}
  if(editing){
    if(ok){e.preventDefault();if(!e.repeat)finishEdit(true)}
    else if(e.key==='Tab'){
     e.preventDefault();const current=editing;finishEdit(true);const items=modalControls(),i=items.indexOf(current);
     items[(i+(e.shiftKey?-1:1)+items.length)%items.length].focus();
    }
    return;
  }
  if(!e.repeat&&(e.key==='7'||e.key.toLowerCase()==='s')){e.preventDefault();closeSettings();return}
  if(e.key==='Backspace'){e.preventDefault();goBack();return}
  if(e.key==='Tab'){
    e.preventDefault();const items=modalControls(),i=items.indexOf(document.activeElement);
   items[(i+(e.shiftKey?-1:1)+items.length)%items.length].focus();return;
  }
  const sidebar=document.activeElement.closest('.settings-nav');
  if(sidebar){
   const items=navButtons(),i=items.indexOf(document.activeElement);
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();const next=(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;
    openPage(next);items[next].focus();return;
   }
   if(e.key==='ArrowRight'||ok){e.preventDefault();pageControls()[0]?.focus();return}
   if(e.key==='ArrowLeft'){e.preventDefault();closeSettings();return}
  }else{
   if(e.key==='ArrowLeft'){e.preventDefault();goSidebar();return}
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();const items=pageControls(),i=items.indexOf(document.activeElement);
    items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();return;
   }
   if(ok){
    e.preventDefault();if(e.repeat)return;
    const el=document.activeElement;
    if(el.matches('input[type=checkbox]')){el.checked=!el.checked;el.dispatchEvent(new Event('change',{bubbles:true}))}
    else if(el.matches('input,select'))beginEdit(el);
    else if(el.matches('button'))el.click();
    return;
   }
   if(e.key==='ArrowRight'){e.preventDefault();return}
  }
  return;
 }
 if(ok&&!e.repeat&&!e.target.closest('button,input,select,[role=button]'))remoteTimer=setTimeout(showSettings,1200);
 if(e.repeat)return;
 if(e.key==='7'||e.key.toLowerCase()==='s'){showSettings();return}
 if(/^[1-5]$/.test(e.key)){const i=Number(e.key)-1;config.scores[i]=!config.scores[i];apply()}
 if(e.key==='6'&&!e.shiftKey){config.lastMonth=!config.lastMonth;apply()}
 if(e.key==='8')refreshAll();
 if(e.key==='9'){config.total=!config.total;apply()}
});
let gearTimer;
const quickToolbar=document.querySelector('.quick-toolbar');
function revealGear(){
 gear.classList.remove('idle');quickToolbar.classList.remove('idle');clearTimeout(gearTimer);
 gearTimer=setTimeout(()=>{if(dialog.hidden&&!quickToolbar.contains(document.activeElement))quickToolbar.classList.add('idle')},3000);
}
document.addEventListener('mousemove',revealGear);
document.addEventListener('pointerdown',revealGear);
quickToolbar.addEventListener('focusin',()=>{quickToolbar.classList.remove('idle');clearTimeout(gearTimer)});
quickToolbar.addEventListener('focusout',revealGear);
quickToolbar.addEventListener('click',e=>{if(dialog.hidden&&e.detail>0){stage.tabIndex=-1;stage.focus()}revealGear()});
revealGear();
document.addEventListener('keyup',e=>{if(['Enter','Accept','Select'].includes(e.key)||e.keyCode===23)clearTimeout(remoteTimer)});
window.addEventListener('blur',()=>{cancelHold();clearTimeout(remoteTimer)});
window.addEventListener('resize',()=>{setupScroll();setupTicker();renderGroups();renderTalents()});


document.getElementById('refresh-all').onclick=refreshAll;
document.getElementById('refresh-last').onclick=()=>loadHistory(true);
document.getElementById('daily-history').onclick=()=>{dailyHistory=!dailyHistory;apply();notify(dailyHistory?'Showing yesterday':'Showing current daily scores')};
document.getElementById('unfreeze').onclick=()=>{dailyHistory=false;unfreezeUntil=Date.now()+120000;lastContext='';apply();notify('Live daily scores for 2 minutes')};
document.getElementById('location-choice').onchange=e=>{if(editing===e.target)return;selectedLocation=e.target.value;page=0;renderGroups()};
document.getElementById('groups-prev').onclick=()=>{page--;renderGroups()};
document.getElementById('groups-next').onclick=()=>{page++;renderGroups()};
let streamConnected=false,stream=null,lastStreamFetch=0,streamTimer=null;
function streamInvalidation(){if(Date.now()-lastStreamFetch<10000){if(!streamTimer)streamTimer=setTimeout(()=>{streamTimer=null;streamInvalidation()},10000);return}lastStreamFetch=Date.now();loadCurrent()}
function connectStream(){
 if(!window.EventSource)return;
 stream=new EventSource('/api/leaderboard/stream');
 stream.onopen=()=>{streamConnected=true;renderConnection()};
 stream.onmessage=()=>streamInvalidation();
 stream.onerror=()=>{streamConnected=false;renderConnection()};
}
setInterval(()=>{if(!streamConnected||columnMeta.some(meta=>meta?.stale))loadCurrent();if(unfreezeUntil&&Date.now()>=unfreezeUntil){unfreezeUntil=0;lastContext='';apply()}},10000);
setInterval(()=>{loadCurrent();if(config.lastMonth)loadHistory(false)},60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){loadCurrent();if(config.lastMonth)loadHistory(false)}});
apply();renderLocations();connectStream();
if(window.HeliosWake)window.HeliosWake.start();
