// Vercel serverless route (CommonJS so it works without package.json settings).
// Env: GEMINI_API_KEY (required), GEMINI_MODEL; optional backups (see PROVIDERS): GROQ_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, XKIRO_API_KEY, REQUESTY_API_KEY (+ REQUESTY_MODEL)
let groqCache = { t: 0, ids: null };
// Remember which Gemini model worked last and pause models that just failed, so a busy model (503) is not retried on every request.
let geminiCache = { t: 0, ids: null };
// Newest Gemini flash models from the live catalogue (full flash first, then the lighter "lite" ones, which often still work when flash is overloaded).
async function geminiModelList(k) {
  if (!geminiCache.ids || Date.now() - geminiCache.t > 600000) {
    try {
      const l = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': k }, signal: AbortSignal.timeout(6000) });
      if (l.ok) geminiCache = { t: Date.now(), ids: ((await l.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace('models/', '')) };
    } catch (e) {}
  }
  const parse = (id) => { const m = id.match(/^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/); return m ? { id, v: parseFloat(m[1]), lite: !!m[2] } : null; };
  const found = (geminiCache.ids || []).map(parse).filter(Boolean);
  const byNew = (a, b) => b.v - a.v;
  const full = found.filter((x) => !x.lite).sort(byNew).slice(0, 4).map((x) => x.id);
  const lite = found.filter((x) => x.lite).sort(byNew).slice(0, 2).map((x) => x.id);
  const list = found.length ? [...full, 'gemini-flash-latest', ...lite, 'gemini-flash-lite-latest'] : ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];
  return [...new Set([process.env.GEMINI_MODEL, ...list].filter(Boolean))];
}
const modelCool = new Map();
let goodModel = null;
// Gemini 3.x: low thinking (faster, leaves room for the JSON); older 2.5 models: thinking off. Temperature left at the default for 3.x.
const genConfig = (model, schema, lowThink) => ({ responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 32000, ...(/2\.5/.test(model) ? { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } } : lowThink ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) });
// Gemini keys in order of use: GEMINI_API_KEY, then GEMINI_API_KEY_2 (also accepts _2 variants, _BACKUP, or a comma list in GEMINI_API_KEYS)
const geminiKeys = () => [...new Set(['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY2', 'GEMINI_API_KEY_BACKUP', 'GEMINI_API_KEY_B'].map((n) => process.env[n]).concat((process.env.GEMINI_API_KEYS || '').split(',')).map((x) => (x || '').trim()).filter(Boolean))];
const kit = require('./_kit.js');
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

// ---------- Backup AIs: several providers working together ----------
const DESIGN = 'Design rules: modern premium look, generous whitespace, 8px spacing scale, fluid type with clamp(), one primary accent colour from the theme used sparingly, soft borders, subtle shadows, rounded cards, clear visual hierarchy, a strong hero, consistent buttons, hover and focus states, smooth subtle transitions, mobile-first with breakpoints, no horizontal overflow, readable contrast, no lorem ipsum, no external fonts or images.';
let mistralCache = { t: 0, ids: null };
const catCache = {};
// All of these speak the OpenAI chat format. Key names accepted in Vercel: see "keys". Optional: <NAME>_MODEL (comma list ok), <NAME>_MAX_TOKENS.
const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1', keys: ['GROQ_API_KEY'], model: 'GROQ_MODEL', timeout: 25000 },
  mistral: { url: 'https://api.mistral.ai/v1', keys: ['MISTRAL_API_KEY'], model: 'MISTRAL_MODEL', timeout: 38000 },
  openrouter: { url: 'https://openrouter.ai/api/v1', keys: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY'], model: 'OPENROUTER_MODEL', timeout: 38000 }, // $0 models only unless you set OPENROUTER_MODEL
  xkiro: { url: process.env.XKIRO_BASE_URL || 'https://api.xkiro.com/v1', keys: ['XKIRO_API_KEY', 'XKIRO_KEY'], model: 'XKIRO_MODEL', timeout: 38000 }, // free-looking models only unless you set XKIRO_MODEL
  requesty: { url: process.env.REQUESTY_BASE_URL || 'https://router.requesty.ai/v1', keys: ['REQUESTY_API_KEY', 'REQUESTY_KEY'], model: 'REQUESTY_MODEL', timeout: 38000 }, // free plan: $0 models only, 200 requests/day shared (set REQUESTY_MODEL to use a paid one)
};
const provKey = (p) => PROVIDERS[p].keys.map((n) => process.env[n]).find(Boolean);
const activeProviders = () => Object.keys(PROVIDERS).filter(provKey);
const haveBackup = () => activeProviders().length > 0;
// Who does what, strongest first. Pages rotate through this list so different AIs write different pages of the same site.
const ORDER = {
  plan: ['groq', 'mistral', 'openrouter', 'xkiro', 'requesty'],
  css: ['mistral', 'openrouter', 'requesty', 'xkiro', 'groq'],
  html: ['mistral', 'openrouter', 'requesty', 'xkiro', 'groq'],
  page: ['mistral', 'openrouter', 'requesty', 'xkiro', 'groq'],
  polish: ['openrouter', 'requesty', 'mistral', 'xkiro', 'groq'],
  oneshot: ['mistral', 'openrouter', 'requesty', 'xkiro', 'groq'],
};
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

