'use strict';
const C=window.HeliosCore,I=window.HeliosI18n;
const stage=document.querySelector('.tv'),grid=document.querySelector('.boards-zone');
const boards=[...document.querySelectorAll('.board')],sixth=boards[5];
const dialog=document.getElementById('settings-dialog'),gear=document.getElementById('settings-open');
const mobileTabs=document.querySelector('.mobile-board-tabs');
const mobileQuery=matchMedia('(max-width: 767px), (max-width: 950px) and (max-height: 500px)');
const message=document.querySelector('.toast');let toastTimer;
function notify(text){message.textContent=text;clearTimeout(toastTimer);toastTimer=setTimeout(()=>message.textContent='',5000)}
const storageKey='helios_leaderboard_v2';
let saved=null,config=C.normalize({});
const t=(key,vars)=>I.t(config.language,key,vars);
function readStored(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch(e){notify(t('toast.readSettings'));return null}}
saved=readStored(storageKey+'_default');
const stored=readStored(storageKey+'_current');
config=stored?C.normalize(stored):saved?C.normalize(saved):C.migrate(readStored('leaderboard_config'));
const defaults=C.clone(C.defaults);
function persist(){try{localStorage.setItem(storageKey+'_current',JSON.stringify(config))}catch(e){notify(t('toast.storageSession'))}}
let rawData=null,historyPayload=null,allLocations=[],allGroups=[],dailyHistory=false,unfreezeUntil=0;
let dataError=false;const manualPending=new Map(),manualEpoch=new Map();
const columnData=Array(6).fill(null),columnVersion=Array(6).fill(0),rowSignatures=Array(6).fill('');
const columnMeta=Array(5).fill(null);
let scrollAnimations=[],tickerAnimation,tickerMessage='',lastContext='',historyMonth='',historyRequest=0,requestCounter=0,liveInFlight=new Map(),lastMotion='',lastTickerSpeed=0;
let selectedMobileColumn=0;
const configInputs=[...dialog.querySelectorAll('[data-config]')],scoreInputs=[...dialog.querySelectorAll('[data-score]')];
const camera=document.querySelector('.camera-notice');
camera.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/><path d="M2 2l20 20"/></svg>';
const cameraText=document.createTextNode('');camera.append(cameraText);
function translateUI(){
 cameraText.nodeValue=t('camera');
 boards.forEach(board=>{const header=board.querySelector('.board-head'),button=header.querySelector('.column-refresh'),name=header.querySelector('b').textContent;header.setAttribute('aria-label',t('actions.showRefresh',{name}));if(button)button.setAttribute('aria-label',t('actions.refresh',{name}))});
}
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
  const hint=document.createElement('div');hint.className='yesterday';hint.textContent=t('row.yesterday',{points:C.formatPoints(entry.yesterday.value)});identity.append(hint);
 }
 row.append(rank,avatar,identity);return row;
}
function renderRows(index){
 const source=columnData[index],rows=C.selectRows(source,config,index,historyPayload?.data,dailyHistory);
 const ready=index===5?Boolean(historyPayload):Boolean(source);
 const signature=JSON.stringify([rows,ready,dailyHistory,config.yesterdayGroups,config.yesterdayIdols,config.language]);if(signature===rowSignatures[index])return false;
 rowSignatures[index]=signature;const list=boards[index].querySelector('.list');const wrapper=index>=4?document.createElement('div'):list;
 list.replaceChildren();if(index>=4){wrapper.className='all-track';list.append(wrapper)}
 if(!rows.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent=t(ready?'row.empty':'row.waiting');list.replaceChildren(empty)}
 else rows.forEach((entry,i)=>wrapper.append(makeRow(entry,i,index)));
 return true;
}
const mobileButtons=boards.map((board,index)=>{
 board.id='leaderboard-panel-'+index;
 const button=document.createElement('button');button.type='button';button.id='leaderboard-tab-'+index;button.setAttribute('role','tab');button.setAttribute('aria-controls',board.id);
 button.onclick=()=>selectMobileBoard(index,true);
 button.onkeydown=event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const available=config.lastMonth?6:5;
  const next=event.key==='Home'?0:event.key==='End'?available-1:(index+(event.key==='ArrowRight'?1:-1)+available)%available;
  selectMobileBoard(next,true);mobileButtons[next].focus();
 };
 return button;
});
function isMobileLayout(){return mobileQuery.matches}
function selectMobileBoard(index,scrollToTop=false){
 const available=config.lastMonth?6:5;selectedMobileColumn=Math.max(0,Math.min(index,available-1));syncMobileLayout();
 if(scrollToTop)requestAnimationFrame(()=>{const tabsBottom=mobileTabs.getBoundingClientRect().bottom,boardTop=boards[selectedMobileColumn].getBoundingClientRect().top;scrollBy({top:boardTop-tabsBottom,behavior:'instant'})});
}
function syncMobileLayout(){
 syncBannerPlacement();
 const mobile=isMobileLayout(),available=config.lastMonth?6:5;
 if(selectedMobileColumn>=available)selectedMobileColumn=available-1;
 const desired=mobileButtons.slice(0,available),current=[...mobileTabs.children];mobileTabs.hidden=!mobile;
 if(current.length!==desired.length||current.some((button,index)=>button!==desired[index]))mobileTabs.replaceChildren(...desired);
 mobileButtons.slice(0,available).forEach((button,index)=>{
  const label=boards[index].querySelector('.board-head b').textContent;button.textContent=label;button.setAttribute('aria-label',label);
  button.setAttribute('aria-selected',String(index===selectedMobileColumn));button.tabIndex=index===selectedMobileColumn?0:-1;
 });
 boards.forEach((board,index)=>{
  const mobileHidden=mobile&&(index!==selectedMobileColumn||index>=available);board.classList.toggle('mobile-hidden',mobileHidden);
  if(mobile&&index<available){board.setAttribute('role','tabpanel');board.setAttribute('aria-labelledby',mobileButtons[index].id)}else{board.removeAttribute('role');board.removeAttribute('aria-labelledby')}
  if(mobileHidden)board.setAttribute('aria-hidden','true');else board.removeAttribute('aria-hidden');board.inert=mobileHidden;
  const header=board.querySelector('.board-head');if(header)header.tabIndex=mobileHidden?-1:0;
 });
}
function setupScroll(){
 const previous=new Map(scrollAnimations.map(a=>[a.column,{progress:(Number(a.currentTime)||0)/a.effect.getTiming().duration}]));
 scrollAnimations.forEach(a=>a.cancel());scrollAnimations=[];
 if(isMobileLayout()){stage.style.removeProperty('--row-height');boards.slice(0,4).forEach(b=>b.style.removeProperty('--row-height'));return}
 stage.style.setProperty('--row-height',boards[4].querySelector('.list').clientHeight/10+'px');
 boards.slice(0,4).forEach(b=>b.style.setProperty('--row-height',b.querySelector('.list').clientHeight/(config.layout==='podium'?11:10)+'px'));
 for(const index of [4,5]){if(boards[index].hidden)continue;const viewport=boards[index].querySelector('.list'),track=viewport.querySelector('.all-track');if(!track||typeof track.animate!=='function')continue;
  const motion=C.scrollFrames(track.scrollHeight-viewport.clientHeight,config.speed*innerHeight/1080,config.pause);if(!motion)continue;
  const animation=track.animate(motion.frames,{duration:motion.duration,iterations:Infinity,easing:'linear'});animation.column=index;
  if(previous.has(index))animation.currentTime=(previous.get(index).progress%1)*motion.duration;
  if(!dialog.hidden)animation.pause();scrollAnimations.push(animation);
 }
}
const ticker=document.querySelector('.ticker-line');
const tickerDivider='   ✦ ✧ ✦   ';
function syncBannerPlacement(){
 const zone=document.querySelector('.ticker-zone');
 if(config.layout!=='classic'&&!isMobileLayout()){if(zone.parentElement!==grid)grid.append(zone)}
 else if(zone.parentElement!==stage)stage.insertBefore(zone,mobileTabs);
}
function buildTicker(){
 const leaders=C.filtered(rawData?.group?.daily,config,allLocations).filter(e=>e.value>=100000).slice(0,5);
 return leaders.length?tickerDivider+leaders.map(e=>t('ticker.congratulations',{name:e.name,points:C.formatPoints(Math.floor(e.value/50000)*50000)})).join(tickerDivider)+tickerDivider:t('ticker.fallback');
}
// Decorative particles stay behind text, are bounded, and stop in background tabs.
const fireworks=document.createElement('div');fireworks.className='banner-fireworks';fireworks.setAttribute('aria-hidden','true');ticker.parentElement.prepend(fireworks);
function bannerBurst(strong=false){
 if(document.hidden||!dialog.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const count=strong?5:3,height=fireworks.clientHeight;
 for(let burst=0;burst<count;burst++){
  const x=((burst+.5)/count*100)+'%',y='50%',delay=burst*.35+'s';
  const ring=document.createElement('i');ring.className='banner-bloom';ring.style.left=x;ring.style.top=y;ring.style.animationDelay=delay;fireworks.append(ring);setTimeout(()=>ring.remove(),3200);
  for(let ray=0;ray<20;ray++){
   const spark=document.createElement('i'),angle=ray*Math.PI/10,radius=(strong?90:65)*(ray%2?.7:1);
   spark.className='banner-spark';spark.style.left=x;spark.style.top=y;
   spark.style.setProperty('--dx',Math.cos(angle)*radius+'px');spark.style.setProperty('--dy',Math.sin(angle)*Math.min(height*.43,radius)+'px');spark.style.setProperty('--angle',angle+'rad');spark.style.setProperty('--spark',['#fff6c2','#e6007e','#ffeb72','#a936db'][ray%4]);spark.style.animationDelay=delay;fireworks.append(spark);setTimeout(()=>spark.remove(),3200);
  }
 }
}
setInterval(()=>bannerBurst(),2600);
let celebrationAudio,lastChime=0,celebrationSessionReady=false,celebrationLedger=null;
function unlockCelebrationAudio(){
 if(!config.celebrationSound)return;
 try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;celebrationAudio??=new Audio();if(celebrationAudio.state==='suspended')celebrationAudio.resume().catch(()=>{})}catch{}
}
document.addEventListener('pointerdown',unlockCelebrationAudio);document.addEventListener('keydown',unlockCelebrationAudio);
function celebrationChime(){
 if(!config.celebrationSound||document.hidden||celebrationAudio?.state!=='running'||Date.now()-lastChime<3000)return;
 lastChime=Date.now();const now=celebrationAudio.currentTime;
 [523.25,659.25,783.99,1046.5].forEach((frequency,i)=>{
  const oscillator=celebrationAudio.createOscillator(),gain=celebrationAudio.createGain(),start=now+i*.13;
  oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.13,start+.025);gain.gain.exponentialRampToValueAtTime(.001,start+.65);oscillator.connect(gain);gain.connect(celebrationAudio.destination);oscillator.start(start);oscillator.stop(start+.7);
 });
}
function updateCelebrations(result){
 if(result.data.frozen||result.meta?.stale||dailyHistory)return;
 const timestamp=new Date(result.meta?.computedAt||Date.now()).getTime();if(!Number.isFinite(timestamp))return;
 const day=new Date(timestamp+(7-config.resetHour)*3600000).toISOString().slice(0,10),key=storageKey+'_celebrations';
 let ledger=celebrationLedger;try{ledger=JSON.parse(localStorage.getItem(key)||'null')||ledger}catch{}
 if(!ledger||ledger.day!==day||ledger.reset!==config.resetHour)ledger={day,reset:config.resetHour,groups:{}};
 const visible=new Set(C.filtered(result.data.group?.daily,config,allLocations).filter(e=>e.value>=100000).slice(0,5).map(e=>String(e.groupId||e.id||e.name)));
 let celebrate=false;
 for(const entry of result.data.group?.daily||[]){
  const id=String(entry.groupId||entry.id||entry.name),step=Math.floor(Number(entry.value)/50000),old=ledger.groups[id];
  if(!Number.isFinite(step))continue;
  if(celebrationSessionReady&&Number.isFinite(old)&&step>old&&step>=2&&visible.has(id))celebrate=true;
  ledger.groups[id]=Math.max(Number.isFinite(old)?old:0,step);
 }
 celebrationLedger=ledger;try{localStorage.setItem(key,JSON.stringify(ledger))}catch{}
 celebrationSessionReady=true;
 if(celebrate){bannerBurst(true);celebrationChime()}
}
function tickerContent(){
 const content=document.createDocumentFragment();tickerMessage.split(tickerDivider).forEach((text,index)=>{
  if(index){const ornament=document.createElement('span');ornament.className='ticker-separator';ornament.textContent=tickerDivider;ornament.setAttribute('aria-hidden','true');content.append(ornament)}
  content.append(document.createTextNode(text));
 });return content;
}
function setupTicker(){
 if(tickerAnimation)tickerAnimation.cancel();ticker.classList.remove('is-centered');ticker.replaceChildren(tickerContent());
 if(!ticker.animate)return;
 const span=document.createElement('span');span.append(tickerContent());span.style.display='inline-block';span.style.paddingRight='40px';span.style.minWidth=ticker.parentElement.clientWidth+'px';ticker.replaceChildren(span);
 const duplicate=span.cloneNode(true);duplicate.setAttribute('aria-hidden','true');ticker.append(duplicate);
 const distance=span.getBoundingClientRect().width;tickerAnimation=ticker.animate([{transform:'translateX(0)'},{transform:'translateX(-'+distance+'px)'}],{duration:distance/(config.tickerSpeed*innerWidth/1920)*1000,iterations:Infinity,easing:'linear'});
 if(!dialog.hidden)tickerAnimation.pause();
}
function renderSummary(){
 document.querySelector('.kpi b').textContent=rawData?C.formatPoints(C.total(rawData,config,dailyHistory)):'—';
 const totalYesterday=dailyHistory||rawData?.frozen;
 document.querySelector('.kpi span').textContent=t(totalYesterday?'kpi.yesterday':'kpi.today');
 document.querySelector('.kpi').title=t('kpi.title');
 const groupsYesterday=dailyHistory||columnData[0]?.frozen,idolsYesterday=dailyHistory||columnData[1]?.frozen;
 boards[0].querySelector('.board-head b').textContent=t(groupsYesterday?'board.yesterdayGroups':'board.dailyGroups');boards[1].querySelector('.board-head b').textContent=t(idolsYesterday?'board.yesterdayIdols':'board.dailyIdols');
 const p=historyPayload?.period,historyHead=boards[5].querySelector('.board-head');historyHead.querySelector('b').title=p?t('history.lastMonth')+' · '+p.month+(p.complete?'':' · '+t('history.until')):t('board.lastMonth');
 let period=historyHead.querySelector('.history-period');if(!period){period=document.createElement('span');period.className='history-period';historyHead.append(period)}
 period.textContent=p?p.month+' · '+t(p.complete?'history.closed':'history.provisional'):'';
 const sourceKey=historyPayload?.source==='device cache'?'deviceCache':historyPayload?.source;
 document.getElementById('history-note').textContent=p?t('history.loaded',{month:p.month,state:t(p.complete?'history.closedSnapshot':'history.provisionalDayOne'),source:t('source.'+sourceKey)}):t('history.notLoaded');
 const dailySnapshots=[columnData[0],columnData[1]].filter(Boolean),frozenDaily=dailySnapshots.filter(data=>data.frozen).length;
 const scoreStatus=t(dailyHistory?'status.yesterday':frozenDaily&&frozenDaily===dailySnapshots.length&&rawData?.frozen?'status.frozenYesterday':frozenDaily||rawData?.frozen?'status.mixedFrozen':'status.liveScores');
 document.getElementById('data-status').textContent=rawData?' · '+scoreStatus+(rawData.monthlyGrace?' · '+t('status.monthlyGrace'):''):' · '+t('status.waiting');
 const next=buildTicker();if(next!==tickerMessage){tickerMessage=next;setupTicker()}
 translateUI();
 syncMobileLayout();
}
function apply(){
 const previousLanguage=document.documentElement.lang;config=C.normalize(config);const languageChanged=previousLanguage!==config.language;I.applyDocument(config.language,document);boards.forEach((b,i)=>b.classList.toggle('hide-points',i<5&&!config.scores[i]));
 const changedLayout=sixth.hidden===config.lastMonth||stage.dataset.layout!==config.layout;stage.dataset.layout=config.layout;stage.dataset.studio=String(config.layout!=='classic');sixth.hidden=!config.lastMonth;stage.classList.toggle('six',config.lastMonth);grid.style.setProperty('--columns',config.lastMonth?6:5);
 syncMobileLayout();
 document.querySelector('.kpi').classList.toggle('hide-total',!config.total);
 stage.dataset.rankOrder=config.rankOrder;document.getElementById('rank-order-label').hidden=config.layout==='classic';
 let changed=false;boards.forEach((b,i)=>{changed=renderRows(i)||changed});const motion=config.speed+'|'+config.pause;if(changed||changedLayout||motion!==lastMotion)setupScroll();lastMotion=motion;renderSummary();renderConnection();if(changedLayout||lastTickerSpeed!==config.tickerSpeed)setupTicker();lastTickerSpeed=config.tickerSpeed;syncInputs();persist();if(languageChanged)renderLocations();
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
 const locale=config.language==='vi'?'vi-VN':'en-GB',value=meta.oldest?meta.oldest.toLocaleString(locale,{timeZone:'Asia/Ho_Chi_Minh'}):t('updated.unknown');
 document.querySelector('.footer>span:last-child').textContent=t('updated.label',{value})+(meta.mixed?' · '+t('status.mixed'):'');
}
function renderConnection(){
 const meta=visibleMetadata();renderUpdated(meta);
 if(dataError){connection(t(rawData?'status.offlineRetained':'status.offlineNoData'));return}
 if(!rawData){connection(t('status.connecting'));return}
 const parts=[];if(meta.mixed)parts.push(t('status.mixed'));if(meta.cached)parts.push(t('status.cached'));if(meta.stale)parts.push(t('status.stale'),t('status.updating'));
 if(!parts.length)parts.push('● '+t(meta.allComputed&&!meta.unknown&&streamConnected?'status.live':'status.connected'));
 if(!streamConnected)parts.push(t('status.reconnecting'));connection(parts.join(' · '));
}
async function loadCurrent(indices=[0,1,2,3,4],manual=false){
 const context=requestContext();if(!manual&&manualPending.get(context))return;
 if(manual){manualPending.set(context,(manualPending.get(context)||0)+1);manualEpoch.set(context,(manualEpoch.get(context)||0)+1)}
 const epoch=manualEpoch.get(context)||0,key=context+'|'+(manual?'fresh':'current'),request=++requestCounter;indices.forEach(i=>{columnVersion[i]=request;boards[i].classList.add('loading');boards[i].querySelector('.column-refresh')?.setAttribute('disabled','')});
 if(!liveInFlight.has(key)){const promise=fetchJSON('/api/leaderboard/'+(manual?'fresh':'current')+'?'+context).finally(()=>liveInFlight.delete(key));liveInFlight.set(key,promise)}
 try{const result=await liveInFlight.get(key);if(context!==requestContext()||(!manual&&epoch!==(manualEpoch.get(context)||0)))return;
  const accepted=indices.filter(i=>columnVersion[i]===request);if(!accepted.length)return;
  rawData=result.data;dataError=false;allLocations=(rawData.locations||[]).map(l=>({...l,id:String(l.id)}));allGroups=(rawData.groups||[]).map(g=>({...g,id:String(g.id),locationId:String(g.locationId||'')}));
  updateCelebrations(result);
  accepted.forEach(i=>{columnData[i]=rawData;columnMeta[i]=result.meta||null});let changed=false;accepted.forEach(i=>{changed=renderRows(i)||changed});if(changed)setupScroll();renderSummary();renderLocations();syncInputs();
  renderConnection();if(manual)notify(t(result.meta?.stale===true?'toast.pointsPending':'toast.pointsRefreshed'));
 }catch(e){if(context===requestContext()&&(manual||epoch===(manualEpoch.get(context)||0))){dataError=true;renderConnection();if(manual||!rawData)notify(t('toast.refreshFailed'))}}
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
   historyPayload=payload;columnData[5]=rawData;if(C.historyValid(payload,month)){try{localStorage.setItem(storageKey+'_history_'+month,JSON.stringify(payload))}catch{notify(t('toast.historyCacheFailed'))}}
   renderRows(5);setupScroll();renderSummary();renderTalents();if(force)notify(t('toast.historyRefreshed'));
  }catch(e){if(version===historyRequest)notify(t('toast.historyFailed'))}
  finally{if(version===historyRequest)boards[5].classList.remove('loading');if(historyInFlight?.version===version)historyInFlight=null}
 })();historyInFlight={month,version,promise};return promise;
}
function refreshColumn(index){return index===5?loadHistory(true):loadCurrent([index],true)}
function refreshAll(){return Promise.all([loadCurrent([0,1,2,3,4],true),...(config.lastMonth?[loadHistory(true)]:[])])}
let page=0,selectedLocation='';
function renderLocations(){
 const select=document.getElementById('location-choice');const locations=[{id:'',name:t('location.all')},...allLocations];
 if(!locations.some(l=>l.id===selectedLocation))selectedLocation='';
 const signature=JSON.stringify(locations);if(select.dataset.signature!==signature){select.replaceChildren();locations.forEach(l=>{const option=document.createElement('option');option.value=l.id;option.textContent=l.name;select.append(option)});select.dataset.signature=signature}
 select.value=selectedLocation;renderGroups();renderTalents();
}
function renderGroups(){
 const groupList=allGroups.filter(g=>!selectedLocation||g.locationId===selectedLocation),size=innerWidth<700?4:6,total=Math.max(1,Math.ceil(groupList.length/size));page=Math.max(0,Math.min(page,total-1));
 const holder=document.getElementById('location-toggles');let locInput=holder.querySelector('input');if(!locInput){const label=document.createElement('label'),span=document.createElement('span');locInput=document.createElement('input');locInput.type='checkbox';locInput.id='location-visible';label.append(span,locInput);holder.append(label);locInput.onchange=()=>{for(const l of allLocations.filter(l=>!selectedLocation||l.id===selectedLocation))config.locations[l.id]=locInput.checked;apply();renderGroups()}}
 holder.querySelector('span').textContent=t(selectedLocation?'visibility.showLocation':'visibility.showAllLocations');
 const selected=allLocations.filter(l=>!selectedLocation||l.id===selectedLocation),enabled=selected.filter(l=>config.locations[l.id]===true).length;
 locInput.checked=selected.length>0&&enabled===selected.length;locInput.indeterminate=enabled>0&&enabled<selected.length;locInput.disabled=!selected.length;
 const branches=document.getElementById('branch-items');branches.hidden=Boolean(selectedLocation);
 const branchSignature=JSON.stringify([config.language,allLocations]);if(branches.dataset.signature!==branchSignature){branches.replaceChildren();for(const l of allLocations){const label=document.createElement('label'),span=document.createElement('span'),input=document.createElement('input');span.textContent=l.name;input.type='checkbox';input.dataset.location=l.id;input.setAttribute('aria-label',t('visibility.showName',{name:l.name}));label.append(span,input);branches.append(label);input.onchange=()=>{config.locations[l.id]=input.checked;apply();renderGroups()}}branches.dataset.signature=branchSignature}
 branches.querySelectorAll('input').forEach(input=>input.checked=config.locations[input.dataset.location]===true);
 const container=document.getElementById('group-items');const signature=JSON.stringify([selectedLocation,page,size,groupList.map(g=>[g.id,g.name,config.groups[g.id]!==false])]);
 if(container.dataset.signature!==signature){container.replaceChildren();groupList.slice(page*size,page*size+size).forEach(g=>{const label=document.createElement('label'),span=document.createElement('span'),input=document.createElement('input');span.textContent=g.name;span.title=g.name;input.type='checkbox';input.checked=config.groups[g.id]!==false;input.setAttribute('aria-label',g.name);label.append(span,input);container.append(label);input.onchange=()=>{config.groups[g.id]=input.checked;apply()}});container.dataset.signature=signature}
 document.getElementById('groups-page').textContent=(page+1)+' / '+total;document.getElementById('groups-prev').disabled=page===0;document.getElementById('groups-next').disabled=page>=total-1;
}


