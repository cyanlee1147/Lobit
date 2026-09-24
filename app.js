/* Lobit browser client. Access control is enforced in Supabase RLS, not here. */
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = (value) => new Date(value).toLocaleString('zh-TW', {dateStyle:'medium',timeStyle:'short'});
const localTime = () => { const d = new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
const say = (message, error=false) => { $('#message').textContent=message; $('#message').className=error?'error':'success'; };
const credentials = window.LOBIT_CONFIG || {};
const configured = /^https:\/\/[\w-]+\.supabase\.co$/.test(credentials.url || '') && !!credentials.publishableKey && !credentials.publishableKey.includes('YOUR_');
let db, user, rabbits=[];
if (!configured || !window.supabase) {
  $('#setup').classList.remove('hidden');
} else {
  db = window.supabase.createClient(credentials.url, credentials.publishableKey);
  db.auth.onAuthStateChange((event, session) => {
    if(event==='PASSWORD_RECOVERY') $('#recover').classList.remove('hidden');
    void setSession(session?.user || null);
  });
  db.auth.getUser().then(({data}) => setSession(data.user)).catch((e) => say(e.message,true));
}
async function request(query) { const result=await query; if(result.error) throw result.error; return result.data; }
async function setSession(next) {
  if (user?.id === next?.id) return;
  user=next;
  $('#auth').classList.toggle('hidden',!!user);
  $('#privateApp').classList.toggle('hidden',!user);
  $('#logout').classList.toggle('hidden',!user);
  if (!user) { rabbits=[]; return; }
  try { await ensureProfile(); await refreshRabbits(); await Promise.all([refreshPosts(),refreshReminders(),refreshMedical()]); }
  catch(e) { say('讀取資料失敗：'+e.message,true); }
}
async function ensureProfile() {
  const row=await request(db.from('profiles').select('id').eq('id',user.id).maybeSingle());
  if (!row) await request(db.from('profiles').insert({id:user.id,nickname:user.email?.split('@')[0]?.slice(0,40)||'兔友'}));
}
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
async function refreshReminders() {
  const rows=await request(db.from('reminders').select('*, rabbits(name)').order('due_at',{ascending:true}).limit(100));
  entry('#reminderList','提醒清單',rows,r=>`<div class="item"><strong>${esc(r.title)}</strong> ${r.done?'<span class="pill">已完成</span>':new Date(r.due_at)<new Date()?'<span class="error">已到期</span>':''}<br><span class="muted">${esc(r.rabbits?.name)} · ${esc(when(r.due_at))}</span><div class="actions"><button class="secondary small" data-done="${r.id}" data-state="${r.done}">${r.done?'取消完成':'完成'}</button><button class="danger small" data-delete="reminders" data-id="${r.id}">刪除</button></div></div>`);
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
    request(db.from('profiles').select('id,nickname'))
  ]);
  const names=new Map(profiles.map(p=>[p.id,p.nickname]));
  entry('#postList','大家的討論',posts,p=>`<article class="item"><span class="pill">${esc(p.category)}</span> <strong>${esc(names.get(p.author_id)||'兔友')}</strong> <span class="muted">${esc(when(p.created_at))}</span><p>${esc(p.content)}</p>${p.author_id===user.id?`<button class="danger small" data-delete="posts" data-id="${p.id}">刪除發文</button>`:''}<div>${comments.filter(c=>c.post_id===p.id).map(c=>`<p class="muted">↳ <b>${esc(names.get(c.author_id)||'兔友')}</b>：${esc(c.content)}</p>`).join('')}</div><form class="commentForm" data-post="${p.id}"><input name="content" maxlength="1000" placeholder="回覆問題" required><button class="secondary">送出回覆</button></form></article>`);
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
