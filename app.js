/* Lobit local-only browser client. IndexedDB persists data on this device. */
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = (value) => new Date(value).toLocaleString('zh-TW', {dateStyle:'medium',timeStyle:'short'});
const localTime = () => { const d = new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
const say = (message, error=false) => { $('#message').textContent=message; $('#message').className=error?'error':'success'; };
const db=window.LobitLocal, user={id:'local-device'};
let rabbits=[];
async function request(query) {const result=await query;if(result.error)throw result.error;return result.data;}
async function refreshAll(){await refreshRabbits();await Promise.all([refreshReminders(),refreshMedical(),refreshClinics()]);}
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
  const rows=rabbitId?await request(db.from('care_entries').select('*').eq('rabbit_id',rabbitId).order('occurred_at',{ascending:false})):[];
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
  const rows=await request(db.from('reminders').select('*, rabbits(name)').order('due_at',{ascending:true}));
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
    const q=new URLSearchParams({action:'TEMPLATE',text:title,dates:`${icsTime(start)}/${icsTime(end)}`,details:'來自樂兔 Lobit 的提醒\n'+page});
    window.open('https://calendar.google.com/calendar/render?'+q.toString(),'_blank','noopener');
    return;
  }
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Lobit//Reminders//ZH-TW','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',
    `UID:${r.id}@lobit`,`DTSTAMP:${icsTime(new Date())}`,`DTSTART:${icsTime(start)}`,`DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(title)}`,`DESCRIPTION:${icsText('來自樂兔 Lobit 的提醒\n'+page)}`,`URL:${page}`,
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
// ---------- 醫療紀錄（含單據照片、常用醫院） ----------
const PHOTO_BUCKET='medical-photos', MAX_PHOTOS=6;
let medicalRows=new Map(), lightboxUrls=[], lightboxIndex=0, pendingPhotos=[];
async function shrinkPhoto(file){
  // 縮到長邊 1600px 的 JPEG，單據文字仍看得清楚，也省空間
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((ok,fail)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>fail(new Error('無法讀取圖片：'+file.name));i.src=url;});
    const scale=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');
    c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return await new Promise((ok,fail)=>c.toBlob(b=>b?ok(b):fail(new Error('圖片轉檔失敗')),'image/jpeg',0.85));
  } finally { URL.revokeObjectURL(url); }
}
$('#medPhotoInput').addEventListener('change',async(e)=>{
  const files=[...e.target.files].filter(f=>f.type.startsWith('image/'));e.target.value='';
  if(pendingPhotos.length+files.length>MAX_PHOTOS) say(`每筆紀錄最多 ${MAX_PHOTOS} 張照片`,true);
  for(const f of files.slice(0,MAX_PHOTOS-pendingPhotos.length)){
    try{const blob=await shrinkPhoto(f);pendingPhotos.push({blob,url:URL.createObjectURL(blob)});}catch(err){say(err.message,true);}
  }
  renderPendingPhotos();
});
function renderPendingPhotos(){
  $('#medPhotoPreview').innerHTML=pendingPhotos.map((p,i)=>`<button type="button" class="med-thumb" data-unpend="${i}" title="點一下移除"><img src="${p.url}" alt="待上傳照片 ${i+1}"></button>`).join('');
}
$('#medPhotoPreview').addEventListener('click',(e)=>{
  const b=e.target.closest('[data-unpend]');if(!b)return;
  const [p]=pendingPhotos.splice(Number(b.dataset.unpend),1);URL.revokeObjectURL(p.url);renderPendingPhotos();
});
async function refreshMedical() {
  const rows=await request(db.from('medical_records').select('*, rabbits(name)').order('visited_at',{ascending:false}).order('created_at',{ascending:false}));
  medicalRows=new Map(rows.map(r=>[r.id,r]));
  const paths=rows.flatMap(r=>r.photos||[]);
  const urls=new Map();
  if(paths.length){
    const signed=await request(db.storage.from(PHOTO_BUCKET).createSignedUrls(paths,3600));
    for(const x of signed) if(x.signedUrl) urls.set(x.path,x.signedUrl);
  }
  entry('#medicalList','就診歷史',rows,r=>{
    const pics=(r.photos||[]).map(p=>urls.get(p)).filter(Boolean);
    return `<div class="item med-card"><div class="med-date"><b>${esc(r.visited_at)}</b><span class="pill">${esc(r.rabbits?.name)}</span>${pics.length?`<span class="muted small">📎 ${pics.length} 張單據</span>`:''}</div><strong>${esc(r.reason)}</strong><br><span class="muted">${esc(r.clinic||'未填醫院')}</span>${r.notes?`<div class="med-notes">${esc(r.notes)}</div>`:''}${pics.length?`<div class="med-thumbs" data-gallery="${r.id}">${pics.map((u,i)=>`<button type="button" class="med-thumb" data-pic="${i}"><img src="${esc(u)}" alt="單據 ${i+1}" loading="lazy"></button>`).join('')}</div>`:''}<div><button class="danger small" data-delete="medical_records" data-id="${r.id}">刪除</button></div></div>`;
  });
}
$('#medicalList').addEventListener('click',(e)=>{
  const pic=e.target.closest('[data-pic]');if(!pic)return;
  const gallery=pic.closest('[data-gallery]');
  openLightbox([...gallery.querySelectorAll('img')].map(i=>i.src),Number(pic.dataset.pic));
});
function openLightbox(list,i){lightboxUrls=list;lightboxIndex=i;showLightbox();$('#lightbox').hidden=false;}
function showLightbox(){
  const lb=$('#lightbox'),u=lightboxUrls[lightboxIndex];
  lb.querySelector('img').src=u;lb.querySelector('.lb-open').href=u;
  lb.querySelector('.lb-count').textContent=`${lightboxIndex+1} / ${lightboxUrls.length}`;
  lb.querySelectorAll('.lb-nav').forEach(b=>b.hidden=lightboxUrls.length<2);
}
const stepLightbox=(d)=>{lightboxIndex=(lightboxIndex+d+lightboxUrls.length)%lightboxUrls.length;showLightbox();};
$('#lightbox').addEventListener('click',(e)=>{
  if(e.target.closest('.lb-prev'))return stepLightbox(-1);
  if(e.target.closest('.lb-next'))return stepLightbox(1);
  if(e.target.closest('.lb-close')||e.target.id==='lightbox')$('#lightbox').hidden=true;
});
document.addEventListener('keydown',(e)=>{if($('#lightbox').hidden)return;if(e.key==='Escape')$('#lightbox').hidden=true;if(e.key==='ArrowLeft')stepLightbox(-1);if(e.key==='ArrowRight')stepLightbox(1);});
$('#medicalForm').addEventListener('submit',async(e)=>{
  e.preventDefault();const f=e.currentTarget,d=new FormData(f),btn=$('#medSubmit');
  if(!d.get('rabbit_id')) return say('請先新增兔寶',true);
  const reason=String(d.get('reason')).trim()||(pendingPhotos.length?'就診單據':'');
  if(!reason) return say('請填寫就診原因，或附上單據照片',true);
  const clinic=String(d.get('clinic')).trim();
  const uploaded=[];let saved=false;
  btn.disabled=true;btn.textContent=pendingPhotos.length?'上傳照片中…':'儲存中…';
  try{
    for(const p of pendingPhotos){
      const path=`${user.id}/${crypto.randomUUID()}.jpg`;
      await request(db.storage.from(PHOTO_BUCKET).upload(path,p.blob,{contentType:'image/jpeg'}));
      uploaded.push(path);
    }
    await request(db.from('medical_records').insert({owner_id:user.id,rabbit_id:d.get('rabbit_id'),visited_at:d.get('visited_at'),clinic:clinic||null,reason,notes:String(d.get('notes')).trim()||null,photos:uploaded}));
    saved=true;
    if(clinic) await saveClinic({name:clinic},true);
    pendingPhotos.forEach(p=>URL.revokeObjectURL(p.url));pendingPhotos=[];renderPendingPhotos();
    f.reset();await refreshMedical();say('就診紀錄已儲存');
  }catch(err){
    if(!saved && uploaded.length) await request(db.storage.from(PHOTO_BUCKET).remove(uploaded));
    if(saved){pendingPhotos.forEach(p=>URL.revokeObjectURL(p.url));pendingPhotos=[];renderPendingPhotos();f.reset();}
    say(saved?'就診紀錄已保存，但後續更新失敗，請重新整理。':err.message,true);
  }finally{btn.disabled=false;btn.textContent='儲存就診紀錄';}
});
async function saveClinic(c,quiet=false){
  // 名稱相同就不重複新增
  await request(db.from('clinics').upsert({owner_id:user.id,...c},{onConflict:'owner_id,name',ignoreDuplicates:quiet}));
  await refreshClinics();
}
async function refreshClinics(){
  const rows=await request(db.from('clinics').select('*').order('created_at',{ascending:true}));
  $('#clinicOptions').innerHTML=rows.map(c=>`<option value="${esc(c.name)}">`).join('');
  $('#clinicList').innerHTML=rows.length?rows.map(c=>`<div class="clinic-row"><b>${esc(c.name)}</b>${c.phone?`<a href="tel:${esc(c.phone.replace(/[^\d+]/g,''))}">📞 ${esc(c.phone)}</a>`:''}<a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address||c.name)}">🗺 地圖</a><button class="danger small" data-clinic-del="${c.id}">刪除</button></div>`).join(''):'<p class="muted">還沒有常用醫院</p>';
}
$('#clinicForm').addEventListener('submit',async(e)=>{
  e.preventDefault();const f=e.currentTarget,d=new FormData(f);
  try{await saveClinic({name:String(d.get('name')).trim(),phone:String(d.get('phone')).trim()||null,address:String(d.get('address')).trim()||null});f.reset();say('醫院已儲存');}
  catch(err){say(err.message,true);}
});
$('#clinicList').addEventListener('click',async(e)=>{
  const b=e.target.closest('[data-clinic-del]');if(!b||!confirm('確定刪除這間醫院？（不影響已存的就診紀錄）'))return;
  try{await request(db.from('clinics').delete().eq('id',b.dataset.clinicDel));await refreshClinics();say('已刪除');}catch(err){say(err.message,true);}
});
// 依目前位置搜尋附近的兔科醫院（Google 地圖會從定位點附近開始列）
$('#nearbyVet').addEventListener('click',()=>{
  const q=encodeURIComponent('兔子 特寵 動物醫院');
  const open=(url)=>{location.href=url;};
  if(!navigator.geolocation){open(`https://www.google.com/maps/search/${q}/`);return;}
  $('#nearbyNote').textContent='正在取得你的位置…';
  navigator.geolocation.getCurrentPosition(
    (pos)=>{const {latitude:lat,longitude:lng}=pos.coords;$('#nearbyNote').textContent='';open(`https://www.google.com/maps/search/${q}/@${lat.toFixed(5)},${lng.toFixed(5)},14z`);},
    ()=>{$('#nearbyNote').textContent='沒有取得定位權限，改用一般搜尋。';open(`https://www.google.com/maps/search/${q}+附近/`);},
    {enableHighAccuracy:false,timeout:8000,maximumAge:300000});
});
document.addEventListener('click',async(e)=>{
  const cal=e.target.closest('[data-cal]');if(cal){const r=reminderRows.get(cal.dataset.cal);if(r)addToCalendar(r);return;}
  const done=e.target.closest('[data-done]'),del=e.target.closest('[data-delete]');
  try {
    if(done){await request(db.from('reminders').update({done:done.dataset.state!=='true'}).eq('id',done.dataset.done));await refreshReminders();}
    if(del){if(!confirm('確定刪除這筆資料？'))return;const table=del.dataset.delete;if(!['care_entries','reminders','medical_records'].includes(table))return;const photos=table==='medical_records'?(medicalRows.get(del.dataset.id)?.photos||[]):[];await request(db.from(table).delete().eq('id',del.dataset.id));if(photos.length)await db.storage.from(PHOTO_BUCKET).remove(photos);await ({care_entries:refreshCare,reminders:refreshReminders,medical_records:refreshMedical})[table]();say('已刪除');}
  } catch(err){say(err.message,true);}
});


