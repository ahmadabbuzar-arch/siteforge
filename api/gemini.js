// Vercel serverless route. Env: GEMINI_API_KEY (required), GEMINI_MODEL, DAILY_LIMIT
const hits = new Map(); // in-memory per-IP counter; use Firebase/Upstash for real limits

const SYSTEM = `You are a professional web developer. Generate clean, responsive, accessible HTML/CSS/JavaScript. Maintain the existing design system when editing. Do not remove existing functionality unless explicitly requested. Return valid structured JSON. Never include markdown code fences inside code fields.
Rules: each page "html" is BODY INNER HTML only (no html/head/body tags). Use semantic HTML, alt text, labels, one h1, visible focus, readable contrast. CSS must be mobile-first, use relative units and media queries, support 320px+, no horizontal overflow. Navigation links must use hrefs like index.html, about.html (slug "/" = index.html) and be identical on every page. All pages share the same CSS design system (put shared CSS in the first page; others may add only page-specific CSS). No external scripts, no remote images (use CSS shapes/gradients or inline SVG). Original content only, no copyrighted brands.`;

const PAGE = { type: 'OBJECT', properties: { name: { type: 'STRING' }, slug: { type: 'STRING' }, html: { type: 'STRING' }, css: { type: 'STRING' }, javascript: { type: 'STRING' } }, required: ['name', 'slug', 'html', 'css', 'javascript'] };
const SCHEMA = {
  generate: { type: 'OBJECT', properties: { name: { type: 'STRING' }, description: { type: 'STRING' }, theme: { type: 'OBJECT', properties: { primaryColor: { type: 'STRING' }, backgroundColor: { type: 'STRING' }, textColor: { type: 'STRING' }, fontFamily: { type: 'STRING' } } }, pages: { type: 'ARRAY', items: PAGE } }, required: ['name', 'description', 'theme', 'pages'] },
  edit: { type: 'OBJECT', properties: { summary: { type: 'STRING' }, pages: { type: 'ARRAY', items: PAGE } }, required: ['summary', 'pages'] },
};

export const config = { maxDuration: 60 }; // full-site generation takes >10s (Vercel default)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', keySet: !!process.env.GEMINI_API_KEY });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'config' });

  const { mode, prompt, site, page, image } = req.body || {};
  if (!['generate', 'edit'].includes(mode) || typeof prompt !== 'string' || (prompt.trim().length < 3 && !image) || prompt.length > 4000)
    return res.status(400).json({ error: 'input' });
  if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mime) || typeof image.data !== 'string' || image.data.length > 3_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image.data)))
    return res.status(400).json({ error: 'image' });
  if (JSON.stringify(site || {}).length > 400000) return res.status(413).json({ error: 'size' });

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10), k = ip + day;
  const limit = Number(process.env.DAILY_LIMIT || 10), used = hits.get(k) || 0;
  if (used >= limit) return res.status(429).json({ error: 'limit', remaining: 0 });
  hits.set(k, used + 1);

  const text = mode === 'generate'
    ? `Create a complete multi-page-ready website (at least a Home page; add About/Contact etc. only if useful).\nRequest: ${prompt}`
    : `Existing site (name, theme, pages):\n${JSON.stringify(site)}\nCurrent page slug: ${page || '/'}\nRequested change: ${prompt}\nReturn ONLY pages that changed or are new (full code for each), plus a short summary of the change. Keep the design system and navigation consistent; if adding a page, also return the other pages with updated navigation.`;

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [
          { text: text + (image ? '\nAn image is attached. Analyze its layout, spacing, typography, colors, cards, buttons and sections and build a similar but ORIGINAL implementation. Do not copy logos, brand names, copyrighted assets or proprietary text.' : '') },
          ...(image ? [{ inlineData: { mimeType: image.mime, data: image.data } }] : []),
        ] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA[mode], temperature: 0.7, maxOutputTokens: 32000, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (r.status === 429) return res.status(429).json({ error: 'limit' });
    if (!r.ok) { console.error('Gemini HTTP', r.status, (await r.text()).slice(0, 500)); return res.status(502).json({ error: 'ai', status: r.status }); }
    const data = await r.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(out.replace(/^```json|```$/g, '').trim());
    return res.status(200).json({ ...parsed, remaining: Math.max(0, limit - used - 1) });
  } catch (e) {
    console.error('Gemini parse/fetch failed:', e);
    return res.status(502).json({ error: 'ai' });
  }
}