const RANK = [/qwen.*coder/i, /deepseek/i, /gpt-oss-120b/i, /glm/i, /kimi/i, /nemotron-3-(ultra|super)/i, /mistral|mixtral/i, /llama.*70b/i, /qwen/i, /gemma/i, /gpt-oss/i];
const NOT_CHAT = /embed|tts|whisper|vision|image|ocr|moderation|guard|safety|audio|leanstral|prover|\bvl\b/i; // not useful for writing websites
const REQUESTY_FREE = ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-ultra-550b-a55b']; // ids Requesty documents as $0 (used only if its catalogue has no price info)
const priceOf = (e) => { const v = [e.pricing && e.pricing.prompt, e.pricing && e.pricing.completion, e.pricing && e.pricing.input, e.pricing && e.pricing.output, e.input_price, e.output_price, e.prompt_price, e.completion_price].filter((x) => x !== undefined && x !== null && x !== ''); return v.length ? v.map(Number) : null; };
const looksFree = (e) => /free/i.test(e.id) || (() => { const v = priceOf(e); return !!v && v.every((n) => n === 0); })();
async function modelList(p) {
  const explicit = String(process.env[PROVIDERS[p].model] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const key = provKey(p);
  if (p === 'groq') return [...new Set([...explicit, ...(await groqModelList(key))])];
  if (p === 'mistral') return [...new Set([...explicit, ...(await mistralModelList(key))])];
  // OpenRouter / Xkiro / Requesty: read their live catalogue and use only models priced at $0 (best coders first). Set <NAME>_MODEL to choose another one yourself.
  if (!catCache[p] || Date.now() - catCache[p].t > 600000) {
    try {
      const l = await fetch(PROVIDERS[p].url + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(7000) });
      if (l.ok) catCache[p] = { t: Date.now(), data: (await l.json()).data || [] };
    } catch (e) {}
  }
  const data = ((catCache[p] && catCache[p].data) || []).filter((e) => e && typeof e.id === 'string' && !NOT_CHAT.test(e.id));
  let free = data.filter((e) => looksFree(e) && (!e.context_length || e.context_length >= 32000));
  if (p === 'requesty' && !free.length && !data.some(priceOf)) free = data.length ? data.filter((e) => REQUESTY_FREE.includes(e.id)) : REQUESTY_FREE.map((id) => ({ id }));
  const rank = (id) => { const k = RANK.findIndex((rx) => rx.test(id)); return k < 0 ? 99 : k; };
  return [...new Set([...explicit, ...free.sort((a, b) => rank(a.id) - rank(b.id)).slice(0, 3).map((e) => e.id)])];
}
async function oneProvider(p, sys, user, maxTokens, deadline) {
  const cfg = PROVIDERS[p], key = provKey(p);
  if (!key) return null;
  // Groq's free plan has a small per-minute token budget; the others have more room, so they may write longer output.
  const cap = p === 'groq' ? Math.min(maxTokens, Number(process.env.GROQ_MAX_TOKENS || 6000)) : Math.min(Math.round(maxTokens * (p === 'mistral' ? 1.6 : 1.4)), Number(process.env[p.toUpperCase() + '_MAX_TOKENS'] || (p === 'mistral' ? 12000 : 10000)));
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, ...(p === 'openrouter' ? { 'HTTP-Referer': 'https://sitepilotog.vercel.app', 'X-Title': 'SitePilot' } : {}) };
  for (const m of await modelList(p)) {
    for (const jsonMode of [true, false]) { // some models reject JSON mode: then ask again without it
      const left = (deadline || Infinity) - Date.now();
      if (left < 4000) return null; // out of time (Vercel stops the function at 60s)
      try {
        const r = await fetch(cfg.url + '/chat/completions', {
          method: 'POST', headers, signal: AbortSignal.timeout(Math.min(cfg.timeout, left)),
          body: JSON.stringify({ model: m, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.6, max_tokens: cap, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}) }),
        });
        if (!r.ok) { console.error(p, 'HTTP', m, r.status, (await r.text()).slice(0, 300)); if (r.status === 400 && jsonMode) continue; break; }
        const d = await r.json();
        const t = String(d?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```json|```$/g, '').trim();
        const a = t.indexOf('{'), z = t.lastIndexOf('}');
        return JSON.parse(a >= 0 && z > a ? t.slice(a, z + 1) : t);
      } catch (e) { console.error(p, 'failed', m, e && e.message); break; }
    }
  }
  return null;
}
// Asks the best AI for this job first and the others if it fails, so any of them can cover for another.
async function aiJson(sys, user, maxTokens, opt = {}) {
  let order = (ORDER[opt.stage] || ORDER.oneshot).filter(provKey);
  if (opt.prefer && order.includes(opt.prefer)) order = [opt.prefer, ...order.filter((p) => p !== opt.prefer)];
  if (opt.slot && order.length) { const k = opt.slot % order.length; order = [...order.slice(k), ...order.slice(0, k)]; } // page 2 starts with the next AI
  if (opt.avoid) order = [...order.filter((p) => p !== opt.avoid), ...order.filter((p) => p === opt.avoid)];
  for (const p of order) {
    const data = await oneProvider(p, sys, user, maxTokens, opt.deadline);
    if (data) return { data, by: p };
  }
  return null;
}
// Two steps build a site with the SitePilot Kit (api/_kit.js): the AIs write the PLAN and the CONTENT; the kit supplies the polished design.
// plan (one AI) -> page content for every page (different AIs in parallel) -> the kit renders HTML and CSS.
async function backupStage(stage, b, opt) {
  const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const assets = (Array.isArray(b.assets) ? b.assets : []).filter((a) => typeof a === 'string' && /^assets\/[a-z0-9._-]{1,70}$/.test(a)).slice(0, 12);
  if (stage === 'plan') {
    const short = kit.shortlist(String(b.prompt || ''));
    const sys = 'You are a senior creative director and information architect at a top web agency. Plan a premium website for the request. Return ONLY one JSON object: {"name":"","tagline":"max 8 words","description":"1 sentence","preset":"id","brandColor":"#hex or empty","contactEmail":"only if the user wrote one, else empty","tone":"2-4 words","navCta":{"label":"max 3 words","target":"contact"},"pages":[{"name":"Home","slug":"/","sections":[{"type":"hero","label":"Home"}]}]}.\n'
      + `preset: choose exactly one of these looks: ${kit.presetMenu(short)}. Pick the best fit for this business.\n`
      + `Pages: one page for simple businesses; up to 4 pages only when the request clearly needs them (for example About, Services, Contact). Every page has 4 to 8 sections. Section types: ${kit.TYPES.join(', ')}. Home starts with a hero (hero only once, only on Home). Choose sections that suit THIS business and vary the order; do not repeat one fixed sequence. Exactly one page holds a contact section. End Home with cta unless Home holds the contact section. label = the menu text, max 14 characters. Use the business name the user gave, or invent a short brand name. brandColor only if the user named a colour, else "".`
      + (assets.length ? ' The visitor uploaded their own photos; the site places them automatically (hero and sections).' : '');
    const g = await aiJson(sys, `Website request: ${clip(b.prompt, 1500)}`, 1700, { ...opt, stage: 'plan' });
    if (!g || !g.data || typeof g.data !== 'object') return null;
    const plan = kit.normalizePlan(g.data, String(b.prompt || ''));
    return { ...plan, theme: kit.themeSummary(plan), css: kit.kitCss(plan), by: g.by };
  }
  if (stage === 'page') {
    if (!b.brief || typeof b.brief !== 'object') return null;
    const plan = kit.normalizePlan(b.brief, '');
    const idx = Number.isInteger(b.pageIndex) ? b.pageIndex : -1;
    if (idx < 0 || idx >= plan.pages.length) return null;
    const page = plan.pages[idx], types = [...new Set(page.sections.map((x) => x.type))];
    const sys = 'You are a senior conversion copywriter. Write the content for ONE page of a website. Return ONLY JSON: {"sections":[...]} containing exactly these sections in this order: ' + page.sections.map((x) => `${x.type} ("${x.label}")`).join(', ') + '.\n'
      + 'Shape of each section:\n' + types.map((t) => kit.DOCS[t]).join('\n') + '\n'
      + 'Rules: specific, persuasive, benefit-led copy for this exact business; short sentences; no lorem ipsum; never invent phone numbers, emails, street addresses, awards or claims about real companies; testimonials are generic (first name + role); figures stay modest and plausible; any prices are sample placeholders. cta/button target is "contact", a page slug, or a section type on this page. Icons must be one of: star, bolt, shield, heart, chart, users, clock, globe, camera, code, leaf, play, mail, pin, gift.'
      + (assets.length ? ' The visitor uploaded their own photos; the site places them automatically, so do not mention image files.' : '');
    const user = `Brand: ${plan.name}. Tagline: ${plan.tagline}. About: ${plan.description}. Tone: ${plan.tone || 'confident and friendly'}. This page: ${page.name}. Other pages: ${plan.pages.filter((p, i) => i !== idx).map((p) => p.name).join(', ') || 'none'}. Original request: ${clip(b.prompt, 800)}`;
    const g = await aiJson(sys, user, 3600, { ...opt, stage: 'page' });
    const raw = g && g.data;
    if (!raw || !Array.isArray(raw.sections)) return null;
    const sections = kit.cleanPageContent(plan, idx, raw);
    return { html: kit.renderPage(plan, idx, sections, assets), javascript: idx === 0 ? kit.pageJs : '', by: g.by };
  }
  return null;
}

