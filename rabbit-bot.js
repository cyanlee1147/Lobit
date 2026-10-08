/* 兔兔小幫手：浮動 AI 機器人。
 * 照片與問題送到 Supabase Edge Function「rabbit-bot」，由伺服器端呼叫 AI 模型；
 * API 金鑰只存在 Supabase secrets，不會出現在前端。 */
(() => {
  const COLORS = [
    { id: 'brown', label: '棕色' },
    { id: 'white', label: '白色' },
    { id: 'gray', label: '灰色' },
    { id: 'black', label: '黑色' },
  ];
  const MODES = {
    chat: { label: '飼養問答', hint: '問我兔子的飲食、照顧、行為問題', suggest: ['兔子一天要吃多少牧草？', '兔子不吃東西怎麼辦？', '怎麼幫兔子剪指甲？'] },
    wound: { label: '傷口評估', hint: '上傳傷口照片，並說明受傷幾天、是否已看過獸醫', suggest: ['上傳傷口照片', '傷口受傷 3 天了，有在擦藥'] },
    breed: { label: '品種辨識', hint: '上傳兔子照片，我來猜品種並說明特色與飼養重點', suggest: ['上傳兔子照片'] },
  };
  const STORE = 'lobit-bot-color';
  const MAX_TURNS = 12;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get() { try { return localStorage.getItem(STORE); } catch { return null; } },
    set(v) { try { localStorage.setItem(STORE, v); } catch { /* 無痕模式等情況，忽略 */ } },
  };
  let color = COLORS.some((c) => c.id === store.get()) ? store.get() : 'brown';
  let mode = 'chat';
  let pendingImage = null; // { data, media_type, url }
  let history = []; // { role, text, image? }
  let busy = false;

  const bunny = (c) => `<svg class="rb-bunny" data-color="${c}" viewBox="0 0 64 64" aria-hidden="true">
    <g stroke="var(--rb-line)" stroke-width="1.2">
      <ellipse cx="22.5" cy="17" rx="6.4" ry="15" fill="var(--rb-fur)" transform="rotate(-10 22.5 17)"/>
      <ellipse cx="41.5" cy="17" rx="6.4" ry="15" fill="var(--rb-fur)" transform="rotate(10 41.5 17)"/>
    </g>
    <ellipse cx="22.8" cy="18" rx="3.1" ry="11" fill="var(--rb-ear)" transform="rotate(-10 22.8 18)"/>
    <ellipse cx="41.2" cy="18" rx="3.1" ry="11" fill="var(--rb-ear)" transform="rotate(10 41.2 18)"/>
    <ellipse cx="32" cy="41" rx="21" ry="19" fill="var(--rb-fur)" stroke="var(--rb-line)" stroke-width="1.2"/>
    <ellipse cx="32" cy="49" rx="12" ry="8.5" fill="var(--rb-belly)"/>
    <ellipse cx="17.5" cy="46" rx="4" ry="2.6" fill="var(--rb-ear)" opacity=".55"/>
    <ellipse cx="46.5" cy="46" rx="4" ry="2.6" fill="var(--rb-ear)" opacity=".55"/>
    <ellipse cx="23.5" cy="38.5" rx="3.3" ry="3.8" fill="var(--rb-eye)"/>
    <ellipse cx="40.5" cy="38.5" rx="3.3" ry="3.8" fill="var(--rb-eye)"/>
    <circle cx="24.6" cy="37.1" r="1.2" fill="#fff"/><circle cx="41.6" cy="37.1" r="1.2" fill="#fff"/>
    <path d="M29.6 45.2 h4.8 l-2.4 2.6z" fill="#E58C8A"/>
    <path d="M32 47.8 v2 M32 49.8 q-2.6 2.2 -4.6 .4 M32 49.8 q2.6 2.2 4.6 .4" fill="none" stroke="var(--rb-shade)" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;
  const icon = {
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-8-6 16-2-7z"/></svg>',
  };

  // ---------- DOM ----------
  const fab = document.createElement('button');
  fab.id = 'rbFab';
  fab.type = 'button';
  fab.setAttribute('aria-label', '開啟兔兔小幫手');
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'rbPanel');
  fab.innerHTML = bunny(color) + '<span class="rb-badge">問我</span>';

  const panel = document.createElement('section');
  panel.id = 'rbPanel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '兔兔小幫手');
  panel.innerHTML = `
    <div class="rb-head">
      <span class="rb-head-icon">${bunny(color)}</span>
      <div class="rb-head-text"><b>兔兔小幫手</b><span>AI 回答僅供參考，不能取代獸醫</span></div>
      <button type="button" class="rb-iconbtn" id="rbColorBtn" aria-expanded="false" aria-controls="rbColors" aria-label="更換兔子顏色">${icon.palette}</button>
      <button type="button" class="rb-iconbtn" id="rbClose" aria-label="關閉">${icon.close}</button>
    </div>
    <div class="rb-colors" id="rbColors" role="radiogroup" aria-label="兔子顏色" hidden>
      <small>選擇小幫手顏色</small>
      ${COLORS.map((c) => `<button type="button" class="rb-swatch" role="radio" data-color="${c.id}" aria-checked="${c.id === color}">${bunny(c.id)}${c.label}</button>`).join('')}
    </div>
    <div class="rb-modes" role="group" aria-label="問題類型">
      ${Object.entries(MODES).map(([k, m]) => `<button type="button" class="rb-mode" data-mode="${k}" aria-pressed="${k === mode}">${m.label}</button>`).join('')}
    </div>
    <div class="rb-log" id="rbLog" aria-live="polite"></div>
    <div class="rb-preview" id="rbPreview" hidden><img alt="待送出的照片"><span>照片已附上</span><button type="button" class="rb-iconbtn" id="rbClearImg" aria-label="移除照片">${icon.close}</button></div>
    <form class="rb-form" id="rbForm">
      <button type="button" class="rb-iconbtn" id="rbAttach" aria-label="上傳照片">${icon.camera}</button>
      <input type="file" id="rbFile" accept="image/*" hidden>
      <textarea id="rbInput" rows="1" maxlength="1500" placeholder="輸入問題…"></textarea>
      <button type="submit" class="rb-iconbtn rb-send" id="rbSend" aria-label="送出">${icon.send}</button>
    </form>
    <p class="rb-note">緊急狀況（大量出血、不吃不拉超過 12 小時、呼吸困難）請立即就醫</p>`;

  document.body.append(panel, fab);
  const $ = (s) => panel.querySelector(s);
  const log = $('#rbLog'), input = $('#rbInput'), file = $('#rbFile');

  // ---------- 顏色 ----------
  function setColor(next) {
    color = next;
    store.set(next);
    document.querySelectorAll('#rbFab .rb-bunny, #rbPanel .rb-head .rb-bunny, #rbLog .rb-bunny').forEach((el) => { el.dataset.color = next; });
    panel.querySelectorAll('.rb-swatch').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === next)));
  }
  $('#rbColorBtn').addEventListener('click', (e) => {
    const box = $('#rbColors'), open = box.hidden;
    box.hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  $('#rbColors').addEventListener('click', (e) => { const b = e.target.closest('.rb-swatch'); if (b) setColor(b.dataset.color); });

  // ---------- 開關 ----------
  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    fab.classList.toggle('rb-open', open);
    fab.setAttribute('aria-expanded', String(open));
    fab.setAttribute('aria-label', open ? '關閉兔兔小幫手' : '開啟兔兔小幫手');
    if (open) { if (!log.childElementCount) greet(); setTimeout(() => input.focus(), 50); }
  }
  fab.addEventListener('click', () => toggle());
  $('#rbClose').addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });

  // ---------- 模式 ----------
  function setMode(next, quiet = false) {
    mode = next;
    panel.querySelectorAll('.rb-mode').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === next)));
    input.placeholder = MODES[next].hint;
    if (!quiet) addSuggestions();
  }
  panel.querySelector('.rb-modes').addEventListener('click', (e) => { const b = e.target.closest('.rb-mode'); if (b && b.dataset.mode !== mode) setMode(b.dataset.mode); });

  // ---------- 訊息 ----------
  function md(text) {
    // 先跳脫再做少量 Markdown：粗體、條列、段落
    const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
    let html = '', list = false;
    for (const raw of lines) {
      const line = raw.trim();
      const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
      if (item) { if (!list) { html += '<ul>'; list = true; } html += `<li>${item[1]}</li>`; continue; }
      if (list) { html += '</ul>'; list = false; }
      if (line) html += `<p>${line.replace(/^#{1,4}\s*/, '')}</p>`;
    }
    return html + (list ? '</ul>' : '');
  }
  function bubble(cls, html) {
    const el = document.createElement('div');
    el.className = 'rb-msg ' + cls;
    el.innerHTML = html;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  function addSuggestions() {
    log.querySelectorAll('.rb-suggest').forEach((el) => el.remove());
    const box = document.createElement('div');
    box.className = 'rb-suggest';
    box.innerHTML = MODES[mode].suggest.map((s) => `<button type="button">${esc(s)}</button>`).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.textContent.startsWith('上傳')) file.click();
      else { input.value = b.textContent; input.focus(); }
    });
    log.append(box);
    log.scrollTop = log.scrollHeight;
  }
  function greet() {
    bubble('rb-bot', md('嗨！我是兔兔小幫手 🐇\n我可以：\n- 回答兔子飼養問題\n- 看傷口照片，估計大概的癒合時間與回診時機\n- 看兔子照片猜品種，介紹特色和飼養重點\n右上角的調色盤可以換我的顏色喔！'));
    addSuggestions();
  }

  // ---------- 照片 ----------
  async function shrink(f) {
    // 縮到長邊 1280px 的 JPEG，減少上傳量與費用
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('無法讀取這張圖片')); i.src = url; });
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.85);
      return { data: dataUrl.split(',')[1], media_type: 'image/jpeg', url: dataUrl };
    } finally { URL.revokeObjectURL(url); }
  }
  $('#rbAttach').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return bubble('rb-err', '請選擇圖片檔');
    try {
      pendingImage = await shrink(f);
      $('#rbPreview img').src = pendingImage.url;
      $('#rbPreview').hidden = false;
      input.focus();
    } catch (e) { bubble('rb-err', esc(e.message)); }
  });
  $('#rbClearImg').addEventListener('click', () => { pendingImage = null; $('#rbPreview').hidden = true; });

  // ---------- 送出 ----------
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#rbForm').requestSubmit(); } });
  $('#rbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const text = input.value.trim();
    if (!text && !pendingImage) return;
    const client = typeof db !== 'undefined' ? db : null;
    if (!client) return bubble('rb-err', '網站尚未連上資料庫，暫時無法使用小幫手。');
    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      const el = bubble('rb-bot', md('小幫手需要先登入才能使用（避免被濫用）。登入後就能問我囉！') + '<button type="button" class="primary" data-login style="margin-top:6px">登入</button>');
      el.querySelector('[data-login]').addEventListener('click', () => toggle(false));
      return;
    }
    log.querySelectorAll('.rb-suggest').forEach((el) => el.remove());
    const image = pendingImage;
    if (image && mode !== 'wound' && /傷|流血|受傷|破皮|結痂/.test(text)) setMode('wound', true);
    bubble('rb-user', (image ? `<img src="${image.url}" alt="上傳的照片">` : '') + esc(text || (mode === 'breed' ? '這是什麼品種？' : '請幫我看這個傷口')));
    history.push({ role: 'user', text: text || '', image: image ? { data: image.data, media_type: image.media_type } : null });
    input.value = ''; input.style.height = 'auto';
    pendingImage = null; $('#rbPreview').hidden = true;
    busy = true; $('#rbSend').disabled = true;
    const typing = bubble('rb-bot', '<span class="rb-typing"><i></i><i></i><i></i></span>');
    try {
      // 只送最近幾輪；舊照片不重送，以文字標記代替
      const recent = history.slice(-MAX_TURNS);
      const lastImg = recent.map((m) => !!m.image).lastIndexOf(true);
      const messages = recent.map((m, i) => ({ role: m.role, text: m.text || (m.image && i !== lastImg ? '（先前上傳的照片）' : ''), image: i === lastImg ? m.image : null }));
      const { data, error } = await client.functions.invoke('rabbit-bot', { body: { mode, messages } });
      if (error) {
        let msg = error.message;
        try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch { /* 保留原訊息 */ }
        throw new Error(msg);
      }
      typing.remove();
      bubble('rb-bot', md(data.reply));
      history.push({ role: 'assistant', text: data.reply });
    } catch (err) {
      typing.remove();
      history.pop();
      bubble('rb-err', '小幫手暫時沒辦法回答：' + esc(err.message));
    } finally { busy = false; $('#rbSend').disabled = false; }
  });

  setMode('chat', true);
})();
