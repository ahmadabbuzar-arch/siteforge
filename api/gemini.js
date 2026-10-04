// Vercel serverless route (CommonJS so it works without package.json settings). Env: GEMINI_API_KEY (required), GEMINI_MODEL, DAILY_LIMIT
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
      const l = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY || '' } });
      const d = await l.json();
      return res.status(200).json({ status: l.status, models: (d.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name), error: d.error && d.error.message });
    } catch (e) { return res.status(500).json({ error: 'list' }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', keySet: !!process.env.GEMINI_API_KEY });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'config' });

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

  try {
    const call = (model) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [
          { text: text + (image ? '\nAn image is attached. Analyze its layout, spacing, typography, colors, cards, buttons and sections and build a similar but ORIGINAL implementation. Do not copy logos, brand names, copyrighted assets or proprietary text.' : '') },
          ...(image ? [{ inlineData: { mimeType: image.mime, data: image.data } }] : []),
        ] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA[mode], temperature: 0.7, maxOutputTokens: 32000, ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
      }),
    });
    let r;
    const wait = (ms) => new Promise((x) => setTimeout(x, ms));
    for (const m of [process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'].filter(Boolean)) {
      r = await call(m);
      if (r.status === 503 || r.status === 500) { await wait(1500); r = await call(m); } // overloaded: one quick retry
      if (![403, 404, 429, 500, 503].includes(r.status)) break; // otherwise try the next model
    }
    if (r.status === 429) return res.status(429).json({ error: 'limit' });
    if (r.status === 503) return res.status(503).json({ error: 'busy' });
    if (!r.ok) {
      const t = (await r.text()).slice(0, 600);
      console.error('Gemini HTTP', r.status, t);
      return res.status(502).json({ error: 'ai', status: r.status }); // msg stays in server logs only
    }
    const data = await r.json();
    const cand = data?.candidates?.[0];
    const out = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (!out) return res.status(502).json({ error: 'ai', why: 'empty ' + (cand?.finishReason || data?.promptFeedback?.blockReason || 'none') });
    let parsed;
    try { parsed = JSON.parse(out.replace(/^```json|```$/g, '').trim()); }
    catch (e) { console.error('JSON parse failed', cand?.finishReason, out.slice(-200)); return res.status(502).json({ error: 'ai', why: 'parse ' + (cand?.finishReason || '') }); }
    hits.set(k, used + 1); // only successful results count against the limit
    return res.status(200).json({ ...parsed, ...(mode === 'generate' ? { remaining: Math.max(0, limit - used - 1) } : {}) });
  } catch (e) {
    console.error('Gemini fetch failed:', e);
    return res.status(502).json({ error: 'ai', why: 'fetch' });
  }
}

module.exports = handler;
module.exports.config = config;