// ---------- Prompt helper: turns a short idea into a detailed website prompt ----------
const PROMPT_SYS = 'You write website briefs for an AI website builder. The user gives a short idea (any language, even a few words). Turn it into ONE detailed prompt in English that an AI web designer can build from. Include: the business or brand and its audience; the goal of the site; the pages (max 4) and, for each page, the key sections in order; specific content ideas (real-sounding headings, services or features, and testimonials or pricing only where they fit); the visual style (mood, a colour palette with hex codes, typography feel, imagery approach using CSS shapes or the visitor\'s own uploaded photos); useful features (contact form, WhatsApp button, booking, gallery, and so on, only if they fit); the tone of voice; mobile-first and accessibility requirements. Invent sensible details where the user gave none, but never invent real phone numbers, addresses, claims about real companies or important prices. 180-300 words, plain text paragraphs, no markdown headings, no preamble. If the user wants the website text in a specific language, say so in the prompt. Return ONLY JSON: {"prompt":"..."}';
async function promptTool(idea) {
  const user = 'Website idea from the user: ' + idea.slice(0, 600);
  const schema = { type: 'OBJECT', properties: { prompt: { type: 'STRING' } }, required: ['prompt'] };
  const keys = geminiKeys(), t0 = Date.now();
  if (keys.length) {
    const models = (await geminiModelList(keys[0])).slice(0, 3);
    for (const k of keys) {
      for (const m of models) {
        if (Date.now() - t0 > 30000) break;
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k }, signal: AbortSignal.timeout(20000),
            body: JSON.stringify({ systemInstruction: { parts: [{ text: PROMPT_SYS }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { ...genConfig(m, schema, true), maxOutputTokens: 2000 } }),
          });
          if (r.status === 401 || r.status === 403) break; // this key is blocked: next key
          if (!r.ok) continue;
          const d = await r.json();
          const txt = ((d?.candidates?.[0]?.content?.parts) || []).filter((x) => !x.thought).map((x) => x.text || '').join('');
          const p = JSON.parse(txt).prompt;
          if (typeof p === 'string' && p.length > 80) return { prompt: p.trim(), via: 'gemini' };
        } catch (e) {}
      }
    }
  }
  const g = await aiJson(PROMPT_SYS, user, 1400, { stage: 'plan', deadline: Date.now() + 25000 }); // quiet fallback to the backup AIs: this is a small helper, not a website
  const p = g && g.data && g.data.prompt;
  return typeof p === 'string' && p.length > 80 ? { prompt: p.trim(), via: g.by } : null;
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
  if (req.method === 'GET' && req.query && req.query.providers) { // diagnostic: which backup AIs are connected and which model each will use (one tiny request each)
    const ipp = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), pk = 'prov' + ipp + new Date().toISOString().slice(0, 10), pu = hits.get(pk) || 0;
    if (pu >= 10) return res.status(429).json({ error: 'limit' });
    hits.set(pk, pu + 1);
    const out = [];
    for (const p of activeProviders()) {
      const models = await modelList(p);
      if (!models.length) { out.push({ provider: p, model: null, note: 'no free model found, set ' + PROVIDERS[p].model }); continue; }
      try {
        const t = await fetch(PROVIDERS[p].url + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + provKey(p), ...(p === 'openrouter' ? { 'HTTP-Referer': 'https://sitepilotog.vercel.app', 'X-Title': 'SitePilot' } : {}) }, body: JSON.stringify({ model: models[0], messages: [{ role: 'user', content: 'Reply with the word ok' }], max_tokens: 8 }) });
        out.push({ provider: p, model: models[0], status: t.status, msg: t.ok ? '' : (await t.text()).slice(0, 140) });
      } catch (e) { out.push({ provider: p, model: models[0], status: 'failed or timed out' }); }
    }
    return res.status(200).json({ providers: out });
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
    return res.status(200).json({ backups: activeProviders(), keys: out });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', keySet: geminiKeys().length > 0, geminiKeys: geminiKeys().length, backups: activeProviders() });
  const keys = geminiKeys();
  if (!keys.length && !haveBackup()) return res.status(500).json({ error: 'config' });

  const { mode, prompt, site, page, image, assets, backup, stage } = req.body || {};
  if (!['generate', 'edit', 'prompt'].includes(mode) || typeof prompt !== 'string' || (prompt.trim().length < 3 && !image) || prompt.length > 4000)
    return res.status(400).json({ error: 'input' });
  if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mime) || typeof image.data !== 'string' || image.data.length > 3_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.data)))
    return res.status(400).json({ error: 'image' });
  if (assets && (!Array.isArray(assets) || assets.length > 12 || assets.some((a) => !/^assets\/[a-z0-9._-]{1,70}$/.test(a)))) return res.status(400).json({ error: 'input' });
  if (JSON.stringify(site || {}).length > 400000) return res.status(413).json({ error: 'size' });

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10), k = ip + day + mode; // separate counters for generate and edit
  const limit = mode === 'generate' ? Number(process.env.GENERATE_LIMIT || 100) : mode === 'prompt' ? Number(process.env.PROMPT_LIMIT || 20) : Number(process.env.EDIT_LIMIT || 30), used = hits.get(k) || 0;
  if (used >= limit) return res.status(429).json({ error: 'limit', remaining: 0 });

  if (mode === 'prompt') {
    if (prompt.length > 600) return res.status(400).json({ error: 'input' });
    const out = await promptTool(prompt);
    if (!out) return res.status(503).json({ error: 'busy' });
    hits.set(k, used + 1);
    return res.status(200).json(out);
  }
  if (backup === true && stage && mode === 'generate' && haveBackup()) { // staged backup build (see backupStage)
    if (!['plan', 'page'].includes(stage)) return res.status(400).json({ error: 'input' });
    const nm = (v) => (typeof v === 'string' && PROVIDERS[v] ? v : undefined);
    const out = await backupStage(stage, req.body, { prefer: nm(req.body.prefer), avoid: nm(req.body.avoid), slot: Number.isInteger(req.body.slot) && req.body.slot > 0 && req.body.slot < 10 ? req.body.slot : 0, deadline: Date.now() + 52000 });
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
    const allModels = await geminiModelList(keys[0]);
    const t0 = Date.now(), STOP = 42000; // stop starting new Gemini calls after STOP ms (Vercel limit is 60s)
    const wait = (ms) => new Promise((x) => setTimeout(x, ms));
    let busyAny = false, sawLimit = false, last = null;
    for (let round = 0; round < 3; round++) {
      let busy = false, retryAfter = 999;
      for (const [ki, k] of keys.entries()) { // key 1 first, then key 2; Groq is only the very last resort
        const live = allModels.filter((m) => !((modelCool.get(ki + '|' + m) || 0) > Date.now())); // skip models that failed in the last 2 minutes
        let order = live.length ? live : allModels;
        if (goodModel && order.includes(goodModel)) order = [goodModel, ...order.filter((m) => m !== goodModel)];
        for (const m of order) {
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
              try { const parsed = JSON.parse(out.replace(/^```json|```$/g, '').trim()); goodModel = m; return { parsed, via: 'gemini' }; }
              catch (e) { console.error('JSON parse failed', m, cand?.finishReason, out.slice(-200)); gnotes.push('parse-' + (cand?.finishReason || '')); }
            } else gnotes.push('empty-' + (cand?.finishReason || data?.promptFeedback?.blockReason || 'none'));
            last = { code: 502, body: { error: 'ai', why: 'unusable output' } };
            continue; // unusable answer: try the next model
          }
          if (r.status === 500 || r.status === 503 || r.status === 429) modelCool.set(ki + '|' + m, Date.now() + 120000);
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
    const got = await aiJson(sys, text, 7000, { stage: 'oneshot', deadline: Date.now() + 52000 });
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
