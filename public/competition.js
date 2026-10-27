'use strict';
// Competition score page: access request -> wait for approval -> swipeable LIVE + snapshot pages.
// Every name comes from users or HeliosControl, so the DOM is built with textContent only.
(()=>{
 const slug=location.pathname.replace(/^\/+|\/+$/g,''),api=p=>`/api/competitions/${encodeURIComponent(slug)}${p}`,$=id=>document.getElementById(id);
 const number=new Intl.NumberFormat('vi-VN'),clock=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
 // Negative scores (manual corrections) use a true minus sign U+2212; unknown values (old snapshots) show an en dash.
 const fmt=n=>n==null?'–':(Number(n)<0?'−':'')+number.format(Math.abs(Number(n)||0)),when=v=>v==null?'':clock.format(new Date(v));
 const VIEWS=['loading-view','missing-view','request-view','pending-view','board-view'],MODES={competition:'Cuộc thi',overall:'Tổng cộng'};
 // Per-browser view preferences; storage can be unavailable (private mode, blocked site data).
 const stored=key=>{try{return localStorage.getItem(`heliosComp.${key}`)}catch{return null}},store=(key,value)=>{try{localStorage.setItem(`heliosComp.${key}`,value)}catch{}};
 let board=null,csrf='',mode=MODES[stored('mode')]?stored('mode'):'competition',showGroups=stored('groups')==='1',showOut=stored('out')==='1',timer=0,current='live',pageSig='',adminSig='',dialogMode=null,toastTimer=0;
 function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
 const ICONS={pencil:'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',trash:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'};
 function iconButton(icon,label,data,cls=''){
  const b=el('button',('icon-mini '+cls).trim()),svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
  b.type='button';b.title=label;b.setAttribute('aria-label',label);Object.assign(b.dataset,data);
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','16');svg.setAttribute('height','16');svg.setAttribute('aria-hidden','true');
  path.setAttribute('d',ICONS[icon]);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','2');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');
  svg.append(path);b.append(svg);return b;
 }
 function toast(message){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,3500)}
 async function call(url,{method='GET',body}={}){
  const headers={accept:'application/json'};if(body!==undefined)headers['content-type']='application/json';if(method!=='GET'&&csrf)headers['x-csrf-token']=csrf;
  const res=await fetch(url,{method,headers,credentials:'same-origin',cache:'no-store',body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await res.json()}catch{}
  if(!res.ok)throw Object.assign(Error(data.error||String(res.status)),{status:res.status,code:data.error});return data;
 }
 const errorText=e=>({rate_limited:'Quá nhiều yêu cầu, vui lòng thử lại sau.',too_many_pending:'Trình duyệt này đã có nhiều yêu cầu đang chờ.',too_many_requests:'Cuộc thi đã nhận quá nhiều yêu cầu.',invalid_name:'Tên không hợp lệ (tối đa 60 ký tự).',role_required:'Bạn không có quyền này.',access_required:'Bạn chưa được cấp quyền.',csrf_required:'Phiên quản trị đã hết hạn, hãy tải lại trang.',too_many_snapshots:'Đã đạt số snapshot tối đa.'})[e.code]||'Không thực hiện được, vui lòng thử lại.';
 function show(view){for(const id of VIEWS)$(id).hidden=id!==view}
 function header(comp){
  $('comp-name').textContent=comp.name;document.title=`${comp.name} · Helios Talent`;
  const badge=$('comp-status');badge.hidden=false;badge.className=`badge ${comp.status}`;badge.textContent=comp.status==='active'?'Đang diễn ra':comp.status==='ended'?'Đã kết thúc':'Chưa bắt đầu';
 }
 function schedule(ms){clearTimeout(timer);timer=setTimeout(tick,ms)}
 function tick(){if(document.hidden)return schedule(3000);return $('board-view').hidden?refresh():loadBoard()}
 async function refresh(){
  let state;try{state=await call(api('/state'))}catch(e){if(e.status===404){show('missing-view');return}toast('Không tải được dữ liệu, đang thử lại…');return schedule(10000)}
  header(state.competition);
  if(state.role)return loadBoard();
  if(state.request?.status==='pending'){$('pending-name').textContent=state.request.name;show('pending-view');return schedule(5000)}
  $('request-note').textContent=state.request?.status==='revoked'?'Quyền xem đã bị thu hồi. Bạn có thể gửi yêu cầu mới.':'Quản trị viên Helios sẽ duyệt yêu cầu của bạn.';
  show('request-view');clearTimeout(timer);
 }
 async function loadBoard(){
  let data;try{data=await call(api('/board'))}catch(e){if(e.status===401||e.status===403){board=null;$('admin-view').hidden=true;return refresh()}toast('Mất kết nối, đang thử lại…');return schedule(10000)}
  board=data;header(data.competition);$('updated').textContent=`Cập nhật ${when(data.live.at)}`;$('snapshot-button').hidden=!data.canSnapshot;show('board-view');renderPages();
  if(data.admin){if(!csrf)await loadCsrf();loadRequests()}
  schedule(10000);
 }
 async function loadCsrf(){try{csrf=(await call('/auth/status')).csrf||''}catch{csrf=''}}
 // gone = talents already out in the snapshot before this page (newest first): they left in an earlier round.
 const outNames=snap=>new Set((snap?.rows||[]).filter(r=>r.eliminated).map(r=>r.talentName));
 function pages(){
  const live=board.live,snaps=board.snapshots,list=[{id:'live',live:true,title:'LIVE',sub:'Cộng dồn từ đầu cuộc thi',rows:live.rows,groups:live.groups,gone:outNames(snaps[0])}];
  snaps.forEach((s,i)=>list.push({id:s.id,title:s.name,sub:`${when(s.at)}${s.createdBy?` · ${s.createdBy}`:''}`,rows:s.rows,groups:s.groups,gone:outNames(snaps[i+1])}));
  return list;
 }
 // "Cuộc thi": talents out since an earlier round are gone; those out in this round are hidden behind the eye
 // (shown dimmed and unnumbered when it is on). "Tổng cộng" (revenue) lists everyone normally.
 const roundOut=(page,row)=>mode==='competition'&&row.eliminated&&!page.gone.has(row.talentName);
 function talentRows(page){return mode==='competition'?page.rows.filter(r=>!(r.eliminated&&page.gone.has(r.talentName))&&(showOut||!r.eliminated)):page.rows}
 // Sorted by the selected mode; unknown values (old snapshots in "Tổng cộng") go last.
 const value=(row,key=mode)=>row[key]==null?-Infinity:Number(row[key])||0,other=()=>mode==='competition'?'overall':'competition';
 function ranked(rows){return [...rows].sort((a,b)=>value(b)-value(a)||value(b,other())-value(a,other())||String(a.talentName||a.profileName).localeCompare(String(b.talentName||b.profileName)))}
 function score(row){const v=row[mode];return el('b',`score${v!=null&&Number(v)<0?' neg':''}`,fmt(v))}
 // Players still competing rank by score. Eliminated ones (eye on) follow at the bottom with the rank they
 // went out at (eliminatedRank: HeliosControl's panel position, or the server's fallback); rows without one
 // (old snapshots) follow by when they went out, latest first. Groups always count everyone.
 const outTime=row=>{const t=Date.parse(row.eliminatedAt||'');return Number.isFinite(t)?t:-Infinity};
 const outRank=row=>Number.isInteger(row.eliminatedRank)&&row.eliminatedRank>0?row.eliminatedRank:null;
 function placed(rows,page,group){
  if(group||mode!=='competition')return ranked(rows);
  const out=rows.filter(r=>roundOut(page,r)).sort((a,b)=>(outRank(a)??Infinity)-(outRank(b)??Infinity)||outTime(b)-outTime(a)||value(b)-value(a)||String(a.talentName).localeCompare(String(b.talentName)));
  return [...ranked(rows.filter(r=>!roundOut(page,r))),...out];
 }
 function list(title,rows,group,page){
  const wrap=el(group?'aside':'div',group?'groups':'talents');if(group)wrap.setAttribute('aria-label',title);
  const head=el('div','section-head');head.append(el('div','section-title',`${title} · ${MODES[mode]}`));wrap.append(head);
  const visible=group?rows:talentRows(page);
  const ol=el('ol','rows');if(!visible.length)ol.append(el('li','empty',rows.length?'Tất cả đã bị loại':'Chưa có dữ liệu'));
  placed(visible,page,group).forEach((row,i)=>{const isOut=!group&&roundOut(page,row),rank=isOut&&outRank(row)?outRank(row):i+1;const li=el('li',`row${isOut?' out':rank<=3?` top${rank}`:''}`);li.append(el('span','rank',String(rank)));const name=group?row.profileName:row.talentName;
   if(!group)li.append(el('span','avatar',Array.from(name||'?')[0]||'?'));
   const who=el('div','who');who.append(el('b','',name||'—'));if(!group){const sub=el('small','',row.profileName||'');if(isOut){const r=outRank(row),tag=el('span','out-tag',r?`Loại ở hạng ${r}${row.eliminatedOf?`/${row.eliminatedOf}`:''}`:'Đã loại');if(row.eliminatedAt)tag.title=`Bị loại lúc ${when(row.eliminatedAt)}`;sub.prepend(tag)}who.append(sub)}li.append(who,score(row));ol.append(li)});
  wrap.append(ol);return wrap;
 }
 function applyGroups(){$('board-view').classList.toggle('groups-on',showGroups);$('groups-toggle').setAttribute('aria-pressed',String(showGroups))}
 function applyMode(){for(const b of document.querySelectorAll('.modes button'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode))}
 function renderPages(){
  const all=pages(),sig=JSON.stringify([mode,showOut,board.canSnapshot,board.admin,all]);if(sig===pageSig)return;pageSig=sig;
  const box=$('pages'),dots=$('dots');box.replaceChildren();dots.replaceChildren();
  all.forEach((p,i)=>{
   const page=el('article',`page${p.live?' live':''}`);page.dataset.id=p.id;page.setAttribute('aria-label',p.title);
   const head=el('div','page-head'),titles=el('div','page-titles'),row=el('div','title-row'),h=el('h2','page-title');if(p.live)h.append(el('span','live-dot'));h.append(document.createTextNode(p.title));row.append(h);
   // Rename: pencil right next to the name. Delete (admins): trash at the far right, away from it, and confirmed.
   if(!p.live&&board.canSnapshot)row.append(iconButton('pencil','Đổi tên snapshot',{rename:p.id}));
   titles.append(row,el('div','page-sub',p.sub));head.append(titles);
   if(!p.live&&board.admin)head.append(iconButton('trash','Xóa snapshot',{remove:p.id},'danger'));
   if(mode==='overall'&&p.rows.some(r=>r.overall==null))page.append(head,el('div','old-note','Snapshot cũ chưa lưu số Tổng cộng.'));else page.append(head);
   const body=el('div','page-body');body.append(list('Tổng theo nhóm',p.groups,true),list('Xếp hạng talent',p.rows,false,p));page.append(body);box.append(page);
   const dot=el('button');dot.type='button';dot.setAttribute('aria-label',p.title);dot.dataset.page=String(i);dots.append(dot);
  });
  const index=Math.max(0,all.findIndex(p=>p.id===current));current=all[index].id;
  box.style.scrollBehavior='auto';box.scrollLeft=box.children[index].offsetLeft;box.style.scrollBehavior='';markDots(index);
 }
 function indexNow(){const box=$('pages');let best=0,gap=Infinity;[...box.children].forEach((c,i)=>{const d=Math.abs(c.offsetLeft-box.scrollLeft);if(d<gap){gap=d;best=i}});return best}
 // Eye count follows the page in view (LIVE or a snapshot taken when fewer/more were out).
 function applyOut(index=indexNow()){
  const page=board&&pages()[index],out=page?page.rows.filter(r=>roundOut(page,r)).length:0,b=$('out-toggle');
  b.hidden=!out;$('out-count').textContent=String(out);b.setAttribute('aria-pressed',String(showOut));b.classList.toggle('on',showOut);
  const label=`${showOut?'Ẩn':'Hiện'} ${out} người bị loại`;b.setAttribute('aria-label',label);b.title=label;
 }
 function markDots(index){applyOut(index);[...$('dots').children].forEach((d,i)=>d.setAttribute('aria-current',String(i===index)));$('prev-page').disabled=index===0;$('next-page').disabled=index>=$('pages').children.length-1}
 function go(index){const box=$('pages'),page=box.children[Math.max(0,Math.min(index,box.children.length-1))];if(page)box.scrollTo({left:page.offsetLeft,behavior:'smooth'})}
 let scrollFrame=0;$('pages').addEventListener('scroll',()=>{cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(()=>{const i=indexNow(),page=$('pages').children[i];if(page)current=page.dataset.id;markDots(i)})});
 $('pages').addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();go(indexNow()+1)}else if(e.key==='ArrowLeft'){e.preventDefault();go(indexNow()-1)}});
 $('prev-page').addEventListener('click',()=>go(indexNow()-1));$('next-page').addEventListener('click',()=>go(indexNow()+1));
 $('dots').addEventListener('click',e=>{const b=e.target.closest('button[data-page]');if(b)go(Number(b.dataset.page))});
 document.querySelector('.modes').addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(!b||!MODES[b.dataset.mode])return;mode=b.dataset.mode;store('mode',mode);applyMode();if(board){renderPages();applyOut()}});
 $('out-toggle').addEventListener('click',()=>{showOut=!showOut;store('out',showOut?'1':'0');renderPages();applyOut()});
 $('groups-toggle').addEventListener('click',()=>{showGroups=!showGroups;store('groups',showGroups?'1':'0');applyGroups()});
 applyMode();applyGroups();
 $('pages').addEventListener('click',async e=>{
  const rename=e.target.closest('button[data-rename]'),remove=e.target.closest('button[data-remove]');
  if(rename){const snap=board.snapshots.find(s=>s.id===rename.dataset.rename);if(snap)openDialog({mode:'rename',id:snap.id,value:snap.name})}
  if(remove){const snap=board.snapshots.find(s=>s.id===remove.dataset.remove);if(!snap||!confirm(`Xóa snapshot "${snap.name}"?`))return;
   try{await call(api(`/snapshots/${snap.id}/delete`),{method:'POST',body:{}});toast('Đã xóa snapshot');pageSig='';await loadBoard()}catch(err){toast(errorText(err))}}
 });
 function openDialog({mode,id,value}){dialogMode={mode,id};$('name-title').textContent=mode==='create'?'Chụp snapshot':'Đổi tên snapshot';$('name-input').value=value||'';$('name-dialog').showModal();$('name-input').select()}
 $('snapshot-button').addEventListener('click',()=>openDialog({mode:'create',value:`Snapshot ${(board?.snapshots.length||0)+1}`}));
 $('name-cancel').addEventListener('click',()=>{dialogMode=null;$('name-dialog').close()});
 $('name-form').addEventListener('submit',async e=>{
  e.preventDefault();const name=$('name-input').value.trim(),mode=dialogMode;if(!name||!mode)return;const button=$('name-confirm');button.disabled=true;
  try{
   if(mode.mode==='create'){await call(api('/snapshots'),{method:'POST',body:{name}});toast('Đã chụp snapshot · vuốt sang để xem')}
   else{await call(api(`/snapshots/${mode.id}/rename`),{method:'POST',body:{name}});toast('Đã đổi tên')}
   dialogMode=null;$('name-dialog').close();pageSig='';await loadBoard();
  }catch(err){toast(errorText(err))}finally{button.disabled=false}
 });
 $('request-form').addEventListener('submit',async e=>{
  e.preventDefault();const name=$('request-name').value.trim();if(!name)return;const button=e.target.querySelector('button');button.disabled=true;
  try{await call(api('/request'),{method:'POST',body:{name}});await refresh()}catch(err){toast(errorText(err))}finally{button.disabled=false}
 });
 async function loadRequests(){
  let data;try{data=await call(api('/requests'))}catch{return}
  const sig=JSON.stringify(data.requests);$('admin-view').hidden=false;if(sig===adminSig)return;adminSig=sig;
  const box=$('admin-list');box.replaceChildren();if(!data.requests.length)box.append(el('div','empty','Chưa có yêu cầu nào'));
  for(const r of data.requests){
   const item=el('div','request'),who=el('div','who');who.append(el('b','',r.name));
   who.append(el('small','',r.status==='pending'?`Đang chờ duyệt · ${when(r.createdAt)}`:`Đã duyệt: ${r.role==='snapshot'?'xem + snapshot':'xem'}${r.decidedBy?` · ${r.decidedBy}`:''}`));
   const btns=el('div','btns');
   for(const [action,label,cls] of [['viewer','Duyệt xem','primary'],['snapshot','Duyệt xem + snapshot','primary'],['revoke','Thu hồi','danger']]){
    const b=el('button',cls,label);b.type='button';b.dataset.request=r.id;b.dataset.action=action;if(r.status==='approved'&&r.role===action)b.disabled=true;btns.append(b)}
   item.append(who,btns);box.append(item);
  }
 }
 $('admin-list').addEventListener('click',async e=>{
  const b=e.target.closest('button[data-request]');if(!b)return;b.disabled=true;
  try{await call(api(`/requests/${b.dataset.request}`),{method:'POST',body:{action:b.dataset.action}});adminSig='';await loadRequests()}catch(err){toast(errorText(err));b.disabled=false}
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('board-view').hidden)loadBoard()});
 refresh();
})();
