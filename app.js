/* Lobit browser client. Access control is enforced in Supabase RLS, not here. */
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = (value) => new Date(value).toLocaleString('zh-TW', {dateStyle:'medium',timeStyle:'short'});
const localTime = () => { const d = new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
const say = (message, error=false) => { $('#message').textContent=message; $('#message').className=error?'error':'success'; };
const credentials = window.LOBIT_CONFIG || {};
const configured = /^https:\/\/[\w-]+\.supabase\.co$/.test(credentials.url || '') && !!credentials.publishableKey && !credentials.publishableKey.includes('YOUR_');
let db, user, rabbits=[];
const openLogin = () => $('#loginModal').classList.add('open');
const closeLogin = () => $('#loginModal').classList.remove('open');
document.addEventListener('click', (event) => { if (event.target.closest('[data-login]')) openLogin(); });
$('#closeLogin').addEventListener('click', closeLogin);
$('#loginModal').addEventListener('click', (event) => { if (event.target.id === 'loginModal') closeLogin(); });
if (!configured || !window.supabase) {
  $('#loginBtn').classList.add('hidden');
  $('#mainApp').classList.add('hidden');
  $('#setup').classList.remove('hidden');
} else {
  db = window.supabase.createClient(credentials.url, credentials.publishableKey);
  db.auth.onAuthStateChange((event, session) => {
    if(event==='PASSWORD_RECOVERY') $('#recover').classList.remove('hidden');
    void setSession(session?.user || null);
  });
  db.auth.getSession().then(({data}) => setSession(data.session?.user || null)).catch((e) => say(e.message,true));
}
$('#googleLogin').addEventListener('click', async () => {
  try { await request(db.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}})); }
  catch(e) { say('Google 登入失敗：'+e.message,true); }
});
async function request(query) { const result=await query; if(result.error) throw result.error; return result.data; }
let loaded=false;
async function setSession(next, force=false) {
  if (!force && loaded && (user?.id||null) === (next?.id||null)) return;
  loaded=true; user=next;
  document.querySelectorAll('.guest-only').forEach(el=>el.classList.toggle('hidden',!!user));
  document.querySelectorAll('.member-only').forEach(el=>el.classList.toggle('hidden',!user));
  $('#loginBtn').classList.toggle('hidden',!!user);
  $('#logout').classList.toggle('hidden',!user);
  $('#who').classList.toggle('hidden',!user);
  $('#who').textContent=user?(myNickname||''):'';
  if (user) closeLogin();
  if (!user) { rabbits=[]; try { await refreshPosts(); } catch(e) { say('讀取討論失敗：'+e.message,true); } return; }
  try { await ensureProfile(); await refreshRabbits(); await Promise.all([refreshPosts(),refreshReminders(),refreshMedical()]); }
  catch(e) { say('讀取資料失敗：'+e.message,true); }
}
const randomNick = () => '兔友 ' + String(Math.floor(1000 + Math.random()*9000));
let myNickname = '';
async function ensureProfile() {
  const row=await request(db.from('profiles').select('id,nickname').eq('id',user.id).maybeSingle());
  const emailName=user.email?.split('@')[0]?.slice(0,40)||'';
  if (!row) {
    myNickname=randomNick();
    await request(db.from('profiles').insert({id:user.id,nickname:myNickname}));
  } else if (emailName && row.nickname===emailName) {
    // 舊帳號的暱稱是 email 帳號名稱，自動換成隨機暱稱，避免露出信箱
    myNickname=randomNick();
    await request(db.from('profiles').update({nickname:myNickname}).eq('id',user.id));
  } else {
    myNickname=row.nickname;
  }
  $('#nicknameInput').value=myNickname;
  $('#who').textContent=myNickname;
}
$('#nicknameForm').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const nick=$('#nicknameInput').value.trim();
  if(!nick) return say('暱稱不能空白',true);
  if(nick.length>20) return say('暱稱最多 20 個字',true);
  if(user.email && nick.toLowerCase()===user.email.split('@')[0].toLowerCase()) return say('為了保護隱私，暱稱請不要跟信箱帳號相同',true);
  try{await request(db.from('profiles').update({nickname:nick}).eq('id',user.id));myNickname=nick;$('#who').textContent=nick;await refreshPosts();say('暱稱已更新');}
  catch(err){say(err.message,true);}
});
$('#authForm').addEventListener('click', (event) => { if(event.target.name==='mode') $('#authForm').dataset.mode=event.target.value; });
$('#authForm').addEventListener('submit',async(event)=>{
  event.preventDefault(); const f=event.currentTarget, data=new FormData(f), mode=f.dataset.mode||'login';
  const email=String(data.get('email')||'').trim(), password=String(data.get('password')||'');
  if(!email) return say('請輸入電子信箱',true);
  try {
    if(mode==='reset') { await request(db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname})); say('密碼重設信已寄出，請查看信箱'); }
    else if(mode==='signup') { await request(db.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}})); say('註冊請求已送出，請查看驗證信'); }
    else { await request(db.auth.signInWithPassword({email,password})); say('登入成功'); }
  } catch(e) { say(e.message,true); }
  f.dataset.mode='login';
});
$('#logout').addEventListener('click',async()=>{try{await request(db.auth.signOut());say('已登出');}catch(e){say(e.message,true);}});
for(const b of document.querySelectorAll('[data-page]')) b.addEventListener('click',()=>{
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('hidden',p.id!==b.dataset.page));
  document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('selected',x===b));
});
function entry(container, title, records, renderer) {
  $(container).innerHTML='<h3>'+title+'</h3>'+(records.length?records.map(renderer).join(''):'<p class="muted">目前沒有資料</p>');
}
async function refreshRabbits() {
  rabbits=await request(db.from('rabbits').select('*').order('created_at',{ascending:true}));
  for(const id of ['rabbitRecord','rabbitReminder','rabbitMedical']) {
    const el=$('#'+id), selected=el.value;
    el.innerHTML=rabbits.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('');
    if(rabbits.some(r=>r.id===selected)) el.value=selected;
  }
  await refreshCare();
}
$('#rabbitForm').addEventListener('submit',async(e)=>{
  e.preventDefault(); const f=e.currentTarget,d=new FormData(f);
  try {await request(db.from('rabbits').insert({owner_id:user.id,name:String(d.get('name')).trim(),breed:String(d.get('breed')).trim()||null}));f.reset();await refreshRabbits();say('兔寶已新增');}
  catch(err){say(err.message,true);}
});
$('#rabbitRecord').addEventListener('change',refreshCare);
$('#careKind').addEventListener('change',()=>{
  const kind=$('#careKind').value;
  $('#amountBox').classList.toggle('hidden',!['water','poop','food','medication'].includes(kind));
  $('#careForm [name="unit"]').placeholder=({water:'ml',poop:'顆、mm',food:'g',medication:'mg、ml'})[kind]||'單位';
});
$('#careKind').dispatchEvent(new Event('change'));
for(const selector of ['#careForm [name="occurred_at"]','#reminderForm [name="due_at"]']) $(selector).value=localTime();
async function refreshCare() {
  const rabbitId=$('#rabbitRecord').value;
  const rows=rabbitId?await request(db.from('care_entries').select('*').eq('rabbit_id',rabbitId).order('occurred_at',{ascending:false}).limit(100)):[];
  const labels={water:'喝水',poop:'便便',food:'飲食',medication:'吃藥',energy:'精神',other:'其他'};
  entry('#careList','照護歷史',rows,r=>`<div class="item"><strong>${esc(labels[r.kind])}</strong> · ${esc(when(r.occurred_at))}<br>${r.amount!==null?esc(r.amount)+' '+esc(r.unit||''):''} ${esc(r.detail||'')}<div><button class="danger small" data-delete="care_entries" data-id="${r.id}">刪除</button></div></div>`);
}
$('#careForm').addEventListener('submit',async(e)=>{
  e.preventDefault(); const f=e.currentTarget,d=new FormData(f),kind=String(d.get('kind')),amount=String(d.get('amount')).trim();
  if(!$('#rabbitRecord').value) return say('請先新增兔寶',true);
  if(amount && (Number(amount)<0 || !Number.isFinite(Number(amount)))) return say('數量格式不正確',true);
  try { await request(db.from('care_entries').insert({owner_id:user.id,rabbit_id:$('#rabbitRecord').value,kind,occurred_at:new Date(String(d.get('occurred_at'))).toISOString(),amount:amount?Number(amount):null,unit:String(d.get('unit')).trim()||null,detail:String(d.get('detail')).trim()||null}));f.reset();$('#careForm [name="occurred_at"]').value=localTime();$('#careKind').dispatchEvent(new Event('change'));await refreshCare();say('紀錄已儲存'); }
  catch(err){say(err.message,true);}
});
let reminderRows=new Map();
async function refreshReminders() {
  const rows=await request(db.from('reminders').select('*, rabbits(name)').order('due_at',{ascending:true}).limit(100));
  reminderRows=new Map(rows.map(r=>[r.id,r]));
  entry('#reminderList','提醒清單',rows,r=>`<div class="item"><strong>${esc(r.title)}</strong> ${r.done?'<span class="pill">已完成</span>':new Date(r.due_at)<new Date()?'<span class="error">已到期</span>':''}<br><span class="muted">${esc(r.rabbits?.name)} · ${esc(when(r.due_at))}</span><div class="actions"><button class="secondary small" data-done="${r.id}" data-state="${r.done}">${r.done?'取消完成':'完成'}</button>${!r.done&&new Date(r.due_at)>new Date()?`<button class="secondary small" data-cal="${r.id}">📅 加到行事曆</button>`:''}<button class="danger small" data-delete="reminders" data-id="${r.id}">刪除</button></div></div>`);
}
// 把提醒加進手機行事曆：Android 開 Google 日曆，iPhone 與電腦下載 .ics（系統會跳出「加入行事曆」）
const icsTime=(d)=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
const icsText=(v)=>String(v??'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/([,;])/g,'\\$1');
function addToCalendar(r){
  const start=new Date(r.due_at), end=new Date(start.getTime()+30*60000);
  const title=`🐇 ${r.rabbits?.name||'兔寶'}：${r.title}`;
  const page=location.origin+location.pathname;
  if(/Android/i.test(navigator.userAgent)){
    const q=new URLSearchParams({action:'TEMPLATE',text:title,dates:`${icsTime(start)}/${icsTime(end)}`,details:'來自兔巢 Lobit 的提醒\n'+page});
    window.open('https://calendar.google.com/calendar/render?'+q.toString(),'_blank','noopener');
    return;
  }
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Lobit//Reminders//ZH-TW','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
    `UID:${r.id}@lobit`,`DTSTAMP:${icsTime(new Date())}`,`DTSTART:${icsTime(start)}`,`DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(title)}`,`DESCRIPTION:${icsText('來自兔巢 Lobit 的提醒\n'+page)}`,`URL:${page}`,
    'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsText(title)}`,'TRIGGER:-PT10M','END:VALARM',
    'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsText(title)}`,'TRIGGER:PT0M','END:VALARM',
    'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([ics],{type:'text/calendar;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`lobit-${start.toISOString().slice(0,10)}.ics`;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('#reminderForm').addEventListener('submit',async(e)=>{
  e.preventDefault(); const f=e.currentTarget,d=new FormData(f);
  if(!d.get('rabbit_id')) return say('請先新增兔寶',true);
  try {await request(db.from('reminders').insert({owner_id:user.id,rabbit_id:d.get('rabbit_id'),title:String(d.get('title')).trim(),due_at:new Date(String(d.get('due_at'))).toISOString()}));f.reset();f.elements.due_at.value=localTime();await refreshReminders();say('提醒已新增');}catch(err){say(err.message,true);}
});
async function refreshMedical() {
  const rows=await request(db.from('medical_records').select('*, rabbits(name)').order('visited_at',{ascending:false}).limit(100));
  entry('#medicalList','就診歷史',rows,r=>`<div class="item"><strong>${esc(r.rabbits?.name)} · ${esc(r.reason)}</strong><br><span class="muted">${esc(r.visited_at)} · ${esc(r.clinic||'未填醫院')}</span><br>${esc(r.notes||'')}<div><button class="danger small" data-delete="medical_records" data-id="${r.id}">刪除</button></div></div>`);
}
$('#medicalForm').addEventListener('submit',async(e)=>{
  e.preventDefault();const f=e.currentTarget,d=new FormData(f);
  if(!d.get('rabbit_id')) return say('請先新增兔寶',true);
  try{await request(db.from('medical_records').insert({owner_id:user.id,rabbit_id:d.get('rabbit_id'),visited_at:d.get('visited_at'),clinic:String(d.get('clinic')).trim()||null,reason:String(d.get('reason')).trim(),notes:String(d.get('notes')).trim()||null}));f.reset();await refreshMedical();say('就診紀錄已儲存');}catch(err){say(err.message,true);}
});
async function refreshPosts(){
  const [posts,comments,profiles]=await Promise.all([
    request(db.from('posts').select('*').order('created_at',{ascending:false}).limit(50)),
    request(db.from('comments').select('*').order('created_at',{ascending:true}).limit(500)),
    user?request(db.from('profiles').select('id,nickname')):Promise.resolve([])
  ]);
  const names=new Map(profiles.map(p=>[p.id,p.nickname]));
  entry('#postList','大家的討論',posts,p=>`<article class="item"><span class="pill">${esc(p.category)}</span> <strong>${esc(names.get(p.author_id)||'兔友')}</strong> <span class="muted">${esc(when(p.created_at))}</span><p>${esc(p.content)}</p>${p.author_id===user?.id?`<button class="danger small" data-delete="posts" data-id="${p.id}">刪除發文</button>`:''}<div>${comments.filter(c=>c.post_id===p.id).map(c=>`<p class="muted">↳ <b>${esc(names.get(c.author_id)||'兔友')}</b>：${esc(c.content)}</p>`).join('')}</div>${user?`<form class="commentForm" data-post="${p.id}"><input name="content" maxlength="1000" placeholder="回覆問題" required><button class="secondary">送出回覆</button></form>`:'<button class="secondary small" data-login>登入後回覆</button>'}</article>`);
}
$('#postForm').addEventListener('submit',async(e)=>{
  e.preventDefault();const f=e.currentTarget,d=new FormData(f);
  try{await request(db.from('posts').insert({author_id:user.id,category:d.get('category'),content:String(d.get('content')).trim()}));f.reset();await refreshPosts();say('發布成功');}catch(err){say(err.message,true);}
});
$('#postList').addEventListener('submit',async(e)=>{
  if(!e.target.matches('.commentForm')) return;e.preventDefault();const f=e.target,content=String(new FormData(f).get('content')).trim();
  try{await request(db.from('comments').insert({author_id:user.id,post_id:f.dataset.post,content}));await refreshPosts();say('回覆成功');}catch(err){say(err.message,true);}
});
document.addEventListener('click',async(e)=>{
  const cal=e.target.closest('[data-cal]');if(cal){const r=reminderRows.get(cal.dataset.cal);if(r)addToCalendar(r);return;}
  const done=e.target.closest('[data-done]'),del=e.target.closest('[data-delete]');
  try {
    if(done){await request(db.from('reminders').update({done:done.dataset.state!=='true'}).eq('id',done.dataset.done));await refreshReminders();}
    if(del){if(!confirm('確定刪除這筆資料？'))return;const table=del.dataset.delete;if(!['posts','care_entries','reminders','medical_records'].includes(table))return;await request(db.from(table).delete().eq('id',del.dataset.id));await ({posts:refreshPosts,care_entries:refreshCare,reminders:refreshReminders,medical_records:refreshMedical})[table]();say('已刪除');}
  } catch(err){say(err.message,true);}
});

$('#recoverForm').addEventListener('submit',async(e)=>{
  e.preventDefault();const password=String(new FormData(e.currentTarget).get('password'));
  try{await request(db.auth.updateUser({password}));$('#recover').classList.add('hidden');e.currentTarget.reset();say('密碼已更新');}
  catch(err){say(err.message,true);}
});
