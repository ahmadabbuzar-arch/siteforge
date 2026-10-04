// Publishes a generated website as its own Vercel project (public URL).
// Env: VERCEL_TOKEN (required), VERCEL_TEAM_ID (only if your account is a team), PUBLISH_LIMIT (per IP per day, default 5)
const crypto = require('crypto');
const config = { maxDuration: 60 };
const hits = new Map();
const wait = (ms) => new Promise((x) => setTimeout(x, ms));
const sign = (name, token) => crypto.createHmac('sha256', token).update(name).digest('hex').slice(0, 24);

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const token = process.env.VERCEL_TOKEN;
  if (!token) return res.status(501).json({ error: 'config' });

  const { name, pub, files, assets } = req.body || {};
  const entries = files && typeof files === 'object' ? Object.entries(files) : [];
  if (!entries.length || entries.length > 30 || typeof files['index.html'] !== 'string') return res.status(400).json({ error: 'input' });
  let total = 0;
  for (const [f, c] of entries) {
    if (!/^[a-z0-9-]+\.(html|css|js)$/i.test(f) || typeof c !== 'string') return res.status(400).json({ error: 'input' });
    total += c.length;
  }
  const assetEntries = assets && typeof assets === 'object' ? Object.entries(assets) : [];
  if (assetEntries.length > 12) return res.status(400).json({ error: 'input' });
  for (const [f, c] of assetEntries) {
    if (!/^[a-z0-9][a-z0-9._-]{0,60}\.(jpg|png|webp)$/.test(f) || typeof c !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(c)) return res.status(400).json({ error: 'input' });
    total += c.length;
  }
  if (total > 4_000_000) return res.status(413).json({ error: 'size' });

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const k = ip + new Date().toISOString().slice(0, 10), used = hits.get(k) || 0;
  if (used >= Number(process.env.PUBLISH_LIMIT || 5)) return res.status(429).json({ error: 'limit' });
  hits.set(k, used + 1);

  let proj;
  if (pub && typeof pub.name === 'string' && /^sp-[a-z0-9-]{3,60}$/.test(pub.name)) { // republish to the same URL
    if (pub.key !== sign(pub.name, token)) return res.status(403).json({ error: 'key' });
    proj = pub.name;
  } else {
    const slug = String(name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'site';
    proj = `sp-${slug}-${crypto.randomBytes(3).toString('hex')}`;
  }
  const team = process.env.VERCEL_TEAM_ID ? 'teamId=' + encodeURIComponent(process.env.VERCEL_TEAM_ID) : '';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(`https://api.vercel.com/v13/deployments?forceNew=1${team ? '&' + team : ''}`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: proj, target: 'production', projectSettings: { framework: null }, files: [...entries.map(([file, data]) => ({ file, data })), ...assetEntries.map(([f, c]) => ({ file: 'assets/' + f, data: c, encoding: 'base64' }))] }),
    });
    const d = await r.json();
    if (!r.ok) { console.error('Vercel deploy', r.status, JSON.stringify(d).slice(0, 500)); return res.status(502).json({ error: 'publish', status: r.status }); }
    let state = d.readyState, alias = d.alias || [];
    for (let i = 0; i < 20 && !['READY', 'ERROR', 'CANCELED'].includes(state); i++) {
      await wait(2000);
      const g = await (await fetch(`https://api.vercel.com/v13/deployments/${d.id}${team ? '?' + team : ''}`, { headers })).json();
      state = g.readyState; alias = g.alias || alias;
    }
    if (state !== 'READY') return res.status(502).json({ error: 'publish', status: state });
    const host = alias.find((a) => a.startsWith(proj + '.')) || `${proj}.vercel.app`;
    return res.status(200).json({ url: 'https://' + host, name: proj, key: sign(proj, token) });
  } catch (e) {
    console.error('Publish failed:', e);
    return res.status(502).json({ error: 'publish' });
  }
}
module.exports = handler;
module.exports.config = config;