let talentPage=0;
function renderTalents(){
 const sources=[rawData,...columnData.slice(0,5)],names=new Set(selectedLocation?[]:Object.keys(config.talents||{}));
 for(const source of sources)for(const rows of Object.values(source?.individual||{}))for(const row of rows||[])if(typeof row.name==='string'&&(!selectedLocation||String(row.locationId)===selectedLocation))names.add(row.name);
 for(const row of historyPayload?.data?.individual||[])if(typeof row.name==='string'&&(!selectedLocation||String(row.locationId)===selectedLocation))names.add(row.name);
 const list=[...names].sort((a,b)=>a.localeCompare(b)),size=innerWidth<700?4:6,total=Math.max(1,Math.ceil(list.length/size));talentPage=Math.max(0,Math.min(talentPage,total-1));
 const container=document.getElementById('talent-items'),shown=list.slice(talentPage*size,(talentPage+1)*size),signature=JSON.stringify(shown);
 if(container.dataset.signature!==signature){
  container.replaceChildren();for(const name of shown){const label=document.createElement('label'),span=document.createElement('span'),input=document.createElement('input');span.textContent=name;span.title=name;input.type='checkbox';input.dataset.talent=name;input.setAttribute('aria-label',name);label.append(span,input);container.append(label);
   input.onchange=()=>{config.talents[name]=input.checked;apply();document.getElementById('save-status').textContent=t('settings.changesSaved')};
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
function saveDefault(){try{localStorage.setItem(storageKey+'_default',JSON.stringify(config));saved=JSON.parse(JSON.stringify(config));document.getElementById('save-status').textContent=t('settings.defaultSavedDevice');notify(t('toast.defaultSaved'))}catch(e){notify(t('toast.storageSettings'))}}
['save-default','save-default-page'].forEach(id=>document.getElementById(id).onclick=saveDefault);
document.getElementById('restore-default').onclick=()=>{config=C.normalize(saved||defaults);apply();renderLocations();notify(t('toast.defaultRestored'))};
document.getElementById('factory').onclick=()=>{config=C.normalize(defaults);apply();renderLocations();notify(t('toast.factory'))};
configInputs.forEach(e=>e.onchange=()=>{if(editing===e&&!['layout','language','rankOrder'].includes(e.dataset.config))return;let value=e.type==='checkbox'?e.checked:e.type==='number'?Number(e.value):e.value;
 if(e.type==='number'){value=Math.max(Number(e.min),Math.min(Number(e.max),value));if(!Number.isFinite(value))return}
 config[e.dataset.config]=value;apply();if(['speed','pause'].includes(e.dataset.config))setupScroll();if(e.dataset.config==='tickerSpeed')setupTicker();document.getElementById('save-status').textContent=t('settings.changesSaved')});
['layout-choice','language-choice','rank-order-choice'].forEach(id=>document.getElementById(id).oninput=e=>e.target.onchange());
document.getElementById('use-v1').onclick=()=>window.HeliosVersion.choose('v1');
scoreInputs.forEach(e=>e.onchange=()=>{config.scores[+e.dataset.score]=e.checked;apply();document.getElementById('save-status').textContent=t('settings.changesSaved')});
function openPage(index){document.querySelectorAll('[data-page]').forEach(e=>e.classList.toggle('active',+e.dataset.page===index));document.querySelectorAll('[data-pane]').forEach(e=>e.classList.toggle('active',+e.dataset.pane===index))}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>openPage(+b.dataset.page));

boards.forEach((b,i)=>{
 const header=b.querySelector('.board-head');header.tabIndex=0;header.setAttribute('role','button');header.setAttribute('aria-label',t('actions.showRefresh',{name:header.textContent}));
 const btn=document.createElement('button');btn.className='column-refresh';btn.textContent='↻';btn.setAttribute('aria-label',t('actions.refresh',{name:header.querySelector('b').textContent}));
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
let tvPicker=null;
function closeTVPicker(){if(!tvPicker)return;const {panel,input}=tvPicker;tvPicker=null;panel.remove();input.focus()}
function openTVPicker(input){
 if(editing)finishEdit(true);closeTVPicker();
 const panel=document.createElement('section');panel.className='tv-picker';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
 const heading=document.createElement('h3');heading.textContent=input.closest('label').firstChild.textContent.trim();panel.setAttribute('aria-label',heading.textContent);panel.append(heading);
 const controls=document.createElement('div');controls.className='tv-picker-controls';panel.append(controls);
 const add=(label,action)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;controls.append(button);return button};
 const commit=()=>input.dispatchEvent(new Event('change',{bubbles:true}));
 tvPicker={panel,input};
 if(input.matches('select')){
  [...input.options].forEach(option=>{const button=add(option.textContent,()=>{input.value=option.value;commit();closeTVPicker()});button.disabled=option.disabled;button.setAttribute('aria-pressed',String(option.selected))});
 }else{
  const value=document.createElement('output');value.className='tv-picker-value';value.textContent=input.value||'—';panel.insertBefore(value,controls);
  const change=(delta,minutes=false)=>{
   if(input.type==='time'){const parts=(input.value||'00:00').split(':').map(Number),index=minutes?1:0,limit=minutes?60:24;parts[index]=(parts[index]+delta+limit)%limit;input.value=parts.map(n=>String(n).padStart(2,'0')).join(':')}
   else{const min=input.min===''?-Infinity:Number(input.min),max=input.max===''?Infinity:Number(input.max);input.value=String(Math.min(max,Math.max(min,Number(input.value||0)+delta*Number(input.step||1))))}
   value.textContent=input.value;commit();
  };
  if(input.type==='time'){
   add('− '+(config.language==='vi'?'Giờ':'Hour'),()=>change(-1));add('+ '+(config.language==='vi'?'Giờ':'Hour'),()=>change(1));
   add('− '+(config.language==='vi'?'Phút':'Minute'),()=>change(-1,true));add('+ '+(config.language==='vi'?'Phút':'Minute'),()=>change(1,true));
   add(config.language==='vi'?'Bỏ giữ điểm':'No freeze',()=>{input.value='';value.textContent='—';commit()});
  }else{add('−',()=>change(-1));add('+',()=>change(1))}
 }
 add(config.language==='vi'?'Xong':'Done',closeTVPicker);
 dialog.querySelector('.settings-box').append(panel);controls.querySelector('[aria-pressed="true"],button:not(:disabled)')?.focus();
}
// Avoid native TV select/time popups entirely for mouse-emulated remote clicks.
dialog.addEventListener('mousedown',e=>{if(e.target.matches('select,input[type=time],input[type=number]'))e.preventDefault()},true);
dialog.addEventListener('click',e=>{if(e.target.matches('select,input[type=time],input[type=number]')){e.preventDefault();openTVPicker(e.target)}},true);
function beginEdit(el){
 editing=el;editOriginal=el.value;el.classList.add('remote-editing');el.focus();
 document.getElementById('save-status').textContent=t('settings.editing');
}
function finishEdit(commit){
 if(!editing)return;
 const el=editing;editing=null;
 if(['layout','language','rankOrder'].includes(el.dataset.config))commit=true;
 if(!commit)el.value=editOriginal;
 el.classList.remove('remote-editing');
 if(commit||el.id==='location-choice'||el.id==='visibility-kind')el.dispatchEvent(new Event('change',{bubbles:true}));
 document.getElementById('save-status').textContent=t(commit?'settings.applied':'settings.cancelled');
 el.focus();
}
function navButtons(){return [...dialog.querySelectorAll('.settings-nav button')]}
function pageControls(){return [...dialog.querySelectorAll('.settings-page.active button,.settings-page.active input,.settings-page.active select,.settings-page.active a,.settings-actions button')].filter(el=>el.getClientRects().length&&!el.disabled)}
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
// Some TV browsers expose only legacy keyCode values or Left/Right names.
// Normalize before the browser's spatial navigation can move the pointer/focus.
document.addEventListener('keydown',e=>{
 const aliases={Left:'ArrowLeft',Right:'ArrowRight',Up:'ArrowUp',Down:'ArrowDown',OK:'Enter',Return:'Enter'},codes={19:'ArrowUp',20:'ArrowDown',21:'ArrowLeft',22:'ArrowRight',23:'Enter',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown',13:'Enter',27:'Escape',461:'BrowserBack',10009:'BrowserBack'};
 const key=aliases[e.key]||((!e.key||e.key==='Unidentified')?(codes[e.keyCode]||(e.keyCode>=48&&e.keyCode<=57?String.fromCharCode(e.keyCode):'')):'');
 if(!key)return;
 e.preventDefault();e.stopImmediatePropagation();
 (e.target instanceof Element?e.target:document.activeElement).dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,repeat:e.repeat,shiftKey:e.shiftKey}));
},true);
dialog.addEventListener('focusin',e=>{
 dialog.querySelectorAll('.remote-focus').forEach(el=>el.classList.remove('remote-focus'));
 const label=e.target.closest('label');if(label)label.classList.add('remote-focus');
});
document.addEventListener('keydown',e=>{
 const ok=e.key==='Enter'||e.key==='Accept'||e.key==='Select'||e.keyCode===23;
 const back=e.key==='Escape'||e.key==='BrowserBack'||e.key==='GoBack'||e.keyCode===10009||e.keyCode===461;
 if(!dialog.hidden){
  if(tvPicker){
   if(back||e.key==='Backspace'){e.preventDefault();closeTVPicker();return}
   const buttons=[...tvPicker.panel.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
   if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.key)){e.preventDefault();const delta=['ArrowUp','ArrowLeft'].includes(e.key)||(e.key==='Tab'&&e.shiftKey)?-1:1;buttons[(index+delta+buttons.length)%buttons.length]?.focus();return}
   if(ok){e.preventDefault();if(!e.repeat)document.activeElement.click();return}
   e.preventDefault();return;
  }
  if(back){e.preventDefault();goBack();return}
  if(editing){
    if(editing.matches('input[type=time],input[type=number]')&&['ArrowUp','ArrowDown'].includes(e.key)){
     e.preventDefault();const el=editing,d=e.key==='ArrowUp'?1:-1;
     if(el.type==='time'){const parts=(el.value||'00:00').split(':').map(Number);parts[0]=(parts[0]+d+24)%24;el.value=parts.map(n=>String(n).padStart(2,'0')).join(':')}
     else{try{d>0?el.stepUp():el.stepDown()}catch{}}
     return;
    }
    if(editing.matches('select')&&['ArrowUp','ArrowDown','Home','End'].includes(e.key)){
     e.preventDefault();const el=editing,last=el.options.length-1;el.selectedIndex=e.key==='Home'?0:e.key==='End'?last:Math.max(0,Math.min(last,el.selectedIndex+(e.key==='ArrowDown'?1:-1)));el.dispatchEvent(new Event('change',{bubbles:true}));return;
    }
    if(e.key==='ArrowLeft'||e.key==='Backspace'){e.preventDefault();finishEdit(false);return}
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
    else if(el.matches('button,a'))el.click();
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
window.addEventListener('resize',()=>{syncMobileLayout();setupScroll();setupTicker();renderGroups();renderTalents()});


document.getElementById('refresh-all').onclick=refreshAll;
document.getElementById('refresh-last').onclick=()=>loadHistory(true);
document.getElementById('daily-history').onclick=()=>{dailyHistory=!dailyHistory;apply();notify(t(dailyHistory?'toast.showYesterday':'toast.showCurrent'))};
document.getElementById('unfreeze').onclick=()=>{dailyHistory=false;unfreezeUntil=Date.now()+120000;lastContext='';apply();notify(t('toast.unfreeze'))};
document.getElementById('location-choice').onchange=e=>{selectedLocation=e.target.value;page=0;talentPage=0;renderGroups();renderTalents()};
document.getElementById('visibility-kind').onchange=e=>{document.getElementById('visibility-groups').hidden=e.target.value!=='groups';document.getElementById('visibility-talents').hidden=e.target.value!=='talents';renderGroups();renderTalents()};
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
