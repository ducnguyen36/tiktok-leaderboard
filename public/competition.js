'use strict';
// Competition score page: access request -> wait for approval -> swipeable LIVE + snapshot pages.
// Every name comes from users or HeliosControl, so the DOM is built with textContent only.
(()=>{
 const slug=location.pathname.replace(/^\/+|\/+$/g,''),api=p=>`/api/competitions/${encodeURIComponent(slug)}${p}`,$=id=>document.getElementById(id);
 const number=new Intl.NumberFormat('vi-VN'),hhmm=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hour12:false}),clock=new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
 // Negative scores (manual corrections) use a true minus sign U+2212; unknown values (old snapshots) show an en dash.
 const fmt=n=>n==null?'–':(Number(n)<0?'−':'')+number.format(Math.abs(Number(n)||0)),when=v=>v==null?'':clock.format(new Date(v));
 const VIEWS=['loading-view','missing-view','request-view','pending-view','board-view'],MODES={competition:'Cuộc thi',overall:'Tổng cộng'};
 // Per-browser view preferences; storage can be unavailable (private mode, blocked site data).
 const stored=key=>{try{return localStorage.getItem(`heliosComp.${key}`)}catch{return null}},store=(key,value)=>{try{localStorage.setItem(`heliosComp.${key}`,value)}catch{}};
 let board=null,csrf='',mode=MODES[stored('mode')]?stored('mode'):'competition',showGroups=stored('groups')==='1',showOut=stored('out')!=='0',standingsPref=stored('standings'),showAdmin=false,timer=0,current='live',pageSig='',adminSig='',dialogMode=null,toastTimer=0;
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
  let data;try{data=await call(api('/board'))}catch(e){if(e.status===401||e.status===403){board=null;$('admin-view').hidden=true;$('admin-toggle').hidden=true;return refresh()}toast('Mất kết nối, đang thử lại…');return schedule(10000)}
  board=data;header(data.competition);$('updated').textContent=`Cập nhật ${when(data.live.at)}`;$('snapshot-button').hidden=!data.canSnapshot;show('board-view');renderPages();
  if(data.admin){if(!csrf)await loadCsrf();loadRequests()}
  schedule(10000);
 }
 async function loadCsrf(){try{csrf=(await call('/auth/status')).csrf||''}catch{csrf=''}}
 // gone = talents out since before the snapshot preceding this page (newest first): they left in an earlier
 // round. Someone revived and eliminated again after that snapshot went out in this round, so is not gone.
 const outNames=snap=>{const gone=new Set();for(const r of snap?.rows||[])if(r.eliminated)gone.add(r.talentName);gone.at=snap?.at??null;gone.outAt=new Map((snap?.rows||[]).filter(r=>r.eliminated).map(r=>[r.talentName,r.eliminatedAt||null]));return gone};
 const isGone=(page,row)=>{if(!row.eliminated||!page.gone.has(row.talentName))return false;const before=page.gone.outAt.get(row.talentName),now=row.eliminatedAt;return !(before&&now&&Date.parse(now)>Date.parse(before))};
 // PK tables by score (this page's ranking, high first; ties keep the app's order); cut = the lower table
 // after its top takeLower (or the app's cut when no takeLower).
 function pkTables(pk,rows){
  const t=pk.tables,scores=new Map((rows||[]).map(r=>[r.talentName,Number(r.competition)||0]));
  const byScore=list=>list.map((n,i)=>[n,i]).sort((a,b)=>(scores.has(b[0])?scores.get(b[0]):-Infinity)-(scores.has(a[0])?scores.get(a[0]):-Infinity)||a[1]-b[1]).map(([n])=>n);
  // HeliosControl's say by hand: forceIn goes on first, forceOut gives her place (last)
  const fin=(pk.forceIn||[]).filter(n=>t.lower.includes(n)),fout=(pk.forceOut||[]).filter(n=>t.lower.includes(n)&&!fin.includes(n)),sorted=byScore(t.lower);
  const upper=byScore(t.upper),lower=fin.length||fout.length?[...fin,...sorted.filter(n=>!fin.includes(n)&&!fout.includes(n)),...fout]:sorted;
  const cut=pk.takeLower!=null?new Set(lower.slice(pk.takeLower)):fout.length?new Set(fout):new Set(t.cut);
  return{upper,lower,cut,scores};
 }
 // Once every PK match is done, the talents cut from the lower table count as out on this page before the
 // app's ✂ writes them to eliminated: always shown, dimmed at the bottom (not behind the eye).
 function withPkCut(rows,pk){
  if(!pk?.tables||pk.phase==='setup'||!pk.matches?.length||pk.matches.some(m=>m.status!=='done'))return rows;
  const{cut}=pkTables(pk,rows);if(!cut.size)return rows;
  return rows.map(r=>!r.eliminated&&cut.has(r.talentName)?{...r,eliminated:true,pkCut:true}:r);
 }
 function pages(){
  const live=board.live,snaps=board.snapshots,list=[{id:'live',live:true,title:'LIVE',sub:'Cộng dồn từ đầu cuộc thi',rows:withPkCut(live.rows,live.pkStage),groups:live.groups,gone:outNames(snaps[0]),pk:live.pkStage||null,rounds:live.rounds||null,standing:live.standing||null}];
  snaps.forEach((s,i)=>list.push({id:s.id,title:s.name,sub:`${when(s.at)}${s.createdBy?` · ${s.createdBy}`:''}`,rows:withPkCut(s.rows,s.pkStage),groups:s.groups,gone:outNames(snaps[i+1]),pk:s.pkStage||null,rounds:s.rounds||null,standing:s.standing||null}));
  return list;
 }
 // "Cuộc thi": talents out since an earlier round are gone; those out in this round show dimmed at the bottom
 // by default (the eye hides them, remembered per viewer). "Tổng cộng" (revenue) lists everyone normally.
 // "Bảng chung cuộc" (podium): the provisional final standings, everyone 1..N with every eliminated talent
 // below those still in (by elimination order). On by default once the competition has ended.
 const standingsOn=()=>standingsPref==null?board?.competition?.status==='ended':standingsPref==='1';
 const roundOut=(page,row)=>mode==='competition'&&row.eliminated&&(standingsOn()||!isGone(page,row));
 function talentRows(page){return mode!=='competition'||standingsOn()?page.rows:page.rows.filter(r=>!isGone(page,r)&&(showOut||!r.eliminated||r.pkCut))}
 // Sorted by the selected mode; unknown values (old snapshots in "Tổng cộng") go last.
 const value=(row,key=mode)=>row[key]==null?-Infinity:Number(row[key])||0,other=()=>mode==='competition'?'overall':'competition';
 function ranked(rows){return [...rows].sort((a,b)=>value(b)-value(a)||value(b,other())-value(a,other())||String(a.talentName||a.profileName).localeCompare(String(b.talentName||b.profileName)))}
 function score(row){const v=row[mode];return el('b',`score${v!=null&&Number(v)<0?' neg':''}`,fmt(v))}
 // The number column is the final placing. Players still competing rank by score; eliminated ones (eye on)
 // follow, the latest out (their most recent 'out') first; same moment: the rank they went out at (HeliosControl's
 // panel position, or the server's fallback by score at that moment), then score. Groups count everyone.
 const outTime=row=>{const t=Date.parse(row.eliminatedAt||'');return Number.isFinite(t)?t:-Infinity};
 const outRank=row=>Number.isInteger(row.eliminatedRank)&&row.eliminatedRank>0?row.eliminatedRank:null;
 // HeliosControl's Top dưới (standing group 'lower', e.g. the revived who skip the solo): below Top trên, each by score
 const lowerNames=page=>new Set((page?.standing?.rows||[]).filter(r=>r.group==='lower').map(r=>r.talentName));
 function tiered(rows,page){const low=lowerNames(page);if(!low.size)return ranked(rows);return [...ranked(rows.filter(r=>!low.has(r.talentName))),...ranked(rows.filter(r=>low.has(r.talentName)))]}
 function placed(rows,page,group){
  if(group||mode!=='competition')return ranked(rows);
  const out=rows.filter(r=>roundOut(page,r)).sort((a,b)=>outTime(b)-outTime(a)||(outRank(a)??Infinity)-(outRank(b)??Infinity)||value(b)-value(a)||String(a.talentName).localeCompare(String(b.talentName)));
  return [...tiered(rows.filter(r=>!roundOut(page,r)),page),...out];
 }
 function list(title,rows,group,page){
  const wrap=el(group?'aside':'div',group?'groups':'talents');if(group)wrap.setAttribute('aria-label',title);
  const head=el('div','section-head');head.append(el('div','section-title',`${title} · ${MODES[mode]}`));
  // Σ the whole competition (every talent, the eliminated too) in the mode shown
  const sum=rows.reduce((n,r)=>n+(r[mode]==null?0:Number(r[mode])||0),0),tot=el('span','section-total');tot.append('Tổng ',el('b','',fmt(sum)),' 💎');tot.title=`Tổng ${MODES[mode]} của cả cuộc thi (mọi talent, kể cả người bị loại)`;head.append(tot);wrap.append(head);
  const visible=group?rows:talentRows(page);
  const ol=el('ol','rows');if(!visible.length)ol.append(el('li','empty',rows.length?'Tất cả đã bị loại':'Chưa có dữ liệu'));
  placed(visible,page,group).forEach((row,i)=>{const isOut=!group&&roundOut(page,row),rank=i+1;// Eliminated rows are dimmed while the competition runs; the final standings of an ended one show everyone clearly.
   const dim=isOut&&board.competition?.status!=='ended',li=el('li',`row${dim?' out':isOut?' out-final':''}${!isOut&&rank<=3?` top${rank}`:''}`);li.append(el('span','rank',String(rank)));const name=group?row.profileName:row.talentName;
   if(!group)li.append(el('span','avatar',Array.from(name||'?')[0]||'?'));
   const who=el('div','who');who.append(el('b','',name||'—'));if(!group){const sub=el('small','',row.profileName||'');if(isOut){const at=row.eliminatedAt?hhmm.format(new Date(row.eliminatedAt)):'',tag=el('span','out-tag',row.pkCut?'✂ Bị cắt (Vòng PK)':`Bị loại${row.eliminatedRound?` · ${row.eliminatedRound}`:''}${at?` · ${at}`:''}${row.revives?` ↺${row.revives}`:''}`);
     tag.title=[row.eliminatedAt?`Bị loại lúc ${when(row.eliminatedAt)}`:'',row.eliminatedRound?`vòng ${row.eliminatedRound}`:'',row.revives?`đã hồi sinh ${row.revives} lần`:''].filter(Boolean).join(' · ');sub.prepend(tag)}
     // Revived and back in: the ↺ mark stays on the row.
     else if(row.revives){const tag=el('span','revive-tag',`↺${row.revives>1?row.revives:''}`);tag.title=`Đã hồi sinh ${row.revives} lần`;tag.setAttribute('aria-label',tag.title);sub.prepend(tag)}who.append(sub)}li.append(who,score(row));ol.append(li)});
  wrap.append(ol);return wrap;
 }
 // ---- PK stage (competitions.pkStage, see the PK stage contract and the organiser's update) ----
 // One competition = one track: tables, voting order and cut are this competition's own.
 const PHASES={setup:'Chuẩn bị PK',pk:'Đang PK',voting:'Đang bình chọn',chasing:'Rượt điểm',done:'Đã xong PK'};
 const MATCH_STATUS={pending:'Chờ',running:'Đang đấu',reviving:'Hồi sinh',done:'Xong'};
 const REVIVE_MODE={gap:'theo chênh lệch',fixed:'số cố định',formula:'theo công thức',manual:'MC chấm'};
 const pkLeads=pk=>['setup','pk','voting'].includes(pk.phase);
 // Open/closed sections survive the 10 s refresh (kept per section kind, the same on every page).
 const opened=new Map();
 function fold(key,title,defaultOpen,content,extra){
  const d=el('details',`pk-fold ${key}`),s=el('summary');s.append(el('span','fold-title',title));if(extra)s.append(extra);d.append(s,content);
  d.open=opened.has(key)?opened.get(key):defaultOpen;d.addEventListener('toggle',()=>opened.set(key,d.open));return d;
 }
 const reviveText=r=>`Hồi sinh${r.round?` (hủy ván ${r.round})`:''}: ${r.success===true?'thành công':r.success===false?'thất bại':'đang chờ'}${r.target!=null?` · mục tiêu ${fmt(r.target)} 💎`:''}${r.mode?` · ${REVIVE_MODE[r.mode]}`:''}`;
 const reviveSign=r=>r.success===true?'✓':r.success===false?'✗':'…',reviveCls=r=>`rv ${r.success===true?'ok':r.success===false?'fail':'wait'}`;
 function reviveMarks(m,name){
  const box=el('span','m-marks');
  for(const r of m.revives.filter(r=>r.talentName===name)){const mark=el('span',reviveCls(r),`↺${reviveSign(r)}`);mark.title=reviveText(r);mark.setAttribute('aria-label',mark.title);box.append(mark)}
  return box;
 }
 // Round history: "V1 RYAN", a tie "V2 hòa – đánh lại", a round cancelled by a revive struck through "↺ name".
 function roundsLine(m){
  const line=el('div','m-rounds');
  for(const r of m.rounds){const chip=el('span',`m-round${r.winner?'':' tie'}${r.cancelledByRevive?' cancelled':''}`);
   chip.append(el('span','m-rn',`V${r.n}`));
   if(r.winner){const w=el(r.cancelledByRevive?'s':'span','m-rw',r.winner);chip.append(w)}else chip.append(el('span','m-rw','hòa – đánh lại'));
   if(r.cancelledByRevive)chip.append(el('span','rv ok',`↺ ${r.cancelledByRevive}`));
   const d=Object.entries(r.diamonds||{});chip.title=[`Ván ${r.n}`,r.winner?`${r.winner} thắng`:`hòa${r.tied.length?`: ${r.tied.join(', ')}`:''}`,...d.map(([n,v])=>`${n} ${fmt(v)} 💎`),r.cancelledByRevive?`bị hủy do ${r.cancelledByRevive} hồi sinh`:''].filter(Boolean).join(' · ');
   line.append(chip)}
  return line;
 }
 // Round by round with each talent's diamonds (when the app sent them): the winner's cell lit,
 // a tie marked "hòa", a round cancelled by a revive struck through with ↺. Talents in match order.
 function roundsTable(m){
  const short=n=>Array.from(n||'').slice(0,9).join(''),tbl=el('table','m-scores'),head=el('tr');
  head.append(el('th','m-rn','Ván'));for(const n of m.talents){const th=el('th','',short(n));th.title=n;head.append(th)}
  const thead=el('thead');thead.append(head);const tb=el('tbody');
  for(const r of m.rounds){const tr=el('tr',`${r.winner?'':'tie'}${r.cancelledByRevive?' cancelled':''}`);
   const rn=el('th','m-rn',`V${r.n}${r.winner?'':' hòa'}`);if(r.cancelledByRevive)rn.append(el('span','rv ok',`↺`));tr.append(rn);
   for(const n of m.talents){const v=r.diamonds?.[n],won=r.winner===n,tied=!r.winner&&r.tied.includes(n);
    tr.append(el('td',won?(v!=null?'w':'w w0'):tied?'t':'',v!=null?fmt(v):won?'✓':'—'))}
   const d=Object.entries(r.diamonds||{});tr.title=[`Ván ${r.n}`,r.winner?`${r.winner} thắng`:`hòa${r.tied.length?`: ${r.tied.join(', ')}`:''} – đánh lại`,...d.map(([n,v])=>`${n} ${fmt(v)} 💎`),r.cancelledByRevive?`bị hủy do ${r.cancelledByRevive} hồi sinh`:''].filter(Boolean).join(' · ');
   tb.append(tr)}
  tbl.append(thead,tb);const wrap=el('div','m-scores-wrap');wrap.append(tbl);return wrap;
 }
 function matchCard(m){
  const card=el('div',`match ${m.status}`);card.dataset.match=m.id;
  const head=el('div','m-head');head.append(el('span','m-id',m.id),el('span','m-score',m.talents.map(n=>m.points[n]??0).join('–')),el('span',`m-status ${m.status}`,MATCH_STATUS[m.status]||''));card.append(head);
  const ul=el('ul','m-talents'),done=m.status==='done'&&m.winner;
  for(const n of m.talents){const won=m.winner===n,lost=done&&!won,li=el('li',won?'win':lost?'lose':'');
   li.append(el('span','m-name',n),reviveMarks(m,n),el('b','m-pt',String(m.points[n]??0)));if(won)li.title='Thắng trận';ul.append(li)}
  card.append(ul);if(m.rounds.length)card.append(m.rounds.some(r=>Object.keys(r.diamonds||{}).length)?roundsTable(m):roundsLine(m));
  // Revive chases with their target (when known).
  for(const r of m.revives){const line=el('div',`m-revive ${r.success===true?'ok':r.success===false?'fail':'wait'}`);line.title=reviveText(r);
   line.append(el('span','',`↺ ${r.talentName}`),el('b','',reviveSign(r)));if(r.target!=null)line.append(el('small','',`${fmt(r.target)} 💎`));else if(r.mode==='manual')line.append(el('small','','MC'));card.append(line)}
  return card;
 }
 function matchesView(pk){
  const box=el('div','pk-tracks'),ids=pk.tracks.map(t=>t.id);for(const m of pk.matches)if(m.track&&!ids.includes(m.track))ids.push(m.track);
  const groups=ids.map(id=>({id,label:pk.tracks.find(t=>t.id===id)?.label||`Track ${id}`,matches:pk.matches.filter(m=>m.track===id)})).filter(g=>g.matches.length);
  const loose=pk.matches.filter(m=>!m.track||!ids.includes(m.track));if(loose.length)groups.push({id:'',label:groups.length?'Trận khác':'',matches:loose});
  for(const g of groups){const t=el('section','pk-track');
   if(g.label||groups.length>1){const h=el('div','track-head');h.append(el('b','',g.label||'Các trận'),el('span','track-count',`${g.matches.filter(m=>m.status==='done').length}/${g.matches.length} xong`));t.append(h)}
   const grid=el('div','match-grid');[...g.matches].sort((a,b)=>(a.order??999)-(b.order??999)).forEach(m=>grid.append(matchCard(m)));t.append(grid);box.append(t)}
  return box;
 }
 function revivedSet(pk){const s=new Set();for(const m of pk.matches)for(const r of m.revives)if(r.success===true)s.add(r.talentName);return s}
 function tableList(cls,title,names,pk,{cutAt=null,cut=new Set(),scores=null,note=''}={}){
  const box=el('div',`pk-table ${cls}`),revived=revivedSet(pk),head=el('div','table-head',`${title} · ${names.length}`);if(note)head.append(el('small','table-note',note));box.append(head);
  const ol=el('ol','table-rows');if(!names.length)ol.append(el('li','empty','Chưa có'));
  names.forEach((n,i)=>{
   if(cutAt!=null&&i===cutAt){const line=el('li','cut-line',`✂ Top ${cutAt} đi tiếp`);line.setAttribute('role','separator');ol.append(line)}
   const isCut=cut.has(n),li=el('li',isCut?'cut':'');li.append(el('span','t-no',String(i+1)),el('span','t-name',n));
   if(revived.has(n)){const r=el('span','rv ok','↺');r.title='Đã hồi sinh';li.append(r)}
   if(scores&&scores.has(n))li.append(el('span','t-score',fmt(scores.get(n))));
   if(isCut){const c=el('span','cut-mark','✂');c.title='Bị cắt';c.setAttribute('aria-label','Bị cắt');li.append(c)}
   ol.append(li)});
  box.append(ol);return box;
 }
 // Both tables by score (this page's ranking, high first; ties keep the app's order), so the
 // board matches the points whatever order the app seeded the stage in; the cut line sits after
 // the top takeLower of the lower table and the talents below it are marked ✂.
 function tablesView(pk,rows){
  const{upper,lower,cut,scores}=pkTables(pk,rows);
  let cutAt=pk.takeLower!=null&&lower.length>pk.takeLower?pk.takeLower:null;
  if(cutAt==null&&cut.size){const i=lower.findIndex(n=>cut.has(n));if(i>=0)cutAt=i}
  const box=el('div','pk-tables');box.append(tableList('upper','Bảng thắng',upper,pk,{scores,note:'theo điểm'}),tableList('lower','Bảng thua',lower,pk,{cutAt,cut,scores,note:'theo điểm'}));return box;
 }
 function votingView(pk){
  const v=pk.voting,done=new Set(v.done),box=el('div','pk-voting'),ol=el('ol','vote-order');
  v.order.forEach((n,i)=>{const isDone=done.has(n),isNow=v.current===n&&!isDone,li=el('li',isNow?'current':isDone?'done':'');
   li.append(el('span','t-no',String(i+1)),el('span','t-name',n));if(isDone)li.append(el('span','vote-done','✓'));if(isNow){li.setAttribute('aria-current','step');li.title='Đang bình chọn'}ol.append(li)});
  box.append(ol);return box;
 }
 function pkView(pk,rows){
  const wrap=el('section',`pk-board ph-${pk.phase}`),head=el('div','pk-head');
  head.append(el('span','section-title pk-title','Vòng PK'),el('span',`pk-phase ph-${pk.phase}`,PHASES[pk.phase]||''),el('span','pk-rule',`Thắng ${pk.firstTo} điểm${pk.takeLower!=null?` · bảng thua lấy top ${pk.takeLower} theo điểm`:''}`));
  wrap.append(head);
  const leads=pkLeads(pk);
  if(pk.phase==='voting'&&pk.voting&&pk.voting.order.length){const v=pk.voting;wrap.append(fold('pk-voting-fold','Thứ tự bình chọn',true,votingView(pk),el('span','fold-count',`${v.done.length}/${v.order.length} xong`)))}
  if(pk.matches.length){const running=pk.matches.filter(m=>m.status==='running'||m.status==='reviving').length,count=el('span','fold-count',running?`${running} đang đấu`:`${pk.matches.filter(m=>m.status==='done').length}/${pk.matches.length} xong`);
   wrap.append(fold('pk-matches-fold','Trận đấu',pk.phase==='pk'||pk.phase==='setup',matchesView(pk),count))}
  if(pk.tables&&(pk.tables.upper.length||pk.tables.lower.length))wrap.append(fold('pk-tables-fold','Bảng thắng · Bảng thua',leads,tablesView(pk,rows)));
  return wrap;
 }
 // "Bị loại theo vòng": HeliosControl's round labels, newest round first; talents revived since are marked ↺.
 function roundsView(rounds){
  const box=el('div','rounds');
  for(const g of rounds){const r=el('div','round'),h=el('div','round-head');h.append(el('b','',g.round),el('span','round-count',String(g.talents.length)));r.append(h);
   const names=el('div','round-names');for(const t of g.talents){const c=el('span',`round-name${t.back?' back':''}`);c.append(el('span','t-name',t.talentName));
    if(t.at)c.append(el('small','',hhmm.format(new Date(t.at))));if(t.back){const m=el('span','rv ok','↺');m.title='Đã hồi sinh, đang thi tiếp';m.setAttribute('aria-label',m.title);c.append(m)}names.append(c)}
   r.append(names);box.append(r)}
  return fold('rounds-fold','Bị loại theo vòng',true,box,el('span','fold-count',String(rounds.reduce((n,g)=>n+g.talents.length,0))));
 }
 function applyGroups(){$('board-view').classList.toggle('groups-on',showGroups);$('groups-toggle').setAttribute('aria-pressed',String(showGroups))}
 function applyMode(){for(const b of document.querySelectorAll('.modes button'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode))}
 function renderPages(){
  const all=pages(),sig=JSON.stringify([mode,showOut,standingsOn(),board.canSnapshot,board.admin,all]);if(sig===pageSig)return;pageSig=sig;
  const box=$('pages'),dots=$('dots');box.replaceChildren();dots.replaceChildren();
  all.forEach((p,i)=>{
   const page=el('article',`page${p.live?' live':''}`);page.dataset.id=p.id;page.setAttribute('aria-label',p.title);
   const head=el('div','page-head'),titles=el('div','page-titles'),row=el('div','title-row'),h=el('h2','page-title');if(p.live)h.append(el('span','live-dot'));h.append(document.createTextNode(p.title));row.append(h);
   // Rename: pencil right next to the name. Delete (admins): trash at the far right, away from it, and confirmed.
   if(!p.live&&board.canSnapshot)row.append(iconButton('pencil','Đổi tên snapshot',{rename:p.id}));
   titles.append(row,el('div','page-sub',p.sub));head.append(titles);
   if(!p.live&&board.admin)head.append(iconButton('trash','Xóa snapshot',{remove:p.id},'danger'));
   if(mode==='overall'&&p.rows.some(r=>r.overall==null))page.append(head,el('div','old-note','Snapshot cũ chưa lưu số Tổng cộng.'));else page.append(head);
   const body=el('div','page-body'),talents=list('Xếp hạng talent',p.rows,false,p);
   // PK stage: during setup/PK/voting the PK board leads; once chasing (or done) the score ranking is the main view.
   if(p.pk){const pk=pkView(p.pk,p.rows);if(pkLeads(p.pk))talents.prepend(pk);else talents.append(pk)}
   if(p.rounds&&mode==='competition')talents.append(roundsView(p.rounds));
   body.append(list('Tổng theo nhóm',p.groups,true),talents);page.append(body);box.append(page);
   const dot=el('button');dot.type='button';dot.setAttribute('aria-label',p.title);dot.dataset.page=String(i);dots.append(dot);
  });
  const index=Math.max(0,all.findIndex(p=>p.id===current));current=all[index].id;
  box.style.scrollBehavior='auto';box.scrollLeft=box.children[index].offsetLeft;box.style.scrollBehavior='';markDots(index);
 }
 function indexNow(){const box=$('pages');let best=0,gap=Infinity;[...box.children].forEach((c,i)=>{const d=Math.abs(c.offsetLeft-box.scrollLeft);if(d<gap){gap=d;best=i}});return best}
 // Eye count follows the page in view (LIVE or a snapshot taken when fewer/more were out).
 function applyOut(index=indexNow()){
  const page=board&&pages()[index],out=page?page.rows.filter(r=>roundOut(page,r)&&!r.pkCut).length:0,b=$('out-toggle');
  b.hidden=!out||standingsOn();const s=$('standings-toggle');s.hidden=mode!=='competition';s.setAttribute('aria-pressed',String(standingsOn()));
  $('out-count').textContent=String(out);b.setAttribute('aria-pressed',String(showOut));b.classList.toggle('on',showOut);
  const label=`${showOut?'Ẩn':'Hiện'} ${out} người bị loại`;b.setAttribute('aria-label',label);b.title=label;
 }
 function markDots(index){applyOut(index);[...$('dots').children].forEach((d,i)=>d.setAttribute('aria-current',String(i===index)));$('prev-page').disabled=index===0;$('next-page').disabled=index>=$('pages').children.length-1}
 function go(index){const box=$('pages'),page=box.children[Math.max(0,Math.min(index,box.children.length-1))];if(page)box.scrollTo({left:page.offsetLeft,behavior:'smooth'})}
 let scrollFrame=0;$('pages').addEventListener('scroll',()=>{cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(()=>{const i=indexNow(),page=$('pages').children[i];if(page)current=page.dataset.id;markDots(i)})});
 $('pages').addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();go(indexNow()+1)}else if(e.key==='ArrowLeft'){e.preventDefault();go(indexNow()-1)}});
 $('prev-page').addEventListener('click',()=>go(indexNow()-1));$('next-page').addEventListener('click',()=>go(indexNow()+1));
 $('dots').addEventListener('click',e=>{const b=e.target.closest('button[data-page]');if(b)go(Number(b.dataset.page))});
 document.querySelector('.modes').addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(!b||!MODES[b.dataset.mode])return;mode=b.dataset.mode;store('mode',mode);applyMode();if(board){renderPages();applyOut()}});
 $('standings-toggle').addEventListener('click',()=>{standingsPref=standingsOn()?'0':'1';store('standings',standingsPref);renderPages();applyOut()});
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
 function applyAdmin(){$('admin-view').hidden=!showAdmin;$('admin-toggle').setAttribute('aria-pressed',String(showAdmin))}
 $('admin-toggle').addEventListener('click',()=>{showAdmin=!showAdmin;applyAdmin()});
 async function loadRequests(){
  let data;try{data=await call(api('/requests'))}catch{return}
  // Admins only: the toolbar icon shows how many wait for approval and opens the panel under the toolbar.
  const pending=data.requests.filter(r=>r.status==='pending').length,badge=$('admin-pending');$('admin-toggle').hidden=false;badge.hidden=!pending;badge.textContent=String(pending);
  $('admin-toggle').setAttribute('aria-label',pending?`Quản lý người xem · ${pending} chờ duyệt`:'Quản lý người xem');applyAdmin();
  const sig=JSON.stringify(data.requests);if(sig===adminSig)return;adminSig=sig;
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
