// Vercel serverless route (CommonJS so it works without package.json settings).
// Env: GEMINI_API_KEY (required), GEMINI_MODEL; optional backups: MISTRAL_API_KEY (+ MISTRAL_MODEL, MISTRAL_MAX_TOKENS) and GROQ_API_KEY (+ GROQ_MODEL, GROQ_MAX_TOKENS)
let groqCache = { t: 0, ids: null };
// Gemini 3.x: low thinking (faster, leaves room for the JSON); older 2.5 models: thinking off. Temperature left at the default for 3.x.
const genConfig = (model, schema, lowThink) => ({ responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 32000, ...(/2\.5/.test(model) ? { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } } : lowThink ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) });
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

// ---------- Backup AIs: Groq (fast) and Mistral (strong coder) working together ----------
const DESIGN = 'Design rules: modern premium look, generous whitespace, 8px spacing scale, fluid type with clamp(), one primary accent colour from the theme used sparingly, soft borders, subtle shadows, rounded cards, clear visual hierarchy, a strong hero, consistent buttons, hover and focus states, smooth subtle transitions, mobile-first with breakpoints, no horizontal overflow, readable contrast, no lorem ipsum, no external fonts or images.';
let mistralCache = { t: 0, ids: null };
const haveBackup = () => !!(process.env.GROQ_API_KEY || process.env.MISTRAL_API_KEY);
async function groqModelList(gk) { // newest production model first, then newest preview, then the small one (checked against Groq's live catalogue, cached 10 min)
  if (!groqCache.ids || Date.now() - groqCache.t > 600000) {
    try {
      const l = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + gk } });
      if (l.ok) groqCache = { t: Date.now(), ids: ((await l.json()).data || []).map((x) => x.id) };
    } catch (e) {}
  }
  const avail = groqCache.ids;
  const pref = [process.env.GROQ_MODEL, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'].filter(Boolean);
  let list = avail ? pref.filter((m) => avail.includes(m)) : pref;
  if (avail && list.length < 2) list = [...list, ...avail.filter((m) => !/whisper|guard|tts|compound|embed|orpheus|vision/i.test(m) && !list.includes(m)).slice(0, 2)];
  return list;
}
async function mistralModelList(mk) { // strongest first; the *-latest names are aliases that Mistral keeps pointing at the newest version
  if (!mistralCache.ids || Date.now() - mistralCache.t > 600000) {
    try {
      const l = await fetch('https://api.mistral.ai/v1/models', { headers: { Authorization: 'Bearer ' + mk } });
      if (l.ok) mistralCache = { t: Date.now(), ids: ((await l.json()).data || []).map((x) => x.id) };
    } catch (e) {}
  }
  const avail = mistralCache.ids;
  const pref = [process.env.MISTRAL_MODEL, 'mistral-large-latest', 'mistral-medium-latest', 'codestral-latest'].filter(Boolean);
  const list = avail ? pref.filter((m) => avail.includes(m)) : pref;
  return list.length ? list : pref;
}
async function oneProvider(prov, sys, user, maxTokens, deadline) {
  const key = prov === 'groq' ? process.env.GROQ_API_KEY : process.env.MISTRAL_API_KEY;
  if (!key) return null;
  const url = prov === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.mistral.ai/v1/chat/completions';
  // Groq's free plan has a small per-minute token budget; Mistral has much more room, so it may write longer output.
  const cap = prov === 'groq' ? Math.min(maxTokens, Number(process.env.GROQ_MAX_TOKENS || 6000)) : Math.min(Math.round(maxTokens * 1.6), Number(process.env.MISTRAL_MAX_TOKENS || 12000));
  for (const m of prov === 'groq' ? await groqModelList(key) : await mistralModelList(key)) {
    const left = (deadline || Infinity) - Date.now();
    if (left < 4000) return null; // out of time (Vercel stops the function at 60s)
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        signal: AbortSignal.timeout(Math.min(prov === 'mistral' ? 38000 : 25000, left)),
        body: JSON.stringify({ model: m, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.6, max_tokens: cap, response_format: { type: 'json_object' } }),
      });
      if (!r.ok) { console.error(prov, 'HTTP', m, r.status, (await r.text()).slice(0, 300)); continue; } // try the next model
      const d = await r.json();
      return JSON.parse(String(d?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```json|```$/g, '').trim());
    } catch (e) { console.error(prov, 'failed', m, e && e.message); }
  }
  return null;
}
// Asks the preferred AI first and the other one if it fails, so either can cover for the other.
async function aiJson(sys, user, maxTokens, opt = {}) {
  const first = opt.prefer === 'groq' ? 'groq' : 'mistral';
  for (const prov of [first, first === 'groq' ? 'mistral' : 'groq']) {
    const data = await oneProvider(prov, sys, user, maxTokens, opt.deadline);
    if (data) return { data, by: prov };
  }
  return null;
}
// One small step of a website build (plan -> css -> html per page). Groq plans (fast), Mistral designs and codes, pages can be split between both.
async function backupStage(stage, b, opt) {
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
  const assets = (Array.isArray(b.assets) ? b.assets : []).filter((a) => typeof a === 'string' && /^assets\/[a-z0-9._-]{1,70}$/.test(a)).slice(0, 12);
  const assetNote = assets.length ? ` The user uploaded images at: ${assets.join(', ')}. Use them exactly as <img src="..."> with good alt text; never redraw them and never add filters, grayscale or overlays to them.` : '';
  const fileOfSlug = (x) => (x === '/' || x === 'index' ? 'index.html' : String(x).replace(/^\/|\.html$/g, '') + '.html');
  if (stage === 'plan') {
    const sys = SYSTEM + '\n' + DESIGN + '\nYou are the art director. Return ONLY one JSON object: {"name":"","description":"","theme":{"primaryColor":"#hex","backgroundColor":"#hex","textColor":"#hex","fontFamily":"a system font stack"},"pages":[{"name":"","slug":"/","sections":[{"title":"","purpose":"","content":"2-3 sentences of real copy"}]}]}. One page unless the request needs more (max 4; the first page has slug "/"). 6 to 8 sections per page, for example hero, key benefits, details or services, proof or testimonials, call to action. Write specific, believable copy for this exact business.';
    const g = await aiJson(sys, `Website request: ${clip(b.prompt, 1500)}.${assetNote}`, 2200, opt);
    const o = g && g.data;
    if (!o || !Array.isArray(o.pages) || !o.pages.length) return null;
    const pages = o.pages.slice(0, 4).map((p, i) => ({
      name: clip((p && p.name) || (i ? 'Page ' + (i + 1) : 'Home'), 40),
      slug: i === 0 ? '/' : clip(String((p && (p.slug || p.name)) || 'page' + i).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page' + i, 30),
      sections: (Array.isArray(p && p.sections) ? p.sections : []).slice(0, 9).map((x) => ({ title: clip(x && x.title, 80), purpose: clip(x && x.purpose, 120), content: clip(x && x.content, 400) })),
    }));
    const t = o.theme || {};
    return { name: clip(o.name || 'My website', 60), description: clip(o.description, 200), theme: { primaryColor: clip(t.primaryColor || '#4f46e5', 20), backgroundColor: clip(t.backgroundColor || '#0f172a', 20), textColor: clip(t.textColor || '#e2e8f0', 20), fontFamily: clip(t.fontFamily || 'system-ui, sans-serif', 120) }, pages, by: g.by };
  }
  const br = b.brief && typeof b.brief === 'object' ? b.brief : null;
  if (!br || !Array.isArray(br.pages) || !br.pages.length) return null;
  const brief = { name: clip(br.name, 60), theme: br.theme || {}, pages: br.pages.slice(0, 4) };
  const briefStr = clip(JSON.stringify(brief), 4500);
  if (stage === 'css') {
    const sys = SYSTEM + '\n' + DESIGN + '\nYou are the CSS designer. Return ONLY JSON: {"css":"..."} containing ONE complete, compact stylesheet (about 250-400 lines) for the whole site. Required: :root variables from the theme (--primary, --bg, --text, --muted, --card, --border, --radius, --shadow); a reset; fluid typography with clamp(); .container{width:min(1100px,92%);margin-inline:auto}; sticky .site-header with .nav links and a mobile menu (.nav-toggle button, .nav.open); .hero with a CSS-only gradient background; .btn, .btn-primary, .btn-ghost; .section and .section-alt; .grid with .grid-2 .grid-3 .grid-4; .card with hover lift; .badge; .stats; .testimonial; .cta; forms (.form, label, input, textarea, select) with clear focus rings; .site-footer; small utility classes (.text-center, .mt-2, .mt-4); :focus-visible outlines; a subtle .reveal fade-in; mobile-first media queries at 640px and 900px; prefers-reduced-motion. No @import, no remote url().';
    const g = await aiJson(sys, 'Design brief: ' + briefStr, 4300, opt);
    const o = g && g.data;
    if (!o || typeof o.css !== 'string' || o.css.length < 400) return null;
    return { css: o.css.replace(/@import[^;]+;/gi, '').replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none').slice(0, 60000), by: g.by };
  }
  if (stage === 'html') {
    const pg = b.page && typeof b.page === 'object' ? b.page : null;
    if (!pg) return null;
    const classes = (Array.isArray(b.classes) ? b.classes : []).filter((c) => typeof c === 'string' && /^[\w-]{1,40}$/.test(c)).slice(0, 110);
    const nav = brief.pages.map((p) => `${p.name} -> ${fileOfSlug(p.slug)}`).join(', ');
    const sys = SYSTEM + '\n' + DESIGN + `\nYou are the front-end developer. Write the BODY INNER HTML for ONE page plus a tiny script. Return ONLY JSON: {"html":"","javascript":""}.\nUse ONLY these CSS classes from the existing stylesheet (write no CSS, no <style> tags): ${classes.join(' ')}.\nStructure: <header class="site-header"> with a brand link and <nav class="nav"> (links: ${nav}; identical on every page) plus <button class="nav-toggle" aria-expanded="false" aria-label="Menu">; then <main> with one <section> per planned section (alternate .section and .section-alt, content inside .container); then <footer class="site-footer">. One h1, an h2 per section, real copy from the plan, forms with labels, simple inline SVG icons allowed. No lorem ipsum, no remote images or scripts.${assetNote}\njavascript: short vanilla JS that toggles .nav.open on .nav-toggle click and updates aria-expanded; nothing heavy.`;
    const g = await aiJson(sys, `Brand: ${brief.name}. Page to write: ${clip(JSON.stringify(pg), 2500)}`, 4200, opt);
    const o = g && g.data;
    if (!o || typeof o.html !== 'string' || o.html.length < 200) return null;
    return { html: o.html.replace(/<\/?(html|head|body)[^>]*>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').slice(0, 80000), javascript: typeof o.javascript === 'string' ? o.javascript.slice(0, 8000) : '', by: g.by };
  }
  return null;
}

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
  if (req.method === 'GET' && req.query && req.query.mistral) { // diagnostic: which Mistral models can this key use?
    try {
      const l = await fetch('https://api.mistral.ai/v1/models', { headers: { Authorization: 'Bearer ' + (process.env.MISTRAL_API_KEY || '') } });
      const d = await l.json();
      return res.status(200).json({ status: l.status, models: (d.data || []).map((m) => m.id), error: d.message || (d.error && d.error.message) });
    } catch (e) { return res.status(500).json({ error: 'list' }); }
  }
  if (req.method === 'GET' && req.query && req.query.groq) { // diagnostic: which Groq models can this key use?
    try {
      const l = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + (process.env.GROQ_API_KEY || '') } });
      const d = await l.json();
      return res.status(200).json({ status: l.status, models: (d.data || []).map((m) => m.id), error: d.error && d.error.message });
    } catch (e) { return res.status(500).json({ error: 'list' }); }
  }
  if (req.method === 'GET' && req.query && req.query.test === 'full') { // diagnostic: one REAL website generation with the first key, shows timing, tokens and whether the JSON is usable
    const ip1 = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), fk = 'full' + ip1 + new Date().toISOString().slice(0, 10), fu = hits.get(fk) || 0;
    if (fu >= 6) return res.status(429).json({ error: 'limit' });
    hits.set(fk, fu + 1);
    const keys1 = geminiKeys(), kn = Math.min(Math.max(Number(req.query.key) || 1, 1), keys1.length || 1), model1 = String(req.query.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash');
    if (!/^[a-z0-9.-]{3,60}$/.test(model1) || !keys1.length) return res.status(400).json({ error: 'input' });
    const t1 = Date.now();
    try {
      const t = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model1}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys1[kn - 1] }, signal: AbortSignal.timeout(55000),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: 'Create a complete multi-page-ready website (at least a Home page; add About/Contact etc. only if useful).\nRequest: A modern portfolio website for a video editor with showreel section, projects grid and contact.' }] }], generationConfig: genConfig(model1, SCHEMA.generate, true) }),
      });
      const j = await t.json().catch(() => ({}));
      const c = j.candidates && j.candidates[0], txt = ((c && c.content && c.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      let parsedOk = false; try { parsedOk = Array.isArray(JSON.parse(txt).pages); } catch (e) {}
      return res.status(200).json({ key: kn, model: model1, status: t.status, seconds: Math.round((Date.now() - t1) / 1000), finishReason: c && c.finishReason, parsedOk, outChars: txt.length, usage: j.usageMetadata, error: j.error && String(j.error.message).slice(0, 200) });
    } catch (e) { return res.status(200).json({ key: kn, model: model1, error: 'failed or timed out', seconds: Math.round((Date.now() - t1) / 1000) }); }
  }
  if (req.method === 'GET' && req.query && req.query.test) { // diagnostic: why is Gemini failing? (tiny real request per key/model)
    const ip0 = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), tk = 'test' + ip0 + new Date().toISOString().slice(0, 10), tu = hits.get(tk) || 0;
    if (tu >= 10) return res.status(429).json({ error: 'limit' });
    hits.set(tk, tu + 1);
    const out = [];
    for (const [ki, k] of geminiKeys().entries()) {
      const results = [];
      for (const m of [...new Set([process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.5-flash'].filter(Boolean))]) {
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
    return res.status(200).json({ groq: !!process.env.GROQ_API_KEY, mistral: !!process.env.MISTRAL_API_KEY, keys: out });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', keySet: geminiKeys().length > 0, geminiKeys: geminiKeys().length, groq: !!process.env.GROQ_API_KEY, mistral: !!process.env.MISTRAL_API_KEY });
  const keys = geminiKeys();
  if (!keys.length && !haveBackup()) return res.status(500).json({ error: 'config' });

  const { mode, prompt, site, page, image, assets, backup, stage } = req.body || {};
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

  if (backup === true && stage && mode === 'generate' && haveBackup()) { // staged backup build (see backupStage)
    if (!['plan', 'css', 'html'].includes(stage)) return res.status(400).json({ error: 'input' });
    const prefer = req.body.prefer === 'groq' || req.body.prefer === 'mistral' ? req.body.prefer : undefined;
    const out = await backupStage(stage, req.body, { prefer, deadline: Date.now() + 52000 });
    if (!out) return res.status(503).json({ error: 'busy' });
    if (stage === 'plan') hits.set(k, used + 1); // one website = one count
    return res.status(200).json({ ...out, via: out.by || 'backup' });
  }
  const text = mode === 'generate'
    ? `Create a complete multi-page-ready website (at least a Home page; add About/Contact etc. only if useful).\nRequest: ${prompt}` + (assets && assets.length ? `\nThe user uploaded images, available at these exact paths: ${assets.join(', ')}. Use them with <img src="..." alt="..."> where they fit (for example a profile photo, hero or logo). Never redraw, recreate or replace them with illustrations or SVG, and never invent other image files. Show them in their original colors: no grayscale, sepia, blur or brightness filters, no mix-blend-mode, no color overlays or reduced opacity on them.` : '')
    : `Existing site (name, theme, pages):\n${JSON.stringify(site)}\nCurrent page slug: ${page || '/'}\nRequested change: ${prompt}\nReturn ONLY pages that changed or are new (full code for each), plus a short summary of the change. If site.assets lists uploaded images, use them only by their exact path (for example <img src="assets/logo.webp" alt="...">) when the user asks to use their image, and never invent other image files. Show uploaded images in their original colors: do not add grayscale, sepia, blur or brightness filters, blend modes, color overlays or reduced opacity to them. Keep the design system and navigation consistent; if adding a page, also return the other pages with updated navigation.`;

  const gnotes = [];
  let gfail = null;
  const viaGemini = async () => {
    if (!keys.length) return { code: 502, body: { error: 'ai', why: 'nokey' } };
  const call = (model, k, ms, lowThink) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
    signal: AbortSignal.timeout(ms),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [
        { text: text + (image ? '\nAn image is attached. Analyze its layout, spacing, typography, colors, cards, buttons and sections and build a similar but ORIGINAL implementation. Do not copy logos, brand names, copyrighted assets or proprietary text.' : '') },
        ...(image ? [{ inlineData: { mimeType: image.mime, data: image.data } }] : []),
      ] }],
      generationConfig: genConfig(model, SCHEMA[mode], lowThink),
    }),
  });
    // Newest Gemini models first (2.5 models now return 404 for new users). Duplicates removed.
    const models = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.5-flash'].filter(Boolean))];
    const t0 = Date.now(), STOP = 42000; // stop starting new Gemini calls after STOP ms (Vercel limit is 60s)
    const wait = (ms) => new Promise((x) => setTimeout(x, ms));
    let busyAny = false, sawLimit = false, last = null;
    for (let round = 0; round < 3; round++) {
      let busy = false, retryAfter = 999;
      for (const [ki, k] of keys.entries()) { // key 1 first, then key 2; Groq is only the very last resort
        for (const m of models) {
          const elapsed = Date.now() - t0;
          if (elapsed > STOP) break;
          let r;
          try {
            r = await call(m, k, Math.max(5000, 55000 - elapsed), true);
            if (r.status === 400) r = await call(m, k, Math.max(5000, 55000 - (Date.now() - t0)), false); // thinkingLevel not accepted by this model? retry without it
          }
          catch (e) { gnotes.push(`${ki + 1}:${m.replace('gemini-', '')}:timeout`); continue; }
          gnotes.push(`${ki + 1}:${m.replace('gemini-', '')}:${r.status}`);
          if (r.ok) {
            const data = await r.json().catch(() => ({}));
            const cand = data?.candidates?.[0];
            const out = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
            if (out) {
              try { return { parsed: JSON.parse(out.replace(/^```json|```$/g, '').trim()), via: 'gemini' }; }
              catch (e) { console.error('JSON parse failed', m, cand?.finishReason, out.slice(-200)); gnotes.push('parse-' + (cand?.finishReason || '')); }
            } else gnotes.push('empty-' + (cand?.finishReason || data?.promptFeedback?.blockReason || 'none'));
            last = { code: 502, body: { error: 'ai', why: 'unusable output' } };
            continue; // unusable answer: try the next model
          }
          if (r.status === 500 || r.status === 503) busy = busyAny = true;
          else if (r.status === 429) { // rate limit: Google often says how long to wait (per-minute limits clear quickly)
            sawLimit = true;
            try { const jb = await r.json(); const di = (jb.error?.details || []).find((x) => x.retryDelay); const sec = di ? parseFloat(di.retryDelay) : NaN; if (sec > 0) retryAfter = Math.min(retryAfter, sec); } catch (e) {}
          }
          else { console.error('Gemini HTTP', m, r.status, (await r.text().catch(() => '')).slice(0, 300)); last = { code: 502, body: { error: 'ai', status: r.status } }; }
          if (r.status === 401 || r.status === 403) break; // this key is rejected or blocked: go to the next key
        }
      }
      const waitMs = busy ? 3000 * (round + 1) : sawLimit && retryAfter <= 25 ? Math.ceil(retryAfter * 1000) + 500 : 0;
      if (!waitMs || Date.now() - t0 + waitMs > STOP || round === 2) break;
      await wait(waitMs);
    }
    if (busyAny) return { code: 503, body: { error: 'busy' } };
    if (sawLimit) return { code: 429, body: { error: 'limit' } };
    return last || { code: 502, body: { error: 'ai', why: 'no model' } };
  };

  // Backup AIs (only after Gemini failed): Mistral first (strong coder, more room), Groq if Mistral is unavailable. Env: MISTRAL_API_KEY, GROQ_API_KEY
  const viaBackup = async () => {
    if (image || !haveBackup()) return null; // a reference image cannot be read by the backup models
    const shape = mode === 'generate'
      ? '{"name":"","description":"","theme":{"primaryColor":"","backgroundColor":"","textColor":"","fontFamily":""},"pages":[{"name":"","slug":"","html":"","css":"","javascript":""}]}'
      : '{"summary":"","pages":[{"name":"","slug":"","html":"","css":"","javascript":""}]}';
    const sys = SYSTEM + '\n' + DESIGN + '\nReturn ONLY one JSON object, no other text, in exactly this shape: ' + shape + '\nKeep the code compact: concise CSS and short JavaScript.';
    const got = await aiJson(sys, text, 7000, { prefer: 'mistral', deadline: Date.now() + 52000 });
    const parsed = got && got.data;
    if (!parsed || !Array.isArray(parsed.pages) || !parsed.pages.length) return null;
    const pages = parsed.pages.map((p) => ({ name: String(p.name || 'Home'), slug: String(p.slug || '/'), html: String(p.html || ''), css: String(p.css || ''), javascript: String(p.javascript || '') }));
    return mode === 'generate'
      ? { parsed: { name: String(parsed.name || 'My website'), description: String(parsed.description || ''), theme: parsed.theme && typeof parsed.theme === 'object' ? parsed.theme : {}, pages }, via: got.by }
      : { parsed: { summary: String(parsed.summary || 'Updated'), pages }, via: got.by };
  };

  // Gemini first. If it fails and a backup AI exists, do NOT switch silently: tell the app (error 'fallback') so the user can choose.
  // The app then re-sends with backup:true, which goes straight to the backup AI.
  const hasBackup = haveBackup() && !image;
  let result;
  if (backup === true && hasBackup) {
    result = (await viaBackup()) || { code: 503, body: { error: 'busy' } };
  } else {
    result = await viaGemini();
    if (!result.parsed) {
      gfail = [...new Set(gnotes)].join(' ') + (result.body && result.body.why ? ' ' + result.body.why : '');
      console.error('Gemini failed:', gfail);
      if (hasBackup) result = { code: 503, body: { error: 'fallback' } };
      result = { ...result, body: { ...result.body, why: gfail.trim() } }; // short codes only; shown in the app's Code line
    }
  }
  if (!result.parsed) return res.status(result.code).json(result.body);
  hits.set(k, used + 1); // only successful results count against the limit
  return res.status(200).json({ ...result.parsed, via: result.via, ...(result.via !== 'gemini' ? { gemini: gfail } : {}), ...(mode === 'generate' ? { remaining: Math.max(0, limit - used - 1) } : {}) });
}

module.exports = handler;
module.exports.config = config;
