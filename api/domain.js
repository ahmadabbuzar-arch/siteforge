// Connect / check / remove a custom domain on a published SitePilot website (Vercel Domains API).
// Env: VERCEL_TOKEN (same as publish), VERCEL_TEAM_ID (only if your account is a team)
const crypto = require('crypto');
const config = { maxDuration: 30 };
const hits = new Map();
const sign = (name, token) => crypto.createHmac('sha256', token).update(name).digest('hex').slice(0, 24);
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const apexLen = (p) => (p.length >= 3 && p[p.length - 1].length === 2 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(p[p.length - 2]) ? 3 : 2);

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const token = process.env.VERCEL_TOKEN;
  if (!token) return res.status(501).json({ error: 'config' });

  const { action, domain, pub } = req.body || {};
  const dom = String(domain || '').toLowerCase();
  if (!['add', 'check', 'remove'].includes(action) || !DOMAIN.test(dom) || /(^|\.)vercel\.(app|com)$/.test(dom)) return res.status(400).json({ error: 'input' });
  if (!pub || typeof pub.name !== 'string' || !/^sp-[a-z0-9-]{3,60}$/.test(pub.name) || pub.key !== sign(pub.name, token)) return res.status(403).json({ error: 'key' });

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const k = ip + new Date().toISOString().slice(0, 10), used = hits.get(k) || 0;
  if (used >= 40) return res.status(429).json({ error: 'limit' });
  hits.set(k, used + 1);

  const proj = pub.name;
  const qs = process.env.VERCEL_TEAM_ID ? '?teamId=' + encodeURIComponent(process.env.VERCEL_TEAM_ID) : '';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const api = (method, path, body) => fetch('https://api.vercel.com' + path + qs, { method, headers, body: body ? JSON.stringify(body) : undefined });
  try {
    if (action === 'remove') {
      await api('DELETE', `/v9/projects/${proj}/domains/${dom}`);
      return res.status(200).json({ ok: true });
    }
    let info;
    if (action === 'add') {
      const r = await api('POST', `/v10/projects/${proj}/domains`, { name: dom });
      if (r.status === 409) { // already attached? then fine, otherwise it belongs to someone else
        const g = await api('GET', `/v9/projects/${proj}/domains/${dom}`);
        if (!g.ok) return res.status(409).json({ error: 'taken' });
        info = await g.json();
      } else if (!r.ok) {
        console.error('Add domain', r.status, (await r.text()).slice(0, 400));
        return res.status(502).json({ error: 'domain', status: r.status });
      } else info = await r.json();
    } else {
      const g = await api('GET', `/v9/projects/${proj}/domains/${dom}`);
      if (!g.ok) return res.status(404).json({ error: 'notfound' });
      info = await g.json();
    }
    if (!info.verified) {
      const v = await api('POST', `/v9/projects/${proj}/domains/${dom}/verify`);
      if (v.ok) info = { ...info, ...(await v.json()) };
    }
    let cfg = {};
    try { const c = await api('GET', `/v6/domains/${dom}/config`); if (c.ok) cfg = await c.json(); } catch (e) {}
    const mis = cfg.misconfigured === undefined ? true : cfg.misconfigured;
    const parts = dom.split('.'), n = apexLen(parts), apex = parts.slice(-n).join('.'), isApex = parts.length === n;
    const records = [];
    if (!info.verified) (info.verification || []).forEach((v) => records.push({ type: v.type, name: v.domain.endsWith('.' + apex) ? v.domain.slice(0, -(apex.length + 1)) : v.domain, value: v.value }));
    if (mis) {
      if (isApex) {
        const a = (cfg.recommendedIPv4 || []).find((x) => x.rank === 1);
        records.push({ type: 'A', name: '@', value: (a && a.value && a.value[0]) || '76.76.21.21' });
      } else {
        const c = (cfg.recommendedCNAME || []).find((x) => x.rank === 1);
        records.push({ type: 'CNAME', name: parts.slice(0, -n).join('.'), value: (c && c.value) || 'cname.vercel-dns.com' });
      }
    }
    return res.status(200).json({ name: dom, ready: !!info.verified && !mis, verified: !!info.verified, records });
  } catch (e) {
    console.error('Domain failed:', e);
    return res.status(502).json({ error: 'domain' });
  }
}
module.exports = handler;
module.exports.config = config;
