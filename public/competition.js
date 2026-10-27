'use strict';
// Competition score page: access request -> wait for approval -> swipeable LIVE + snapshot pages.
// Every name comes from users or HeliosControl, so the DOM is built with textContent only.
(()=>{
 const slug=location.pathname.replace(/^\/+|\/+$/g,''),api=p=>`/api/competitions/${encodeURIComponent(slug)}${p}`,$=id=>document.getElementById(id);
 const number=new Intl.NumberFormat('vi-VN'),clock=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
 const fmt=n=>number.format(Number(n)||0),when=v=>v==null?'':clock.format(new Date(v));
 const VIEWS=['loading-view','missing-view','request-view','pending-view','board-view'];
 let board=null,csrf='',sort='total',timer=0,current='live',pageSig='',adminSig='',dialogMode=null,toastTimer=0;
 function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
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
 function pages(){
  const live=board.live,list=[{id:'live',live:true,title:'LIVE',sub:live.roundFrom?`Vòng hiện tại từ ${when(live.roundFrom)}`:'Từ đầu cuộc thi',rows:live.rows,groups:live.groups}];
  for(const s of board.snapshots)list.push({id:s.id,title:s.name,sub:`${when(s.at)}${s.createdBy?` · ${s.createdBy}`:''}`,rows:s.rows,groups:s.groups});
  return list;
 }
 function ranked(rows){return [...rows].sort((a,b)=>b[sort]-a[sort]||b[sort==='total'?'round':'total']-a[sort==='total'?'round':'total']||String(a.talentName||a.profileName).localeCompare(String(b.talentName||b.profileName)))}
 function nums(row){const box=el('div','nums');for(const [key,label] of [['round','Vòng'],['total','Tổng']]){box.append(el('span','',label));box.append(el('b',key===sort?'sorted':'',fmt(row[key])))}return box}
 function list(title,rows,group){
  const wrap=el('div',group?'groups':'talents');wrap.append(el('div','section-title',title));const ol=el('ol','rows');
  if(!rows.length)ol.append(el('li','empty','Chưa có dữ liệu'));
  ranked(rows).forEach((row,i)=>{const li=el('li',`row${i<3?` top${i+1}`:''}`);li.append(el('span','rank',String(i+1)));const name=group?row.profileName:row.talentName;
   if(!group)li.append(el('span','avatar',Array.from(name||'?')[0]||'?'));
   const who=el('div','who');who.append(el('b','',name||'—'));if(!group)who.append(el('small','',row.profileName||''));li.append(who,nums(row));ol.append(li)});
  wrap.append(ol);return wrap;
 }
 function renderPages(){
  const all=pages(),sig=JSON.stringify([sort,board.canSnapshot,board.admin,all]);if(sig===pageSig)return;pageSig=sig;
  const box=$('pages'),dots=$('dots');box.replaceChildren();dots.replaceChildren();
  all.forEach((p,i)=>{
   const page=el('article',`page${p.live?' live':''}`);page.dataset.id=p.id;page.setAttribute('aria-label',p.title);
   const head=el('div','page-head'),titles=el('div'),h=el('h2','page-title');if(p.live)h.append(el('span','live-dot'));h.append(document.createTextNode(p.title));titles.append(h,el('div','page-sub',p.sub));head.append(titles);
   if(!p.live&&(board.canSnapshot||board.admin)){const actions=el('div','page-actions');
    if(board.canSnapshot){const b=el('button','','Đổi tên');b.type='button';b.dataset.rename=p.id;actions.append(b)}
    if(board.admin){const b=el('button','danger','Xóa');b.type='button';b.dataset.remove=p.id;actions.append(b)}
    head.append(actions)}
   const body=el('div','page-body');body.append(list('Xếp hạng talent',p.rows,false),list('Tổng theo nhóm',p.groups,true));page.append(head,body);box.append(page);
   const dot=el('button');dot.type='button';dot.setAttribute('aria-label',p.title);dot.dataset.page=String(i);dots.append(dot);
  });
  const index=Math.max(0,all.findIndex(p=>p.id===current));current=all[index].id;
  box.style.scrollBehavior='auto';box.scrollLeft=box.children[index].offsetLeft;box.style.scrollBehavior='';markDots(index);
 }
 function indexNow(){const box=$('pages');let best=0,gap=Infinity;[...box.children].forEach((c,i)=>{const d=Math.abs(c.offsetLeft-box.scrollLeft);if(d<gap){gap=d;best=i}});return best}
 function markDots(index){[...$('dots').children].forEach((d,i)=>d.setAttribute('aria-current',String(i===index)));$('prev-page').disabled=index===0;$('next-page').disabled=index>=$('pages').children.length-1}
 function go(index){const box=$('pages'),page=box.children[Math.max(0,Math.min(index,box.children.length-1))];if(page)box.scrollTo({left:page.offsetLeft,behavior:'smooth'})}
 let scrollFrame=0;$('pages').addEventListener('scroll',()=>{cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(()=>{const i=indexNow(),page=$('pages').children[i];if(page)current=page.dataset.id;markDots(i)})});
 $('pages').addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();go(indexNow()+1)}else if(e.key==='ArrowLeft'){e.preventDefault();go(indexNow()-1)}});
 $('prev-page').addEventListener('click',()=>go(indexNow()-1));$('next-page').addEventListener('click',()=>go(indexNow()+1));
 $('dots').addEventListener('click',e=>{const b=e.target.closest('button[data-page]');if(b)go(Number(b.dataset.page))});
 document.querySelector('.sort').addEventListener('click',e=>{const b=e.target.closest('button[data-sort]');if(!b)return;sort=b.dataset.sort;for(const x of document.querySelectorAll('.sort button'))x.setAttribute('aria-pressed',String(x===b));if(board)renderPages()});
 $('pages').addEventListener('click',async e=>{
  const rename=e.target.closest('button[data-rename]'),remove=e.target.closest('button[data-remove]');
  if(rename){const snap=board.snapshots.find(s=>s.id===rename.dataset.rename);if(snap)openDialog({mode:'rename',id:snap.id,value:snap.name})}
  if(remove){const snap=board.snapshots.find(s=>s.id===remove.dataset.remove);if(!snap||!confirm(`Xóa snapshot "${snap.name}"?`))return;
   try{await call(api(`/snapshots/${snap.id}/delete`),{method:'POST',body:{}});toast('Đã xóa snapshot');pageSig='';await loadBoard()}catch(err){toast(errorText(err))}}
 });
 function openDialog({mode,id,value}){dialogMode={mode,id};$('name-title').textContent=mode==='create'?'Chụp snapshot':'Đổi tên snapshot';$('name-input').value=value||'';$('name-dialog').showModal();$('name-input').select()}
 $('snapshot-button').addEventListener('click',()=>openDialog({mode:'create',value:`Vòng ${(board?.snapshots.length||0)+1}`}));
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
