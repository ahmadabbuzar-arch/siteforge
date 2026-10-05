// Vercel serverless route (CommonJS so it works without package.json settings).
// Env: GEMINI_API_KEY (required), GEMINI_MODEL; optional backup: GROQ_API_KEY, GROQ_MODEL, GROQ_MAX_TOKENS
let groqCache = { t: 0, ids: null };
// Gemini keys in order of use: GEMINI_API_KEY, then GEMINI_API_KEY_2 (also accepts _2 variants, _BACKUP, or a comma list in GEMINI_API_KEYS)
const geminiKeys = () => [...new Set(['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY2', 'GEMINI_API_KEY_BACKUP', 'GEMINI_API_KEY_B'].map((n) => process.env[n]).concat((process.env.GEMINI_API_KEYS || '').split(',')).map((x) => (x || '').trim()).filter(Boolean))];
const hits = new Map(); // in-memory per-IP counter (resets on cold start); use Upstash/Firebase for strict limits
// Env: GENERATE_LIMIT = abuse backstop per IP per day (default 100; the per-user limit of 5 is in index.html), EDIT_LIMIT = AI edits per IP per day (default 30)

const SYSTEM = `You are a professional web developer. Generate clean, responsive, accessible HTML/CSS/JavaScript. Maintain the existing design system when editing. Do not remove existing functionality unless explicitly requested. Return valid structured JSON. Never include markdown code fences inside code fields.
Rules: each page "html" is BODY INNER HTML only (no html/head/body tags). Use semantic HTML, alt text, labels, one h1, visible focus, readable contrast. CSS must be mobile-first, use relative units and media queries, support 320px+, no horizontal overflow. Navigation links must use hrefs like index.html, about.html (slug "/" = index.html) and be identical on every page. All pages share the same CSS design system (put shared CSS in the first page; others may add only page-specific CSS). No external scripts, no remote images (use CSS shapes/gradients or inline SVG). Original content only, no copyrighted brands.`;

const PAGE = { type: 'OBJECT', properties: { name: { type: 'STRING' }, slug: { type: 'STRING' }, html: { type: 'STRING' }, css: { type: 'STRING' }, javascript: { type: 'STRING' } }, required: ['name', 'slug', 'html', 'css', 'javascript'] };
const SCHEMA = {
  generate: { type: 'OBJECT', properties: { name: { type: 'STRING' }, description: { type: 'STRING' }, theme: { type: 'OBJECT', properties: { primaryColor: { type: 'STRING' }, backgroundColor: { type: 'STRING' }, textColor: { type: 'STRING' }, fontFamily: { type: 'STRING' } } }, pages: { type: 'ARRAY', items: PAGE } }, required: ['name', 'description', 'theme', 'pages'] },
  edit: { type: 'OBJECT', properties: { summary: { type: 'STRING' }, pages: { type: 'ARRAY', items: PAGE } }, required: ['summary', 'pages'] },
};