$('#exportBackup').addEventListener('click',async()=>{
 try{
  const backup=await db.exportBackup();
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='lobit-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  say('已匯出備份，請確認下載檔案並妥善保存');
 }catch(e){say('備份失敗：'+e.message,true);}
});
$('#importBackup').addEventListener('change',async(e)=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;
 try{
  if(file.size>100*1024*1024)throw new Error('備份檔超過 100 MB');
  const value=JSON.parse(await file.text());db.validateBackup(value);
  if(!confirm('匯入將取代目前裝置的全部樂兔紀錄與照片。請先匯出現有備份。確定繼續？'))return;
  await db.importBackup(value);
  pendingPhotos.forEach(p=>URL.revokeObjectURL(p.url));pendingPhotos=[];renderPendingPhotos();
  await refreshAll();say('備份已匯入');
 }catch(e){say('匯入失敗：'+e.message,true);}
});
for(const form of document.querySelectorAll('form'))form.addEventListener('submit',()=>{
 const button=form.querySelector('button[type="submit"],button:not([type])');
 if(button){button.disabled=true;setTimeout(()=>button.disabled=false,600);}
});
document.querySelectorAll('form button').forEach(b=>b.disabled=true);
db.ready().then(async()=>{await refreshAll();document.querySelectorAll('form button').forEach(b=>b.disabled=false);})
 .catch(e=>say('無法開啟本機儲存，請使用一般瀏覽模式並允許網站儲存資料：'+e.message,true));
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>say('離線快取尚未就緒，請保持連線後重新整理',true)));
