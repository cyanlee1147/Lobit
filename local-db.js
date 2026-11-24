/* Local-only persistence. No network requests, credentials, or cloud policy changes. */
(() => {
  'use strict';
  const TABLES = ['rabbits', 'care_entries', 'reminders', 'medical_records', 'clinics'];
  const empty = () => Object.fromEntries([...TABLES.map(t => [t, []]), ['photos', {}]]);
  const ready = new Promise((resolve, reject) => {
    const open = indexedDB.open('lobit-local-v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('state');
    open.onsuccess = () => { open.result.onversionchange = () => open.result.close(); resolve(open.result); };
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('請關閉其他樂兔分頁後重試'));
  });
  async function transaction(write, action) {
    const db = await ready;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', write ? 'readwrite' : 'readonly');
      const store = tx.objectStore('state');
      let result, failure;
      const get = store.get('data');
      get.onsuccess = () => {
        try {
          const data = get.result || empty();
          result = action(data);
          if (write) store.put(data, 'data');
        } catch (e) { failure = e; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('儲存失敗，請檢查瀏覽器儲存空間'));
    });
  }
  const response = async task => {
    try { return {data: await task(), error: null}; }
    catch (e) { return {data: null, error: e}; }
  };
  function validateRow(table, row, state) {
    if (!row || typeof row !== 'object' || !/^[\w-]{1,100}$/.test(row.id)) throw new Error('資料識別碼無效');
    const fields = {rabbits:['name'], care_entries:['kind','occurred_at'], reminders:['title','due_at'], medical_records:['reason','visited_at'], clinics:['name']}[table];
    for (const field of fields) if (typeof row[field] !== 'string' || !row[field].trim()) throw new Error('必填欄位不可空白');
    for (const value of Object.values(row)) if (typeof value === 'string' && value.length > 10000) throw new Error('文字過長');
    if (['care_entries','reminders','medical_records'].includes(table) && !state.rabbits.some(r => r.id === row.rabbit_id)) throw new Error('請先選擇有效的兔寶');
    if (table === 'care_entries') {
      if (!['water','poop','food','medication','energy','other'].includes(row.kind)) throw new Error('紀錄類別無效');
      if (row.amount !== null && (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount < 0)) throw new Error('數量格式不正確');
    }
    for (const key of ['occurred_at','due_at','visited_at']) if (key in row && !Number.isFinite(Date.parse(row[key]))) throw new Error('日期格式不正確');
    if (table === 'reminders' && typeof row.done !== 'boolean') throw new Error('提醒狀態無效');
    if (table === 'medical_records' && (!Array.isArray(row.photos) || row.photos.length > 6 || row.photos.some(p => typeof p !== 'string' || !Object.hasOwn(state.photos,p)))) throw new Error('照片資料不完整');
  }
  class Query {
    constructor(table) { if (!TABLES.includes(table)) throw new Error('未知資料表'); this.table=table; this.filters=[]; this.orders=[]; this.mode='select'; }
    select() { return this; }
    eq(key,value) { this.filters.push([key,value]); return this; }
    order(key,options={}) { this.orders.push([key,options.ascending !== false]); return this; }
    insert(value) { this.mode='insert';this.value=value;return this; }
    upsert(value,options={}) { this.mode='upsert';this.value=value;this.options=options;return this; }
    update(value) { this.mode='update';this.value=value;return this; }
    delete() { this.mode='delete';return this; }
    then(resolve,reject) { return response(() => transaction(this.mode !== 'select', state => {
      let rows = state[this.table];
      const matches = row => this.filters.every(([k,v]) => row[k] === v);
      if (this.mode === 'insert' || this.mode === 'upsert') {
        const existing = this.mode === 'upsert' && rows.find(r => r.name === this.value.name);
        if (existing) {
          if (!this.options.ignoreDuplicates) {const next={...existing,...this.value};validateRow(this.table,next,state);Object.assign(existing,next);}
        } else {
          const row = {id:crypto.randomUUID(),created_at:new Date().toISOString(), ...(this.table==='reminders'?{done:false}:{}), ...this.value};
          validateRow(this.table,row,state); rows.push(row);
        }
      } else if (this.mode === 'update') {
        rows.filter(matches).forEach(row => {const next={...row,...this.value};validateRow(this.table,next,state);Object.assign(row,next);});
      } else if (this.mode === 'delete') {
        // Remove the record and its photos in the same IndexedDB transaction.
        if(this.table==='medical_records') rows.filter(matches).forEach(r => r.photos.forEach(p => delete state.photos[p]));
        state[this.table]=rows.filter(r => !matches(r));
      }
      rows = state[this.table].filter(matches).map(r => ({...r, rabbits:{name:state.rabbits.find(x=>x.id===r.rabbit_id)?.name}}));
      rows.sort((a,b) => {for (const [k,asc] of this.orders) {if(a[k]<b[k])return asc?-1:1;if(a[k]>b[k])return asc?1:-1;}return 0;});
      return rows;
    })).then(resolve,reject); }
  }
  const readBlob = blob => new Promise((resolve,reject) => {const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
  const storage = {
    upload: (path,blob) => response(async () => {const image=await readBlob(blob);await transaction(true,s=>{s.photos[path]=image;});return {path};}),
    remove: paths => response(() => transaction(true,s=>{paths.forEach(p=>delete s.photos[p]);return paths;})),
    createSignedUrls: paths => response(() => transaction(false,s=>paths.map(path=>({path,signedUrl:s.photos[path]}))))
  };
  function validateBackup(value) {
    if (value?.format !== 'lobit-local' || value.version !== 1 || !value.data) throw new Error('不是樂兔本機版備份');
    const state=empty();
    if (!value.data.photos || typeof value.data.photos !== 'object' || Array.isArray(value.data.photos)) throw new Error('照片資料無效');
    for (const [path,content] of Object.entries(value.data.photos)) {
      if (!/^[\w/-]{1,150}\.jpg$/.test(path) || typeof content!=='string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(content)) throw new Error('照片格式無效');
      state.photos[path]=content;
    }
    for(const table of TABLES) {
      const rows=value.data[table];
      if (!Array.isArray(rows) || rows.length>100000) throw new Error('備份紀錄格式無效');
      const ids=new Set();
      for (const row of rows) {validateRow(table,row,state);if(ids.has(row.id))throw new Error('備份有重複識別碼');ids.add(row.id);}
      state[table]=rows;
    }
    return state;
  }
  window.LobitLocal = {
    from: table => new Query(table), storage:{from:()=>storage},
    ready: () => transaction(false,()=>true),
    exportBackup: () => transaction(false,data=>({format:'lobit-local',version:1,exported_at:new Date().toISOString(),data})),
    validateBackup,
    importBackup: value => {const next=validateBackup(value);return transaction(true,state=>{for(const key of Object.keys(next))state[key]=next[key];});}
  };
})();