const config = { maxDuration: 60 }; // full-site generation takes >10s (Vercel default)

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // lets the APK (file/localhost origin) call this API
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET' && req.query && req.query.models) { // diagnostic: which models can this key use?
    try {
      const l = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': geminiKeys()[0] || '' } });
      const d = await l.json();
      return res.status(200).json({ status: l.status, models: (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name), error: d.error && d.error.message });
    } catch (e) { return res.status(500).json({ error: 'list' }); }
  }
  if (req.method === 'GET' && req.query && req.query.groq) { // diagnostic: which Groq models can this key use?
    try {
      const l = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + (process.env.GROQ_API_KEY || '') } });
      const d = await l.json();
      return res.status(200).json({ status: l.status, models: (d.data || []).map((m) => m.id), error: d.error && d.error.message });
    } catch (e) { return res.status(500).json({ error: 'list' }); }
  }
  if (req.method === 'GET' && req.query && req.query.test) { // diagnostic: why is Gemini failing? (tiny real request per key/model)
    const ip0 = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), tk = 'test' + ip0 + new Date().toISOString().slice(0, 10), tu = hits.get(tk) || 0;
    if (tu >= 10) return res.status(429).json({ error: 'limit' });
    hits.set(tk, tu + 1);
    const out = [];
    for (const [ki, k] of geminiKeys().entries()) {
      const results = [];
      for (const m of [process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-3.5-flash'].filter(Boolean)) {
        try {
          const t = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Return summary "ok" and an empty pages array.' }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA.edit, maxOutputTokens: 32000 } }),
          });
          let msg = ''; if (!t.ok) { try { msg = (await t.json()).error.message.slice(0, 140); } catch (e) {} }
          results.push({ model: m, status: t.status, msg });
        } catch (e) { results.push({ model: m, status: 'fetch failed' }); }
      }
      out.push({ key: ki + 1, results });
    }
    return res.status(200).json({ groq: !!process.env.GROQ_API_KEY, keys: out });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', keySet: geminiKeys().length > 0, geminiKeys: geminiKeys().length, groq: !!process.env.GROQ_API_KEY });
  const keys = geminiKeys();
  if (!keys.length && !process.env.GROQ_API_KEY) return res.status(500).json({ error: 'config' });

  const { mode, prompt, site, page, image, assets } = req.body || {};
  if (!['generate', 'edit'].includes(mode) || typeof prompt !== 'string' || (prompt.trim().length < 3 && !image) || prompt.length > 4000)
    return res.status(400).json({ error: 'input' });
  if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mime) || typeof image.data !== 'string' || image.data.length > 3_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.data)))
    return res.status(400).json({ error: 'image' });
  if (assets && (!Array.isArray(assets) || assets.length > 12 || assets.some((a) => !/^assets\/[a-z0-9._-]{1,70}$/.test(a)))) return res.status(400).json({ error: 'input' });
  if (JSON.stringify(site || {}).length > 400000) return res.status(413).json({ error: 'size' });

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10), k = ip + day + mode; // separate counters for generate and edit
  const limit = mode === 'generate' ? Number(process.env.GENERATE_LIMIT || 100) : Number(process.env.EDIT_LIMIT || 30), used = hits.get(k) || 0;
  if (used >= limit) return res.status(429).json({ error: 'limit', remaining: 0 });

  const text = mode === 'generate'
    ? `Create a complete multi-page-ready website (at least a Home page; add About/Contact etc. only if useful).\nRequest: ${prompt}` + (assets && assets.length ? `\nThe user uploaded images, available at these exact paths: ${assets.join(', ')}. Use them with <img src="..." alt="..."> where they fit (for example a profile photo, hero or logo). Never redraw, recreate or replace them with illustrations or SVG, and never invent other image files. Show them in their original colors: no grayscale, sepia, blur or brightness filters, no mix-blend-mode, no color overlays or reduced opacity on them.` : '')
    : `Existing site (name, theme, pages):\n${JSON.stringify(site)}\nCurrent page slug: ${page || '/'}\nRequested change: ${prompt}\nReturn ONLY pages that changed or are new (full code for each), plus a short summary of the change. If site.assets lists uploaded images, use them only by their exact path (for example <img src="assets/logo.webp" alt="...">) when the user asks to use their image, and never invent other image files. Show uploaded images in their original colors: do not add grayscale, sepia, blur or brightness filters, blend modes, color overlays or reduced opacity to them. Keep the design system and navigation consistent; if adding a page, also return the other pages with updated navigation.`;

  const gnotes = [];
  let gfail = null;
  const viaGemini = async () => {
    if (!keys.length) return { code: 502, body: { error: 'ai', why: 'nokey' } };
    try {
    const call = (model, k) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [
          { text: text + (image ? '\nAn image is attached. Analyze its layout, spacing, typography, colors, cards, buttons and sections and build a similar but ORIGINAL implementation. Do not copy logos, brand names, copyrighted assets or proprietary text.' : '') },
          ...(image ? [{ inlineData: { mimeType: image.mime, data: image.data } }] : []),
        ] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA[mode], temperature: 0.7, maxOutputTokens: 32000, ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      }),
    });
      let r, busyAny = false;
      const wait = (ms) => new Promise((x) => setTimeout(x, ms));
      const models = [process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'].filter(Boolean);
      const KEYFAIL = [401, 403], NEXTMODEL = [400, 404, 429, 500, 503];
      const rounds = process.env.GROQ_API_KEY ? 1 : 3, t0 = Date.now(), budget = 35000;
      // Order: key 1 (all models), then key 2 (all models); Groq is only the very last resort (see viaGroq)
      outer: for (let round = 0; round < rounds; round++) {
        let busy = false;
        for (const k of keys) {
          for (const m of models) {
            r = await call(m, k);
            gnotes.push((keys.indexOf(k) + 1) + ':' + r.status);
            if (r.ok) break outer;
            if (KEYFAIL.includes(r.status)) break; // this key is rejected or blocked: go to the next key
            if (!NEXTMODEL.includes(r.status)) break outer; // some other error: report it
            if (r.status === 500 || r.status === 503) busy = busyAny = true;
          }
        }
        if (!busy || Date.now() - t0 > budget || round === rounds - 1) break;
        await wait(3000 * (round + 1));
      }
      if (!r.ok && busyAny) return { code: 503, body: { error: 'busy' } };
      if (r.status === 429) return { code: 429, body: { error: 'limit' } };
      if (!r.ok) {
        console.error('Gemini HTTP', r.status, (await r.text()).slice(0, 600));
        return { code: 502, body: { error: 'ai', status: r.status } }; // message stays in server logs only
      }
      const data = await r.json();
      const cand = data?.candidates?.[0];
      const out = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (!out) return { code: 502, body: { error: 'ai', why: 'empty ' + (cand?.finishReason || data?.promptFeedback?.blockReason || 'none') } };
      try { return { parsed: JSON.parse(out.replace(/^```json|```$/g, '').trim()), via: 'gemini' }; }
      catch (e) { console.error('JSON parse failed', cand?.finishReason, out.slice(-200)); return { code: 502, body: { error: 'ai', why: 'parse ' + (cand?.finishReason || '') } }; }
    } catch (e) {
      console.error('Gemini fetch failed:', e);
      return { code: 502, body: { error: 'ai', why: 'fetch' } };
    }
  };

  // Backup provider: used only when Gemini failed. Env: GROQ_API_KEY (optional), GROQ_MODEL, GROQ_MAX_TOKENS
  const viaGroq = async () => {
    const gk = process.env.GROQ_API_KEY;
    if (!gk || image) return null; // no key, or a reference image (the backup model cannot see images)
    const shape = mode === 'generate'
      ? '{"name":"","description":"","theme":{"primaryColor":"","backgroundColor":"","textColor":"","fontFamily":""},"pages":[{"name":"","slug":"","html":"","css":"","javascript":""}]}'
      : '{"summary":"","pages":[{"name":"","slug":"","html":"","css":"","javascript":""}]}';
    const sys = SYSTEM + '\nReturn ONLY one JSON object, no other text, in exactly this shape: ' + shape + '\nKeep the code compact: concise CSS and short JavaScript.';
    // Pick from Groq's current catalogue (cached 10 min): newest production model first, then the newest preview, then the small one.
    if (!groqCache.ids || Date.now() - groqCache.t > 600000) {
      try {
        const l = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + gk } });
        if (l.ok) groqCache = { t: Date.now(), ids: ((await l.json()).data || []).map((x) => x.id) };
      } catch (e) {}
    }
    const avail = groqCache.ids;
    const pref = [process.env.GROQ_MODEL, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'].filter(Boolean);
    let list = avail ? pref.filter((m) => avail.includes(m)) : pref;
    if (avail && list.length < 2) list = [...list, ...avail.filter((m) => !/whisper|guard|tts|compound|embed|orpheus|vision/i.test(m) && !list.includes(m)).slice(0, 2)]; // names changed? use whatever chat models exist
    for (const m of list) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gk },
          body: JSON.stringify({ model: m, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }], temperature: 0.7, max_tokens: Number(process.env.GROQ_MAX_TOKENS || 6000), response_format: { type: 'json_object' } }),
        });
        if (!r.ok) { console.error('Groq HTTP', m, r.status, (await r.text()).slice(0, 300)); continue; } // try the next model
        const d = await r.json();
        const parsed = JSON.parse(String(d?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```json|```$/g, '').trim());
        if (!Array.isArray(parsed.pages) || !parsed.pages.length) continue;
        const pages = parsed.pages.map((p) => ({ name: String(p.name || 'Home'), slug: String(p.slug || '/'), html: String(p.html || ''), css: String(p.css || ''), javascript: String(p.javascript || '') }));
        return mode === 'generate'
          ? { parsed: { name: String(parsed.name || 'My website'), description: String(parsed.description || ''), theme: parsed.theme && typeof parsed.theme === 'object' ? parsed.theme : {}, pages }, via: 'groq' }
          : { parsed: { summary: String(parsed.summary || 'Updated'), pages }, via: 'groq' };
      } catch (e) { console.error('Groq failed', m, e && e.message); }
    }
    return null;
  };

  let result = await viaGemini();
  if (!result.parsed) {
    gfail = [...new Set(gnotes)].join(' ') + (result.body && result.body.why ? ' ' + result.body.why : '');
    const g = await viaGroq();
    if (g) result = g;
  }
  if (!result.parsed) return res.status(result.code).json(result.body);
  hits.set(k, used + 1); // only successful results count against the limit
  return res.status(200).json({ ...result.parsed, via: result.via, ...(result.via === 'groq' ? { gemini: gfail } : {}), ...(mode === 'generate' ? { remaining: Math.max(0, limit - used - 1) } : {}) });
}

module.exports = handler;
module.exports.config = config;
