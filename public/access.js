'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const words={
  en:{title:'Private leaderboard',language:'Language',intro:'Only approved browsers can view company rankings.',setupTitle:'Google sign-in is not configured yet',setupBody:'An administrator needs to configure Google OAuth on the server. Rankings remain locked until setup is complete.',approvedTitle:'This browser has access',approvedBody:'You can open the leaderboard on this browser.',open:'Open leaderboard',tvLabel:'TV / VIEWER',pairTitle:'Request access for this browser',pairBody:'Generate a code and ask an administrator to approve it from their phone or computer.',generate:'Generate pairing code',pairWait:'Keep this page open. The leaderboard opens automatically after approval.',adminLabel:'ADMINISTRATOR',loginTitle:'Approve and manage devices',loginBody:'Sign in with an authorized Google account. Google sign-in is not needed on the TV.',google:'Sign in with Google',accountHint:'Only accounts authorized by Helios Talent can manage access.',manageTitle:'Device access',approveTitle:'Approve a new browser',approveHint:'Check the code on the TV or device you intend to authorize before approving.',codeLabel:'Pairing code',nameLabel:'Device name',approve:'Approve browser',devicesTitle:'Approved browsers',refresh:'Refresh list',privacy:'Approval applies to this browser, not the entire physical device. Do not share an approved browser with unauthorized people.',logout:"Sign out / remove this browser's access",expires:'Code expires at',expired:'This code has expired. Generate a new code.',none:'No approved browsers yet.',lastSeen:'Last seen',accessExpires:'Access expires',unknown:'Not available',revoke:'Revoke access',confirmRevoke:'Revoke access for',approved:'Browser approved.',revoked:'Access revoked.',loggedOut:'Signed out. This browser no longer has access.',error:'Unable to complete the request. Please try again.',offline:'Cannot verify access with the server. Rankings remain locked.',invalid:'The code is invalid or expired. Check the code and try again.',forbidden:'Access denied. Sign in with an authorized administrator account.',limited:'Too many attempts. Please wait a minute before trying again.'},
  vi:{title:'Bảng xếp hạng nội bộ',language:'Ngôn ngữ',intro:'Chỉ trình duyệt được duyệt mới xem được bảng xếp hạng công ty.',setupTitle:'Chưa cấu hình đăng nhập Google',setupBody:'Quản trị viên cần cấu hình Google OAuth trên máy chủ. Dữ liệu vẫn bị khóa cho đến khi hoàn tất thiết lập.',approvedTitle:'Trình duyệt này đã được cấp quyền',approvedBody:'Bạn có thể mở bảng xếp hạng trên trình duyệt này.',open:'Mở bảng xếp hạng',tvLabel:'TV / NGƯỜI XEM',pairTitle:'Xin cấp quyền cho trình duyệt này',pairBody:'Tạo mã rồi nhờ quản trị viên duyệt mã bằng điện thoại hoặc máy tính.',generate:'Tạo mã ghép nối',pairWait:'Giữ trang này mở. Bảng xếp hạng sẽ tự mở sau khi được duyệt.',adminLabel:'QUẢN TRỊ VIÊN',loginTitle:'Duyệt và quản lý thiết bị',loginBody:'Đăng nhập bằng tài khoản Google được cấp quyền. TV không cần đăng nhập Google.',google:'Đăng nhập bằng Google',accountHint:'Chỉ tài khoản được Helios Talent cho phép mới quản lý được quyền truy cập.',manageTitle:'Quyền truy cập thiết bị',approveTitle:'Duyệt trình duyệt mới',approveHint:'Đối chiếu mã trên đúng TV hoặc thiết bị bạn muốn cấp quyền trước khi duyệt.',codeLabel:'Mã ghép nối',nameLabel:'Tên thiết bị',approve:'Duyệt trình duyệt',devicesTitle:'Trình duyệt đã được duyệt',refresh:'Tải lại danh sách',privacy:'Quyền áp dụng cho trình duyệt này, không phải toàn bộ thiết bị. Không dùng chung trình duyệt đã được duyệt với người không có quyền.',logout:'Đăng xuất / bỏ quyền của trình duyệt này',expires:'Mã hết hạn lúc',expired:'Mã đã hết hạn. Vui lòng tạo mã mới.',none:'Chưa có trình duyệt nào được duyệt.',lastSeen:'Truy cập gần nhất',accessExpires:'Quyền hết hạn',unknown:'Chưa có thông tin',revoke:'Thu hồi quyền',confirmRevoke:'Thu hồi quyền của',approved:'Đã duyệt trình duyệt.',revoked:'Đã thu hồi quyền.',loggedOut:'Đã đăng xuất. Trình duyệt này không còn quyền truy cập.',error:'Không thực hiện được yêu cầu. Vui lòng thử lại.',offline:'Không xác minh được quyền với máy chủ. Dữ liệu vẫn bị khóa.',invalid:'Mã không đúng hoặc đã hết hạn. Vui lòng kiểm tra và thử lại.',forbidden:'Không có quyền. Hãy đăng nhập tài khoản quản trị được cho phép.',limited:'Quá nhiều lần thử. Vui lòng chờ một phút rồi thử lại.'}
 };
 let language='en',status=null,csrf='',pair=null,devices=[],deviceSignature='',busy=false,polling=false,notice='';
 try{language=localStorage.getItem('helios_access_language')==='vi'?'vi':'en'}catch{}
 const t=key=>words[language][key]||key;
 function message(key){notice=key;$('access-message').textContent=key?t(key):''}
 function date(value){const d=new Date(value);return value&&Number.isFinite(+d)?d.toLocaleString(language==='vi'?'vi-VN':'en-GB'):t('unknown')}
 function renderPair(){
  $('pair-details').hidden=!pair;if(!pair)return;
  $('pair-code').textContent=pair.code;
  $('pair-expiry').textContent=Date.now()>=Date.parse(pair.expiresAt)?t('expired'):t('expires')+' '+date(pair.expiresAt);
 }
 function renderDevices(){
  const signature=JSON.stringify([devices,language]);if(signature===deviceSignature)return;deviceSignature=signature;
  const list=$('device-list');list.replaceChildren();
  if(!devices.length){const empty=document.createElement('p');empty.textContent=t('none');list.append(empty);return}
  for(const device of devices){
   const row=document.createElement('article');row.className='device';const info=document.createElement('div');info.className='device-info';
   const name=document.createElement('div');name.className='device-name';name.textContent=device.name;
   const meta=document.createElement('p');meta.className='device-meta';meta.textContent=t('lastSeen')+': '+date(device.lastSeen)+' · '+t('accessExpires')+': '+date(device.expiresAt);
   const button=document.createElement('button');button.type='button';button.textContent=t('revoke');button.setAttribute('aria-label',t('revoke')+' '+device.name);
   button.onclick=()=>run(async()=>{if(!confirm(t('confirmRevoke')+' “'+device.name+'”?'))return;await request('/auth/revoke',{id:device.id});message('revoked');await refreshDevices()});
   info.append(name,meta);row.append(info,button);list.append(row);
  }
 }
 function render(){
  document.documentElement.lang=language;document.title='Helios Talent · '+t('title');$('access-language').value=language;
  document.querySelectorAll('[data-text]').forEach(el=>el.textContent=t(el.dataset.text));
  const ready=Boolean(status&&!status.setupRequired),admin=Boolean(status?.admin),authorized=Boolean(status?.authorized);
  $('setup-notice').hidden=!status?.setupRequired;$('admin-panel').hidden=!admin;$('login-panel').hidden=admin;
  $('pair-panel').hidden=authorized;$('viewer-panel').hidden=!authorized||admin;$('access-logout').hidden=!authorized;
  $('request-pair').disabled=!ready||busy;$('google-login').setAttribute('aria-disabled',String(!ready));
  $('admin-email').textContent=admin?(status.email||''):'';
  $('approve-device').disabled=!admin||busy;$('reload-devices').disabled=!admin||busy;
  $('access-message').textContent=notice?t(notice):'';renderPair();renderDevices();
 }
 async function request(url,body){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
   if(!response.ok){const error=new Error('access request denied');error.status=response.status;throw error}
   return await response.json();
  }finally{clearTimeout(timeout)}
 }
 async function run(action){
  if(busy)return;busy=true;render();
  try{await action()}catch(error){message(error.status===400?'invalid':[401,403].includes(error.status)?'forbidden':error.status===429?'limited':'error')}
  finally{busy=false;render()}
 }
 async function refreshDevices(){
  if(!status?.admin)return;const payload=await request('/auth/devices');devices=Array.isArray(payload.devices)?payload.devices:[];renderDevices();
 }
 async function refreshStatus(){
  if(polling||busy)return;polling=true;
  try{
   status=await request('/auth/status');csrf=status.csrf||'';
   if(!status.admin){devices=[];deviceSignature=''}
   if(notice==='offline')message('');render();
   if(pair&&status.authorized&&!status.admin){location.replace('/');return}
   if(status.admin)await refreshDevices();
  }catch{status=null;csrf='';devices=[];deviceSignature='';message('offline');render()}
  finally{polling=false}
 }
 $('access-language').onchange=event=>{language=event.target.value==='vi'?'vi':'en';try{localStorage.setItem('helios_access_language',language)}catch{}render()};
 $('google-login').onclick=event=>{if(!status||status.setupRequired)event.preventDefault()};
 $('request-pair').onclick=()=>run(async()=>{const value=await request('/auth/pair',{});if(typeof value.code!=='string'||!Number.isFinite(Date.parse(value.expiresAt)))throw Error('invalid pairing response');pair=value;message('')});
 $('approval-form').onsubmit=event=>{event.preventDefault();run(async()=>{await request('/auth/approve',{code:$('approval-code').value.trim().toUpperCase(),name:$('device-name').value.trim()});$('approval-code').value='';$('device-name').value='';message('approved');await refreshDevices()})};
 $('reload-devices').onclick=()=>run(refreshDevices);
 $('access-logout').onclick=()=>run(async()=>{
  await request('/auth/logout',{});
  try{for(const key of Object.keys(localStorage))if(key.startsWith('helios_leaderboard_')||key==='leaderboard_config')localStorage.removeItem(key)}catch{}
  pair=null;devices=[];status=await request('/auth/status');csrf=status.csrf||'';message('loggedOut');
 });
 render();refreshStatus();setInterval(refreshStatus,5000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshStatus()});
})();
