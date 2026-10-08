// 兔兔小幫手後端：Supabase Edge Function
// 部署：supabase functions deploy rabbit-bot --no-verify-jwt
// 金鑰：Supabase → Edge Functions → Secrets 新增 GEMINI_API_KEY（Google AI Studio 的金鑰）
// 選填：BOT_MODEL（預設 gemini-3.8-flash）、BOT_DAILY_LIMIT（預設 20）、ALLOWED_ORIGIN
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = Deno.env.get('BOT_MODEL') ?? 'gemini-3.8-flash';
const DAILY_LIMIT = Number(Deno.env.get('BOT_DAILY_LIMIT') ?? '20');
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://cyanlee1147.github.io';
const MAX_IMAGE_B64 = 5_000_000; // 約 3.7MB 圖片

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && (origin === ALLOWED_ORIGIN || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) ? origin : ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

const BASE = `你是「兔巢 Lobit」網站的「兔兔小幫手」，專門協助台灣的寵物兔飼主。
一律使用繁體中文（台灣用語），語氣溫暖、簡潔，回答控制在 250 字以內，必要時用條列。
你不是獸醫，不做診斷、不開藥、不給藥物劑量；涉及健康問題時提醒飼主以獸醫判斷為準。
遇到以下狀況，第一句就請飼主「立即就醫」：大量或持續出血、傷口深可見肌肉或骨頭、有異味或流膿、腫脹快速擴大、不吃不拉超過 12 小時、呼吸困難、癱軟或歪頭、蒼蠅蛆（蠅蛆症）。
若照片不是兔子或看不清楚，直接說明並請對方重拍（光線充足、對焦、靠近）。
不回答和兔子／小動物照護無關的問題，禮貌地拉回主題。`;

const MODE_PROMPT: Record<string, string> = {
  chat: `目前模式：飼養問答。依據兔子照護的一般共識回答（牧草為主食、適量顆粒與蔬菜、充足飲水、環境溫度約 18–26°C 等）。若飼主附了照片：照片是傷口就說明看到的狀況與是否需要就醫，並建議切換到「傷口評估」取得癒合時間與回診建議；照片是整隻兔子就簡短說明可能品種，並建議切換到「品種辨識」看完整介紹。`,
  wound: `目前模式：傷口評估。請依照片與描述，用以下格式回答：
**傷口觀察**：位置、大小（相對估計）、顏色、是否結痂、有無紅腫滲液等，只描述看得到的。
**嚴重程度**：輕微／中等／需立即就醫，並說明理由。
**預估癒合時間**：給一個區間（例如「約 7–14 天」），並說明這只是粗估，會因年齡、感染、是否舔咬而改變。
**建議回診時間**：例如「2–3 天內若沒有改善就回診」或「建議 24 小時內就醫」。
**居家照護**：保持乾燥清潔、防止舔咬、觀察重點。不要建議人用藥膏或任何藥物。
如果飼主沒說受傷幾天、是否已看過獸醫，在最後用一句話問清楚，以便更新估計。`,
  breed: `目前模式：品種辨識。請依照片用以下格式回答：
**可能品種**：最可能的 1–2 個品種與把握程度（高／中／低）；混種很常見，看不出來就說是米克斯並描述特徵。
**辨識依據**：耳型、體型、毛長、臉型、毛色等。
**品種特色**：成年體重、個性、壽命。
**飼養重點**：該品種特別要注意的事（例如長毛兔要每天梳毛防毛球、垂耳兔要注意耳道清潔、侏儒兔要注意牙齒咬合）。
照片無法確定品種時，提醒飼主外觀辨識僅供參考。`,
};

type InMsg = { role: 'user' | 'assistant'; text?: string; image?: { data: string; media_type: string } | null };

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: '只接受 POST' }, 405, headers);

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: '伺服器尚未設定 AI 金鑰' }, 500, headers);

  // 1. 驗證登入
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth?.user) return json({ error: '請先登入再使用小幫手' }, 401, headers);
  const userId = auth.user.id;

  // 2. 每日次數限制
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countErr } = await admin.from('bot_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since);
  if (countErr) return json({ error: '使用紀錄讀取失敗：' + countErr.message }, 500, headers);
  if ((count ?? 0) >= DAILY_LIMIT) return json({ error: `今天的提問次數（${DAILY_LIMIT} 次）已用完，明天再來問我吧！` }, 429, headers);

  // 3. 檢查輸入
  let body: { mode?: string; messages?: InMsg[] };
  try { body = await req.json(); } catch { return json({ error: '格式錯誤' }, 400, headers); }
  const mode = body.mode && MODE_PROMPT[body.mode] ? body.mode : 'chat';
  const raw = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  while (raw.length && raw[0].role !== 'user') raw.shift();
  if (!raw.length || raw[raw.length - 1].role !== 'user') return json({ error: '沒有問題內容' }, 400, headers);

  const contents: { role: string; parts: unknown[] }[] = [];
  for (const m of raw) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts: unknown[] = [];
    if (m.role === 'user' && m.image?.data) {
      if (!/^image\/(jpeg|png|webp)$/.test(m.image.media_type) || m.image.data.length > MAX_IMAGE_B64) return json({ error: '圖片格式不支援或檔案太大' }, 400, headers);
      parts.push({ inline_data: { mime_type: m.image.media_type, data: m.image.data } });
    }
    const text = String(m.text ?? '').slice(0, 2000).trim();
    parts.push({ text: text || (mode === 'breed' ? '這是什麼品種的兔子？' : mode === 'wound' ? '請幫我評估這個傷口。' : '你好') });
    // 相同角色連續出現時合併，符合對話交替規則
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts); else contents.push({ role, parts });
  }

  // 4. 呼叫 Gemini
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: BASE + '\n\n' + MODE_PROMPT[mode] }] },
      contents,
      generationConfig: { maxOutputTokens: 4096, temperature: 0.4 },
    }),
  });
  if (!res.ok) {
    console.error('Gemini error', res.status, await res.text());
    return json({ error: res.status === 429 ? '目前使用人數較多或免費額度已滿，請稍後再試' : res.status === 404 ? `找不到模型 ${MODEL}，請檢查 BOT_MODEL 設定` : 'AI 服務暫時無法使用' }, 502, headers);
  }
  const out = await res.json();
  const cand = out.candidates?.[0];
  const reply = (cand?.content?.parts ?? []).filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought).map((p: { text: string }) => p.text).join('\n').trim();
  if (!reply && (out.promptFeedback?.blockReason || cand?.finishReason === 'SAFETY')) {
    return json({ reply: '這張照片或問題我沒辦法分析，可以換一張照片或換個方式問嗎？如果兔寶有受傷，建議直接帶去給獸醫看。' }, 200, headers);
  }

  await admin.from('bot_usage').insert({ user_id: userId, mode });
  return json({ reply: reply || '我暫時想不到答案，可以換個方式問我嗎？' }, 200, headers);
});
