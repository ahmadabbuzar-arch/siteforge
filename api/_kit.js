'use strict';
// SitePilot Kit: a hand-made design system plus an HTML renderer. The backup AIs only write CONTENT (JSON);
// this file turns it into a consistent, polished website. Different presets give different art directions.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const hexOr = (h, d) => (/^#[0-9a-f]{6}$/i.test(String(h || '')) ? String(h).toLowerCase() : d);
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const rgba = (h, a) => `rgba(${rgb(h).join(',')},${a})`;
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const ink = (h) => (cr(h, '#0b0b0f') >= cr(h, '#ffffff') ? '#0b0b0f' : '#ffffff'); // whichever of black/white reads better on this colour
const mix = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const readable = (c, bg, toward) => { let x = c; for (let i = 0; i <= 10 && cr(x, bg) < 3.4; i++) x = mix(c, toward, i / 10); return x; }; // keep text-coloured accents legible

const SANS = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
const SERIF = '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,"Times New Roman",serif';
const MONO = 'ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';
const ROUND = 'ui-rounded,"SF Pro Rounded",Nunito,Quicksand,"Segoe UI",system-ui,sans-serif';

const PRESETS = {
  aurora: { desc: 'dark indigo with a cyan glow, modern and techy (software, creative studios, video, apps)', bg: '#0a0f1f', bg2: '#0e1530', surface: '#121a36', text: '#eef2ff', muted: '#a3aed0', primary: '#7c8cff', accent: '#22d3ee', head: SANS, body: SANS, weight: 750, track: '-0.025em', radius: 18, btn: 999, bw: 1, shadow: 'dark', hero: 'split', bento: true },
  luxe: { desc: 'dark charcoal with gold and an elegant serif (fine dining, weddings, jewellery, hotels, photographers)', bg: '#0b0a09', bg2: '#12100d', surface: '#171410', text: '#f5efe3', muted: '#b3a994', primary: '#d4af37', accent: '#f2dd9b', head: SERIF, body: SANS, weight: 500, track: '-0.01em', radius: 6, btn: 4, bw: 1, shadow: 'dark', hero: 'center' },
  swiss: { desc: 'clean white with black type and one hot accent, editorial and minimal (portfolios, agencies, architects, consultants)', bg: '#ffffff', bg2: '#f4f4f2', surface: '#ffffff', text: '#0a0a0a', muted: '#5b5b57', primary: '#0a0a0a', accent: '#ff4d2e', head: SANS, body: SANS, weight: 800, track: '-0.04em', radius: 4, btn: 2, bw: 1, shadow: 'light', hero: 'left' },
  candy: { desc: 'soft warm pastels with very round shapes, friendly (salons, bakeries, kids, wellness, classes)', bg: '#fff8f3', bg2: '#ffeee3', surface: '#ffffff', text: '#2a2230', muted: '#6f6477', primary: '#ff6b81', accent: '#7c5cff', head: ROUND, body: ROUND, weight: 800, track: '-0.01em', radius: 26, btn: 999, bw: 1, shadow: 'light', hero: 'split' },
  forest: { desc: 'earthy green on cream with a calm serif (organic, farms, cafes, yoga, nature, resorts)', bg: '#f5f2e9', bg2: '#ebe6d6', surface: '#fbf9f3', text: '#1d2a1f', muted: '#566454', primary: '#2f6b3f', accent: '#c98a2b', head: SERIF, body: SANS, weight: 600, track: '-0.015em', radius: 14, btn: 999, bw: 1, shadow: 'light', hero: 'split' },
  brutal: { desc: 'bold yellow and black, thick borders, hard shadows, playful (creators, streetwear, music, bold young brands)', bg: '#fff8e1', bg2: '#ffefb8', surface: '#ffffff', text: '#111111', muted: '#3d3d3d', primary: '#ffd21f', accent: '#ff5ca8', head: SANS, body: SANS, weight: 900, track: '-0.03em', radius: 0, btn: 0, bw: 3, shadow: 'brutal', hero: 'left' },
  neon: { desc: 'near-black with neon green and magenta, monospace headings (gaming, esports, crypto, nightlife, streamers)', bg: '#05060b', bg2: '#090b14', surface: '#0d1019', text: '#e9f1ff', muted: '#8f9bb8', primary: '#00f5a0', accent: '#ff3df2', head: MONO, body: SANS, weight: 700, track: '-0.02em', radius: 10, btn: 8, bw: 1, shadow: 'glow', hero: 'split', bento: true },
  ocean: { desc: 'clean blue and white, trustworthy and corporate (business, clinics, finance, real estate, education)', bg: '#f6f9fc', bg2: '#e9f1f9', surface: '#ffffff', text: '#0b1f33', muted: '#52657a', primary: '#0b63ce', accent: '#00b894', head: SANS, body: SANS, weight: 750, track: '-0.025em', radius: 14, btn: 10, bw: 1, shadow: 'light', hero: 'split' },
  ember: { desc: 'dark warm brown with orange and amber, energetic (gyms, cars, barbers, food, sports, music)', bg: '#120c09', bg2: '#1a110c', surface: '#1f1510', text: '#fff3ea', muted: '#c4a898', primary: '#ff7a2f', accent: '#ffc857', head: SANS, body: SANS, weight: 800, track: '-0.03em', radius: 12, btn: 12, bw: 1, shadow: 'dark', hero: 'left' },
};
const FIT = {
  aurora: /saas|app\b|software|startup|tech|\bai\b|dashboard|developer|studio|digital|video|editor|creative|film|animation|agency/i,
  luxe: /restaurant|fine dining|wedding|photograph|luxury|jewel|hotel|spa\b|event|lounge|boutique|fashion|perfume/i,
  swiss: /portfolio|architect|design|minimal|consult|law|journal|magazine|studio|freelanc/i,
  candy: /salon|beauty|makeup|kids|bakery|cake|school|coaching|yoga|wellness|florist|toy|pet|nail|tuition|class/i,
  forest: /organic|farm|garden|nature|cafe|coffee|eco|plant|ayurved|herbal|resort|trek|travel|tea\b/i,
  brutal: /creator|streetwear|merch|music|band|youtube|podcast|art\b|artist|playful|youth|zine/i,
  neon: /game|gaming|esport|crypto|web3|nightlife|club|\bdj\b|stream|hacker|cyber|discord/i,
  ocean: /business|consult|clinic|doctor|hospital|dental|finance|insurance|real estate|logistics|education|corporate|accounting|company|service/i,
  ember: /gym|fitness|crossfit|\bcar\b|auto|garage|bike|food truck|bbq|barber|sports|workout|boxing|restaurant|burger|pizza/i,
};
function shortlist(prompt) { // two best-fitting looks plus one surprise, shuffled, so similar requests do not always look alike
  const ids = Object.keys(PRESETS), score = (id) => (String(prompt).match(new RegExp(FIT[id].source, 'gi')) || []).length;
  const ranked = ids.map((id) => [id, score(id) + Math.random() * 0.5]).sort((a, b) => b[1] - a[1]);
  const top = ranked.filter((x) => x[1] >= 1).slice(0, 2).map((x) => x[0]);
  const rest = ids.filter((id) => !top.includes(id)).sort(() => Math.random() - 0.5);
  return [...top, ...rest.slice(0, 3 - top.length)].sort(() => Math.random() - 0.5);
}
const presetMenu = (list) => list.map((id) => `"${id}" = ${PRESETS[id].desc}`).join('; ');

const TYPES = ['hero', 'features', 'split', 'stats', 'work', 'steps', 'testimonials', 'pricing', 'faq', 'cta', 'contact'];
const DOCS = {
  hero: '{"type":"hero","eyebrow":"short label","title":"benefit-led headline, 6-12 words","text":"1-2 sentences","cta1":{"label":"","target":"contact"},"cta2":{"label":"","target":"features"},"proof":[{"value":"120+","label":"projects delivered"}]} (proof: 2-3 modest, plausible figures)',
  features: '{"type":"features","eyebrow":"","title":"","text":"1 sentence","items":[{"icon":"bolt","title":"","text":"1-2 sentences"}]} (3, 4 or 6 items)',
  split: '{"type":"split","eyebrow":"","title":"","text":"2 sentences","bullets":["3-4 short benefits"],"cta":{"label":"","target":"contact"},"stat":{"value":"98%","label":"happy clients"}}',
  stats: '{"type":"stats","title":"","items":[{"value":"250+","label":"short label"}]} (3 or 4 items)',
  work: '{"type":"work","eyebrow":"","title":"","text":"1 sentence","items":[{"title":"","tag":"category","text":"1 sentence"}]} (3 or 6 items: projects, services, dishes or products)',
  steps: '{"type":"steps","eyebrow":"","title":"","text":"","items":[{"title":"","text":"1 sentence"}]} (3 or 4 steps)',
  testimonials: '{"type":"testimonials","eyebrow":"","title":"","items":[{"quote":"1-2 sentences","name":"first name","role":"role or city"}]} (2 or 3 items)',
  pricing: '{"type":"pricing","eyebrow":"","title":"","text":"","plans":[{"name":"","price":"$29","period":"/month","features":["3-5 items"],"cta":"button label","featured":false}]} (2 or 3 plans, exactly one featured; prices are sample placeholders)',
  faq: '{"type":"faq","eyebrow":"","title":"","items":[{"q":"","a":"1-2 sentences"}]} (4-6 items)',
  cta: '{"type":"cta","title":"","text":"1 sentence","button":{"label":"","target":"contact"}}',
  contact: '{"type":"contact","eyebrow":"","title":"","text":"1-2 sentences","details":[{"icon":"clock","label":"short label","value":"generic info such as Replies within 24 hours"}],"button":"send button label"} (do not invent phone numbers, emails or addresses)',
};
const ICONS = {
  star: '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  shield: '<path d="M12 2.5l8 3v6c0 5-3.4 9-8 10.5-4.6-1.5-8-5.5-8-10.5v-6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.3C1.4 7.7 3.6 4.8 6.6 4.8c2 0 3.5 1 5.4 3 1.9-2 3.4-3 5.4-3 3 0 5.2 2.9 3.9 6.4-1.8 4.7-9.3 9.3-9.3 9.3z"/>',
  chart: '<path d="M4 20V11M10 20V4M16 20v-6M2 20h20"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.6.2 4.2 1.9 4.6 4.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7l1.5-3h4l1.5 3"/>',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19c3-5 6-8 10-10"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  gift: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M12 9v11M3 13h18M12 9c-3 0-4.5-1.5-4.5-3S9 3.5 10.5 4.5 12 9 12 9zm0 0c3 0 4.5-1.5 4.5-3S15 3.5 13.5 4.5 12 9 12 9z"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.star}</svg>`;

// ---------- plan: validate whatever the AI proposed ----------
const slugify = (s, d) => clip(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), 30) || d;
function normalizePlan(raw, hint) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const preset = PRESETS[raw.preset] ? raw.preset : (shortlist(hint || '')[0]);
  const pages = [];
  const used = new Set();
  for (const [i, p] of (Array.isArray(raw.pages) ? raw.pages : []).slice(0, 4).entries()) {
    if (!p) continue;
    let slug = i === 0 ? '/' : slugify(p.slug || p.name, 'page' + i);
    while (used.has(slug)) slug += '-2';
    used.add(slug);
    const sections = (Array.isArray(p.sections) ? p.sections : []).filter((x) => x && TYPES.includes(x.type)).slice(0, 9).map((x) => ({ type: x.type, label: clip(x.label, 14) }));
    pages.push({ name: clip(p.name, 24) || (i ? 'Page ' + (i + 1) : 'Home'), slug, sections });
  }
  if (!pages.length) pages.push({ name: 'Home', slug: '/', sections: [] });
  const home = pages[0];
  if (!home.sections.length || home.sections[0].type !== 'hero') home.sections = [{ type: 'hero', label: 'Home' }, ...home.sections.filter((x) => x.type !== 'hero')];
  if (home.sections.length < 4 && pages.length === 1) home.sections = [home.sections[0], { type: 'features', label: 'Features' }, { type: 'split', label: 'About' }, { type: 'stats', label: 'Results' }, { type: 'testimonials', label: 'Reviews' }, { type: 'faq', label: 'FAQ' }];
  pages.forEach((p, i) => { if (i > 0 && !p.sections.length) p.sections = [{ type: 'features', label: p.name }, { type: 'split', label: 'Details' }]; });
  const hasContact = pages.some((p) => p.sections.some((x) => x.type === 'contact'));
  if (!hasContact) { const last = pages[pages.length - 1]; last.sections = last.sections.filter((x, k) => !(x.type === 'cta' && k === last.sections.length - 1)); last.sections.push({ type: 'contact', label: 'Contact' }); }
  pages.forEach((p) => { p.sections = p.sections.filter((x, k) => !(x.type === 'hero' && (k > 0 || p !== home))); const seen = new Set(); p.sections.forEach((x) => { x.label = x.label || x.type[0].toUpperCase() + x.type.slice(1); }); void seen; });
  const nav = raw.navCta && typeof raw.navCta === 'object' ? clip(raw.navCta.label, 20) : '';
  return {
    name: clip(raw.name, 60) || 'My website', tagline: clip(raw.tagline, 80), description: clip(raw.description, 200), preset,
    brandColor: hexOr(raw.brandColor, ''), contactEmail: /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(String(raw.contactEmail || '')) ? String(raw.contactEmail).slice(0, 80) : '',
    tone: clip(raw.tone, 40), navCta: nav || 'Get in touch', pages,
  };
}

// ---------- theme + css ----------
function themeCss(plan) {
  const P = PRESETS[plan.preset] || PRESETS.aurora, primary = hexOr(plan.brandColor, P.primary), accent = P.accent;
  const dark = lum(P.bg) < 0.25, t = P.text;
  const S = {
    light: { sm: '0 1px 2px rgba(15,23,42,.05),0 8px 24px rgba(15,23,42,.07)', lg: '0 2px 4px rgba(15,23,42,.06),0 24px 60px rgba(15,23,42,.14)', b: `0 6px 18px ${rgba(primary, 0.32)}`, bh: `0 10px 28px ${rgba(primary, 0.42)}` },
    dark: { sm: '0 1px 0 rgba(255,255,255,.04) inset,0 10px 30px rgba(0,0,0,.35)', lg: '0 1px 0 rgba(255,255,255,.05) inset,0 30px 80px rgba(0,0,0,.5)', b: `0 8px 26px ${rgba(primary, 0.35)}`, bh: `0 12px 34px ${rgba(primary, 0.5)}` },
    brutal: { sm: '5px 5px 0 #111', lg: '8px 8px 0 #111', b: '4px 4px 0 #111', bh: '6px 6px 0 #111' },
    glow: { sm: `0 0 0 1px ${rgba(primary, 0.22)},0 10px 30px rgba(0,0,0,.5)`, lg: `0 0 0 1px ${rgba(primary, 0.35)},0 0 60px ${rgba(primary, 0.18)}`, b: `0 0 24px ${rgba(primary, 0.45)}`, bh: `0 0 36px ${rgba(primary, 0.65)}` },
  }[P.shadow];
  const v = {
    '--bg': P.bg, '--bg2': P.bg2, '--surface': P.surface, '--text': P.text, '--muted': P.muted, '--primary': primary, '--primary-ink': ink(primary), '--primary-text': readable(primary, P.bg, t), '--accent': accent,
    '--line': P.shadow === 'brutal' ? '#111' : rgba(t, dark ? 0.12 : 0.1), '--line-strong': P.shadow === 'brutal' ? '#111' : rgba(t, dark ? 0.24 : 0.2), '--glass': rgba(P.bg, 0.82),
    '--radius': P.radius + 'px', '--radius-btn': P.btn + 'px', '--bw': P.bw + 'px', '--font-head': P.head, '--font-body': P.body, '--head-weight': P.weight, '--head-track': P.track,
    '--shadow': S.sm, '--shadow-lg': S.lg, '--btn-shadow': S.b, '--btn-shadow-hover': S.bh,
    '--hero-bg': `radial-gradient(900px 520px at 88% -8%,${rgba(primary, dark ? 0.28 : 0.16)},transparent 62%),radial-gradient(700px 420px at -5% 105%,${rgba(accent, dark ? 0.2 : 0.14)},transparent 60%)`,
    '--cta-glow': `radial-gradient(520px 260px at 95% 0%,${rgba(accent, 0.55)},transparent 70%)`,
  };
  return '/* SitePilot theme: ' + plan.preset + ' */\n:root{' + Object.entries(v).map(([k, x]) => k + ':' + x).join(';') + '}\n';
}
const KIT = `
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-body);line-height:1.65;font-size:clamp(16px,1.2vw + 13px,18px);-webkit-font-smoothing:antialiased;overflow-x:hidden}
img,svg{max-width:100%;display:block}
h1,h2,h3,h4{font-family:var(--font-head);font-weight:var(--head-weight);letter-spacing:var(--head-track);line-height:1.12;margin:0 0 .5em;color:var(--text)}
h1{font-size:clamp(2.2rem,7.4vw,4.3rem)}h2{font-size:clamp(1.75rem,5vw,2.85rem)}h3{font-size:1.2rem;line-height:1.3;letter-spacing:0}
p{margin:0 0 1em;color:var(--muted)}a{color:inherit}
.container{width:min(1160px,calc(100% - 2.5rem));margin-inline:auto}
.section{padding:clamp(3.5rem,9vw,7rem) 0;position:relative}.section-alt{background:var(--bg2)}
.eyebrow{display:inline-flex;align-items:center;gap:.6rem;font-size:.76rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--primary-text);margin-bottom:1rem}
.eyebrow::before{content:"";width:1.6rem;height:2px;background:var(--accent);border-radius:2px}
.lead{font-size:clamp(1.05rem,2vw,1.28rem);max-width:60ch}
.section-head{max-width:720px;margin-bottom:clamp(2rem,5vw,3.4rem)}.section-head.center{margin-inline:auto;text-align:center}.section-head.center .eyebrow{justify-content:center}
.site-header{position:sticky;top:0;z-index:50;background:var(--bg);background:var(--glass);-webkit-backdrop-filter:saturate(1.4) blur(14px);backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid var(--line)}
.header-in{display:flex;align-items:center;gap:1rem;min-height:68px}
.brand{display:flex;align-items:center;gap:.65rem;font-family:var(--font-head);font-weight:800;font-size:1.12rem;letter-spacing:var(--head-track);text-decoration:none;color:var(--text)}
.brand-mark{width:34px;height:34px;border-radius:calc(var(--radius)*.7);background:linear-gradient(135deg,var(--primary),var(--accent));display:grid;place-items:center;color:var(--primary-ink);font-weight:800;font-size:1rem;flex:none}
.header-end{display:flex;align-items:center;gap:.6rem;margin-left:auto}
.nav{display:none;position:absolute;left:0;right:0;top:100%;background:var(--bg);border-bottom:1px solid var(--line);padding:.75rem 1.25rem 1.25rem;flex-direction:column;gap:.25rem;box-shadow:var(--shadow)}
.nav.open{display:flex}
.nav a{display:block;padding:.85rem 1rem;border-radius:calc(var(--radius)*.6);text-decoration:none;color:var(--muted);font-weight:600}
.nav a:hover,.nav a[aria-current="page"]{color:var(--text);background:var(--bg2)}
.nav-toggle{display:inline-grid;place-items:center;width:44px;height:44px;padding:0;border-radius:calc(var(--radius)*.7);border:var(--bw) solid var(--line-strong);background:var(--surface);cursor:pointer}
.nav-toggle span,.nav-toggle span::before,.nav-toggle span::after{display:block;width:18px;height:2px;background:var(--text);border-radius:2px}
.nav-toggle span{position:relative}.nav-toggle span::before,.nav-toggle span::after{content:"";position:absolute;left:0}
.nav-toggle span::before{top:-6px}.nav-toggle span::after{top:6px}
.nav-cta{display:none;min-height:42px;padding:.5rem 1.1rem;font-size:.95rem}
@media(min-width:860px){.nav-toggle{display:none}.nav-cta{display:inline-flex}.nav{display:flex;position:static;flex-direction:row;background:none;border:0;padding:0;gap:.2rem;margin-left:auto;box-shadow:none}.nav a{padding:.5rem .9rem}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:48px;padding:.8rem 1.5rem;border-radius:var(--radius-btn);font-family:inherit;font-weight:700;font-size:1rem;text-decoration:none;border:var(--bw) solid transparent;cursor:pointer;transition:transform .2s,box-shadow .2s,background .2s}
.btn-primary{background:var(--primary);color:var(--primary-ink);box-shadow:var(--btn-shadow)}.btn-primary:hover{transform:translateY(-2px);box-shadow:var(--btn-shadow-hover)}
.btn-ghost{background:transparent;color:var(--text);border-color:var(--line-strong)}.btn-ghost:hover{background:var(--bg2);transform:translateY(-2px)}
a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.hero{padding:clamp(3rem,9vw,6.5rem) 0 clamp(3rem,8vw,6rem);position:relative;overflow:hidden;background:var(--hero-bg),var(--bg)}
.hero-grid{display:grid;gap:clamp(2rem,6vw,4rem);align-items:center}
.hero h1{margin-bottom:.45em}.hero .lead{margin-bottom:1.8rem}
.hero-actions{display:flex;flex-wrap:wrap;gap:.75rem}
.hero-proof{display:flex;flex-wrap:wrap;gap:1.2rem 2.2rem;margin-top:2.2rem;padding-top:1.5rem;border-top:1px solid var(--line)}
.hero-proof b{display:block;font-family:var(--font-head);font-size:1.55rem;color:var(--text);line-height:1.1}.hero-proof small{color:var(--muted)}
.hero-media{min-width:0}
.hero-visual{position:relative;min-height:340px}
.hv-frame{position:absolute;inset:6% 4%;border-radius:calc(var(--radius)*1.6);background:linear-gradient(145deg,var(--surface),var(--bg2));border:var(--bw) solid var(--line);box-shadow:var(--shadow-lg);overflow:hidden}
.hv-frame::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 22% 18%,var(--primary),transparent 46%),radial-gradient(circle at 85% 85%,var(--accent),transparent 42%);opacity:.3}
.hv-frame::after{content:"";position:absolute;inset:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:34px 34px;opacity:.6;-webkit-mask-image:radial-gradient(circle at center,#000 20%,transparent 75%);mask-image:radial-gradient(circle at center,#000 20%,transparent 75%)}
.hv-card{position:absolute;z-index:2;padding:.85rem 1.1rem;border-radius:var(--radius);background:var(--surface);border:var(--bw) solid var(--line);box-shadow:var(--shadow);min-width:140px;max-width:62%}
.hv-card b{display:block;font-family:var(--font-head);font-size:1.4rem;color:var(--text);line-height:1.2}.hv-card small{color:var(--muted);font-size:.8rem}
.hv-1{top:2%;left:0}.hv-2{right:0;top:40%}.hv-3{left:7%;bottom:2%}
.hero-img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:calc(var(--radius)*1.6);border:var(--bw) solid var(--line);box-shadow:var(--shadow-lg)}
@media(min-width:900px){.hero--split .hero-grid{grid-template-columns:1.08fr .92fr}}
.hero--center{text-align:center}.hero--center .lead{margin-inline:auto}.hero--center .hero-actions,.hero--center .hero-proof{justify-content:center}
.hero--center h1{max-width:18ch;margin-inline:auto}.hero--left h1{font-size:clamp(2.5rem,9vw,5.4rem);max-width:16ch}
.hero--center .hero-visual,.hero--left .hero-visual{display:none}
.hero--center .hero-img,.hero--left .hero-img{aspect-ratio:16/9;margin-top:1rem}
.grid{display:grid;gap:clamp(1rem,2.5vw,1.5rem)}
@media(min-width:640px){.grid-2,.grid-3,.grid-4{grid-template-columns:repeat(2,1fr)}}
@media(min-width:960px){.grid-3{grid-template-columns:repeat(3,1fr)}.grid-4{grid-template-columns:repeat(4,1fr)}.bento>:first-child{grid-column:span 2}}
.card{background:var(--surface);border:var(--bw) solid var(--line);border-radius:var(--radius);padding:clamp(1.25rem,3vw,1.9rem);box-shadow:var(--shadow);transition:transform .25s,box-shadow .25s,border-color .25s}
.card:hover{transform:translateY(-4px);box-shadow:var(--shadow-lg);border-color:var(--primary)}
.card h3{margin-bottom:.45rem}.card p{margin:0}
.icon{width:50px;height:50px;border-radius:calc(var(--radius)*.8);display:grid;place-items:center;background:linear-gradient(135deg,var(--primary),var(--accent));color:var(--primary-ink);margin-bottom:1.1rem}
.split{display:grid;gap:clamp(2rem,5vw,4rem);align-items:center}
@media(min-width:900px){.split{grid-template-columns:1fr 1fr}.split--rev .split-media{order:-1}}
.split-media{position:relative;border-radius:calc(var(--radius)*1.5);overflow:hidden;min-height:320px;background:linear-gradient(145deg,var(--surface),var(--bg2));border:var(--bw) solid var(--line);box-shadow:var(--shadow)}
.split-media img{width:100%;height:100%;min-height:320px;object-fit:cover}
.art{position:absolute;inset:0;background:radial-gradient(circle at 25% 25%,var(--primary),transparent 52%),radial-gradient(circle at 82% 78%,var(--accent),transparent 46%);opacity:.38}
.art::after{content:"";position:absolute;inset:14%;border-radius:calc(var(--radius)*1.2);border:1px solid var(--line-strong);background:var(--glass)}
.float-card{position:absolute;left:1rem;bottom:1rem;z-index:2;padding:.8rem 1.1rem;border-radius:var(--radius);background:var(--surface);border:var(--bw) solid var(--line);box-shadow:var(--shadow-lg)}
.float-card b{display:block;font-family:var(--font-head);font-size:1.6rem;color:var(--text);line-height:1.1}.float-card small{color:var(--muted)}
.checklist{list-style:none;margin:1.25rem 0 1.5rem;padding:0;display:grid;gap:.75rem}
.checklist li{position:relative;padding-left:2.2rem;color:var(--text)}
.checklist li::before{content:"";position:absolute;left:0;top:.18em;width:1.45rem;height:1.45rem;border-radius:50%;background:var(--primary)}
.checklist li::after{content:"";position:absolute;left:.52rem;top:.46em;width:.4rem;height:.72rem;border:solid var(--primary-ink);border-width:0 2px 2px 0;transform:rotate(45deg)}
.stats{display:grid;gap:1.5rem;grid-template-columns:repeat(2,1fr)}@media(min-width:800px){.stats{grid-template-columns:repeat(4,1fr)}}
.stat{padding-top:1.1rem;border-top:3px solid var(--primary)}.stat b{display:block;font-family:var(--font-head);font-size:clamp(2.1rem,6vw,3.3rem);line-height:1;color:var(--text);margin-bottom:.4rem}.stat span{color:var(--muted)}
.thumb{aspect-ratio:4/3;border-radius:calc(var(--radius)*.9);margin-bottom:1.1rem;position:relative;overflow:hidden;background:linear-gradient(135deg,var(--primary),var(--accent));width:100%;object-fit:cover}
.t2{background:linear-gradient(200deg,var(--accent),var(--primary))}.t3{background:linear-gradient(315deg,var(--primary),var(--bg2))}.t4{background:radial-gradient(circle at 30% 30%,var(--accent),var(--primary))}.t5{background:linear-gradient(160deg,var(--bg2),var(--primary))}.t6{background:radial-gradient(circle at 70% 30%,var(--primary),var(--accent))}
div.thumb::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.1) 0 2px,transparent 2px 14px)}
.tag{display:inline-block;font-size:.7rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase;padding:.28rem .65rem;border-radius:999px;background:var(--bg2);color:var(--primary-text);margin-bottom:.7rem;border:1px solid var(--line)}
.steps{display:grid;gap:1.25rem;counter-reset:s}@media(min-width:640px){.steps{grid-template-columns:repeat(2,1fr)}}@media(min-width:960px){.steps.s4{grid-template-columns:repeat(4,1fr)}.steps.s3{grid-template-columns:repeat(3,1fr)}}
.step{padding:1.6rem;border-radius:var(--radius);background:var(--surface);border:var(--bw) solid var(--line);counter-increment:s}
.step::before{content:counter(s,decimal-leading-zero);display:block;font-family:var(--font-head);font-size:2.3rem;font-weight:800;color:var(--primary-text);margin-bottom:.6rem;line-height:1}.step p{margin:0}
.quote{display:flex;flex-direction:column;gap:1rem}.quote blockquote{margin:0;font-size:1.06rem;color:var(--text)}
.quote blockquote::before{content:"\\201C";display:block;font-family:Georgia,serif;font-size:3.2rem;line-height:.7;color:var(--primary-text)}
.person{display:flex;align-items:center;gap:.8rem;margin-top:auto}.avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--accent));color:var(--primary-ink);display:grid;place-items:center;font-weight:800;flex:none}.person b{display:block;color:var(--text)}.person small{color:var(--muted)}
.price-card{display:flex;flex-direction:column;gap:1rem;position:relative}.price-card.featured{border-color:var(--primary);box-shadow:var(--shadow-lg)}
.price-card.featured::before{content:"Most popular";position:absolute;top:-.85rem;left:1.5rem;font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:.3rem .75rem;border-radius:999px;background:var(--primary);color:var(--primary-ink)}
.price{font-family:var(--font-head);font-size:2.7rem;font-weight:800;color:var(--text);line-height:1}.price small{font-size:1rem;font-weight:500;color:var(--muted)}.price-card .checklist{margin:.2rem 0 1rem;flex:1}
.faq{display:grid;gap:.8rem;max-width:820px;margin-inline:auto}
details{background:var(--surface);border:var(--bw) solid var(--line);border-radius:var(--radius)}
summary{cursor:pointer;list-style:none;padding:1.15rem 1.4rem;font-weight:700;color:var(--text);display:flex;justify-content:space-between;gap:1rem;align-items:center}
summary::-webkit-details-marker{display:none}summary::after{content:"+";font-size:1.5rem;line-height:1;color:var(--primary-text);transition:transform .2s;flex:none}
details[open] summary::after{transform:rotate(45deg)}details p{padding:0 1.4rem 1.2rem;margin:0}
.cta{border-radius:calc(var(--radius)*1.8);padding:clamp(2.2rem,6vw,4.2rem) clamp(1.4rem,4vw,3rem);background:var(--cta-glow),var(--primary);text-align:center;box-shadow:var(--shadow-lg);position:relative;overflow:hidden}
.cta h2,.cta p{color:var(--primary-ink)}.cta p{opacity:.9;max-width:54ch;margin:0 auto 1.6rem}.cta .btn-primary{background:var(--primary-ink);color:var(--primary);box-shadow:none}
.contact-grid{display:grid;gap:clamp(2rem,5vw,3.5rem)}@media(min-width:900px){.contact-grid{grid-template-columns:.9fr 1.1fr;align-items:start}}
.info-list{list-style:none;margin:1.5rem 0 0;padding:0;display:grid;gap:1.1rem}.info-list li{display:flex;gap:.9rem;align-items:flex-start;color:var(--text)}.info-list svg{flex:none;width:24px;height:24px;color:var(--primary-text);margin-top:.15rem}.info-list small{display:block;color:var(--muted)}
.form{display:grid;gap:1rem}.field label{display:block;font-weight:600;margin-bottom:.4rem;color:var(--text);font-size:.95rem}
.field input,.field textarea{width:100%;padding:.9rem 1rem;border-radius:calc(var(--radius)*.7);border:var(--bw) solid var(--line-strong);background:var(--bg);color:var(--text);font:inherit}
.field textarea{min-height:140px;resize:vertical}.form-note{display:none;padding:.9rem 1rem;border-radius:var(--radius);background:var(--bg2);border:1px solid var(--line);color:var(--text)}
.site-footer{padding:3.5rem 0 2rem;border-top:1px solid var(--line);background:var(--bg2)}
.footer-grid{display:grid;gap:2rem}@media(min-width:800px){.footer-grid{grid-template-columns:1.5fr 1fr 1fr}}
.footer-links{list-style:none;padding:0;margin:0;display:grid;gap:.6rem}.footer-links a{color:var(--muted);text-decoration:none}.footer-links a:hover{color:var(--text)}
.site-footer h4{font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:1rem}
.copyright{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--line);font-size:.9rem;color:var(--muted)}
.js .reveal{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease}.js .reveal.visible{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.js .reveal{opacity:1;transform:none;transition:none}*{scroll-behavior:auto!important;transition:none!important}}
`;
const kitCss = (plan) => themeCss(plan) + KIT;
const pageJs = `(function(){document.documentElement.classList.add('js');var t=document.querySelector('.nav-toggle'),n=document.querySelector('.nav');if(t&&n){t.addEventListener('click',function(){var o=n.classList.toggle('open');t.setAttribute('aria-expanded',o?'true':'false')});n.addEventListener('click',function(e){if(e.target.tagName==='A'){n.classList.remove('open');t.setAttribute('aria-expanded','false')}})}var r=document.querySelectorAll('.reveal');if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target)}})},{threshold:.12});r.forEach(function(x){io.observe(x)})}else{r.forEach(function(x){x.classList.add('visible')})}var f=document.querySelector('form.form');if(f){f.addEventListener('submit',function(e){e.preventDefault();var m=f.getAttribute('data-mail');if(m){var v=function(k){var el=f.elements[k];return el?el.value:''};window.location.href='mailto:'+m+'?subject='+encodeURIComponent('Website enquiry from '+v('name'))+'&body='+encodeURIComponent(v('message')+'\\n\\n'+v('name')+' ('+v('email')+')')}else{var n2=f.querySelector('.form-note');if(n2){n2.style.display='block'}}})}})();`;

// ---------- content cleaning ----------
const arr = (v, n) => (Array.isArray(v) ? v.filter((x) => x != null).slice(0, n) : []);
const iconName = (n) => (ICONS[n] ? n : 'star');
function cleanSection(type, c, plan) {
  c = c && typeof c === 'object' ? c : {};
  const base = { type, eyebrow: clip(c.eyebrow, 40), title: clip(c.title, 110), text: clip(c.text, 320) };
  const cta = (o) => (o && typeof o === 'object' && clip(o.label, 28) ? { label: clip(o.label, 28), target: clip(o.target, 40) } : null);
  if (type === 'hero') return { ...base, cta1: cta(c.cta1) || { label: plan.navCta, target: 'contact' }, cta2: cta(c.cta2), proof: arr(c.proof, 3).map((p) => ({ value: clip(p && p.value, 14), label: clip(p && p.label, 30) })).filter((p) => p.value && p.label) };
  if (type === 'features') { let it = arr(c.items, 6).map((i) => ({ icon: iconName(i && i.icon), title: clip(i && i.title, 60), text: clip(i && i.text, 200) })).filter((i) => i.title); if (it.length === 5) it = it.slice(0, 4); return { ...base, items: it }; }
  if (type === 'split') return { ...base, bullets: arr(c.bullets, 5).map((b) => clip(b, 100)).filter(Boolean), cta: cta(c.cta), stat: c.stat && clip(c.stat.value, 12) && clip(c.stat.label, 30) ? { value: clip(c.stat.value, 12), label: clip(c.stat.label, 30) } : null };
  if (type === 'stats') return { ...base, items: arr(c.items, 4).map((i) => ({ value: clip(i && i.value, 14), label: clip(i && i.label, 34) })).filter((i) => i.value && i.label) };
  if (type === 'work') { let it = arr(c.items, 6).map((i) => ({ title: clip(i && i.title, 60), tag: clip(i && i.tag, 24), text: clip(i && i.text, 160) })).filter((i) => i.title); if (it.length === 4 || it.length === 5) it = it.slice(0, 3); return { ...base, items: it }; }
  if (type === 'steps') return { ...base, items: arr(c.items, 4).map((i) => ({ title: clip(i && i.title, 50), text: clip(i && i.text, 170) })).filter((i) => i.title) };
  if (type === 'testimonials') return { ...base, items: arr(c.items, 3).map((i) => ({ quote: clip(i && i.quote, 220), name: clip(i && i.name, 30), role: clip(i && i.role, 40) })).filter((i) => i.quote && i.name) };
  if (type === 'pricing') { const pl = arr(c.plans, 3).map((p) => ({ name: clip(p && p.name, 24), price: clip(p && p.price, 14), period: clip(p && p.period, 14), features: arr(p && p.features, 6).map((f) => clip(f, 70)).filter(Boolean), cta: clip(p && p.cta, 24) || 'Get started', featured: !!(p && p.featured) })).filter((p) => p.name && p.price); if (pl.length && !pl.some((p) => p.featured)) pl[Math.min(1, pl.length - 1)].featured = true; return { ...base, plans: pl }; }
  if (type === 'faq') return { ...base, items: arr(c.items, 6).map((i) => ({ q: clip(i && i.q, 120), a: clip(i && i.a, 300) })).filter((i) => i.q && i.a) };
  if (type === 'cta') return { ...base, button: cta(c.button) || { label: plan.navCta, target: 'contact' } };
  if (type === 'contact') return { ...base, details: arr(c.details, 3).map((d) => ({ icon: iconName(d && d.icon), label: clip(d && d.label, 30), value: clip(d && d.value, 80) })).filter((d) => d.label && d.value), button: clip(c.button, 24) || 'Send message' };
  return base;
}
const MIN = { features: 3, stats: 3, work: 3, steps: 3, testimonials: 2, pricing: 2, faq: 3 };
function fallbackSection(type, plan, label) { // a sensible default when the AI skipped or garbled a section
  const n = plan.name, d = plan.description || plan.tagline || n;
  const f = {
    hero: { title: plan.tagline || n, text: d, eyebrow: '' },
    features: { title: 'Why ' + n, text: d, items: [{ icon: 'star', title: 'Quality first', text: 'Careful work and attention to detail on every project.' }, { icon: 'clock', title: 'Reliable', text: 'Clear timelines and honest communication from start to finish.' }, { icon: 'heart', title: 'Made for you', text: 'Everything is shaped around what you actually need.' }] },
    split: { title: label || 'About us', text: d, bullets: ['Friendly, professional service', 'Clear and fair process', 'Results you can see'] },
    stats: { items: [{ value: '100%', label: 'Commitment' }, { value: '24h', label: 'Reply time' }, { value: '5★', label: 'Care' }] },
    work: { title: label || 'Our work', text: d, items: [{ title: 'Featured one', tag: 'Highlight', text: 'A short description goes here.' }, { title: 'Featured two', tag: 'Highlight', text: 'A short description goes here.' }, { title: 'Featured three', tag: 'Highlight', text: 'A short description goes here.' }] },
    steps: { title: 'How it works', items: [{ title: 'Talk to us', text: 'Tell us what you need.' }, { title: 'We plan', text: 'We share a clear plan.' }, { title: 'We deliver', text: 'You get the result.' }] },
    testimonials: { title: 'Kind words', items: [{ quote: 'A great experience from start to finish.', name: 'Aarav', role: 'Client' }, { quote: 'Professional, quick and friendly.', name: 'Meera', role: 'Client' }] },
    pricing: { title: 'Simple pricing', plans: [{ name: 'Starter', price: 'Custom', period: '', features: ['Core features', 'Email support'], cta: 'Get started' }, { name: 'Pro', price: 'Custom', period: '', features: ['Everything in Starter', 'Priority support'], cta: 'Get started', featured: true }] },
    faq: { title: 'Questions, answered', items: [{ q: 'How do I get started?', a: 'Send us a message and we will reply quickly.' }, { q: 'How long does it take?', a: 'It depends on the project; we will give you a clear estimate.' }, { q: 'Can I make changes later?', a: 'Yes, we are happy to help along the way.' }] },
    cta: { title: 'Ready to get started?', text: 'Tell us about your idea and we will help you take the next step.' },
    contact: { title: 'Get in touch', text: 'Send a message and we will get back to you.', details: [{ icon: 'clock', label: 'Response time', value: 'We reply within one working day' }] },
  }[type] || {};
  return cleanSection(type, f, plan);
}
function cleanPageContent(plan, pageIndex, raw) {
  const outline = plan.pages[pageIndex].sections, got = arr(raw && raw.sections, 12), used = new Set();
  return outline.map((o, i) => {
    let k = got.findIndex((g, j) => !used.has(j) && g && g.type === o.type && j >= i - 1);
    if (k < 0) k = got.findIndex((g, j) => !used.has(j) && g && g.type === o.type);
    let c = k >= 0 ? (used.add(k), cleanSection(o.type, got[k], plan)) : null;
    const items = c && (c.items || c.plans);
    if (c && MIN[o.type] && (!items || items.length < MIN[o.type])) c = null;
    if (c && ['hero', 'split', 'cta', 'contact'].includes(o.type) && !c.title) c = null;
    return c || fallbackSection(o.type, plan, o.label);
  });
}

// ---------- rendering ----------
const fileOf = (slug) => (slug === '/' ? 'index.html' : slug + '.html');
function renderPage(plan, pageIndex, sections, assets) {
  const page = plan.pages[pageIndex], pages = plan.pages;
  assets = (assets || []).filter((a) => /^assets\/[a-z0-9._-]{1,70}$/.test(a));
  let ai = 0;
  const nextAsset = () => (assets.length ? assets[ai++ % assets.length] : null);
  const contactPage = pages.findIndex((p) => p.sections.some((x) => x.type === 'contact'));
  const contactHref = contactPage === pageIndex ? '#contact' : fileOf(pages[Math.max(contactPage, 0)].slug) + '#contact';
  const ids = sections.map((s, i) => (s.type === 'contact' ? 'contact' : slugify(page.sections[i].label, s.type) + '-' + i));
  const href = (t, own) => {
    t = String(t || '').toLowerCase().trim();
    if (!t || t === 'contact') return contactHref;
    const pg = pages.find((p) => p.slug === t || p.slug === t.replace(/^\//, '') || p.name.toLowerCase() === t);
    if (pg) return fileOf(pg.slug);
    const k = sections.findIndex((s) => s.type === t);
    return k >= 0 ? '#' + ids[k] : contactHref;
  };
  const btn = (c, cls) => (c ? `<a class="btn ${cls}" href="${esc(href(c.target))}">${esc(c.label)}</a>` : '');
  const head = (s, center) => (s.eyebrow || s.title || s.text) ? `<div class="section-head reveal${center ? ' center' : ''}">${s.eyebrow ? `<span class="eyebrow">${esc(s.eyebrow)}</span>` : ''}${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${s.text ? `<p class="lead">${esc(s.text)}</p>` : ''}</div>` : '';
  const P = PRESETS[plan.preset] || PRESETS.aurora;
  let alt = false, splitN = 0;
  const wrap = (id, inner, plain) => { const cls = plain ? 'section' : 'section' + (alt ? ' section-alt' : ''); if (!plain) alt = !alt; return `<section class="${cls}" id="${id}"><div class="container">${inner}</div></section>`; };
  const body = sections.map((s, i) => {
    const id = ids[i];
    if (s.type === 'hero') {
      const img = nextAsset();
      const media = img ? `<div class="hero-media"><img class="hero-img" src="${esc(img)}" alt="${esc(plan.name)}"></div>` : `<div class="hero-media"><div class="hero-visual" aria-hidden="true"><div class="hv-frame"></div>${s.proof.map((p, k) => `<div class="hv-card hv-${k + 1}"><b>${esc(p.value)}</b><small>${esc(p.label)}</small></div>`).join('')}</div></div>`;
      const proof = s.proof.length ? `<div class="hero-proof">${s.proof.map((p) => `<div><b>${esc(p.value)}</b><small>${esc(p.label)}</small></div>`).join('')}</div>` : '';
      return `<section class="hero hero--${P.hero}" id="${id}"><div class="container hero-grid"><div class="hero-copy">${s.eyebrow ? `<span class="eyebrow">${esc(s.eyebrow)}</span>` : ''}<h1>${esc(s.title)}</h1><p class="lead">${esc(s.text)}</p><div class="hero-actions">${btn(s.cta1, 'btn-primary')}${btn(s.cta2, 'btn-ghost')}</div>${proof}</div>${media}</div></section>`;
    }
    if (s.type === 'features') { const n = s.items.length, g = n === 4 ? 'grid-4' : 'grid-3'; return wrap(id, head(s, true) + `<div class="grid ${g}${P.bento && n === 6 ? ' bento' : ''}">${s.items.map((it) => `<article class="card reveal"><span class="icon">${icon(it.icon)}</span><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></article>`).join('')}</div>`); }
    if (s.type === 'split') {
      const img = nextAsset(), rev = splitN++ % 2 === 1;
      return wrap(id, `<div class="split${rev ? ' split--rev' : ''}"><div class="split-copy reveal">${s.eyebrow ? `<span class="eyebrow">${esc(s.eyebrow)}</span>` : ''}<h2>${esc(s.title)}</h2><p class="lead">${esc(s.text)}</p>${s.bullets.length ? `<ul class="checklist">${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}${btn(s.cta, 'btn-primary')}</div><div class="split-media reveal">${img ? `<img src="${esc(img)}" alt="${esc(s.title)}" loading="lazy">` : '<div class="art" aria-hidden="true"></div>'}${s.stat ? `<div class="float-card"><b>${esc(s.stat.value)}</b><small>${esc(s.stat.label)}</small></div>` : ''}</div></div>`);
    }
    if (s.type === 'stats') return wrap(id, (s.title ? head({ title: s.title }, true) : '') + `<div class="stats">${s.items.map((it) => `<div class="stat reveal"><b>${esc(it.value)}</b><span>${esc(it.label)}</span></div>`).join('')}</div>`);
    if (s.type === 'work') return wrap(id, head(s, true) + `<div class="grid grid-3">${s.items.map((it, k) => { const img = assets.length > 1 ? nextAsset() : null; return `<article class="card reveal">${img ? `<img class="thumb" src="${esc(img)}" alt="${esc(it.title)}" loading="lazy">` : `<div class="thumb t${(k % 6) + 1}" aria-hidden="true"></div>`}${it.tag ? `<span class="tag">${esc(it.tag)}</span>` : ''}<h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></article>`; }).join('')}</div>`);
    if (s.type === 'steps') return wrap(id, head(s, true) + `<div class="steps s${s.items.length === 3 ? 3 : 4}">${s.items.map((it) => `<div class="step reveal"><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>`).join('')}</div>`);
    if (s.type === 'testimonials') return wrap(id, head(s, true) + `<div class="grid ${s.items.length === 2 ? 'grid-2' : 'grid-3'}">${s.items.map((it) => `<article class="card quote reveal"><blockquote>${esc(it.quote)}</blockquote><div class="person"><span class="avatar" aria-hidden="true">${esc(it.name.charAt(0).toUpperCase())}</span><div><b>${esc(it.name)}</b><small>${esc(it.role)}</small></div></div></article>`).join('')}</div>`);
    if (s.type === 'pricing') return wrap(id, head(s, true) + `<div class="grid ${s.plans.length === 2 ? 'grid-2' : 'grid-3'}">${s.plans.map((p) => `<article class="card price-card reveal${p.featured ? ' featured' : ''}"><h3>${esc(p.name)}</h3><div class="price">${esc(p.price)}${p.period ? `<small> ${esc(p.period)}</small>` : ''}</div><ul class="checklist">${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn ${p.featured ? 'btn-primary' : 'btn-ghost'}" href="${esc(contactHref)}">${esc(p.cta)}</a></article>`).join('')}</div>`);
    if (s.type === 'faq') return wrap(id, head(s, true) + `<div class="faq">${s.items.map((it) => `<details class="reveal"><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join('')}</div>`);
    if (s.type === 'cta') return wrap(id, `<div class="cta reveal"><h2>${esc(s.title)}</h2>${s.text ? `<p>${esc(s.text)}</p>` : ''}${btn(s.button, 'btn-primary')}</div>`, true);
    if (s.type === 'contact') return wrap('contact', `<div class="contact-grid"><div class="reveal">${s.eyebrow ? `<span class="eyebrow">${esc(s.eyebrow)}</span>` : ''}<h2>${esc(s.title)}</h2><p class="lead">${esc(s.text)}</p>${s.details.length ? `<ul class="info-list">${s.details.map((d) => `<li>${icon(d.icon)}<div><b>${esc(d.label)}</b><small>${esc(d.value)}</small></div></li>`).join('')}</ul>` : ''}</div><form class="card form reveal"${plan.contactEmail ? ` data-mail="${esc(plan.contactEmail)}"` : ''}><div class="field"><label for="f-name">Your name</label><input id="f-name" name="name" type="text" autocomplete="name" required></div><div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="email" required></div><div class="field"><label for="f-msg">Message</label><textarea id="f-msg" name="message" required></textarea></div><button class="btn btn-primary" type="submit">${esc(s.button)}</button><p class="form-note" role="status">Thanks! Your message was not sent because this form is not connected to an email service yet.</p></form></div>`);
    return '';
  }).join('\n');
  // header + footer
  const multi = pages.length > 1;
  const navItems = multi ? pages.map((p) => ({ label: p.name, href: fileOf(p.slug), cur: p === page })) : sections.map((s, i) => ({ label: page.sections[i].label, href: '#' + ids[i] })).filter((x, i) => sections[i].type !== 'hero' && sections[i].type !== 'cta').slice(0, 5);
  const navLinks = navItems.map((n) => `<a href="${esc(n.href)}"${n.cur ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('');
  const header = `<header class="site-header"><div class="container header-in"><a class="brand" href="${multi ? 'index.html' : '#'}"><span class="brand-mark" aria-hidden="true">${esc(plan.name.charAt(0).toUpperCase())}</span><span>${esc(plan.name)}</span></a><nav class="nav" id="site-nav" aria-label="Main">${navLinks}</nav><div class="header-end"><a class="btn btn-primary nav-cta" href="${esc(contactHref)}">${esc(plan.navCta)}</a><button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu"><span></span></button></div></div></header>`;
  const footer = `<footer class="site-footer"><div class="container"><div class="footer-grid"><div><a class="brand" href="${multi ? 'index.html' : '#'}"><span class="brand-mark" aria-hidden="true">${esc(plan.name.charAt(0).toUpperCase())}</span><span>${esc(plan.name)}</span></a><p style="margin-top:1rem;max-width:36ch">${esc(plan.tagline || plan.description)}</p></div><div><h4>Explore</h4><ul class="footer-links">${navItems.map((n) => `<li><a href="${esc(n.href)}">${esc(n.label)}</a></li>`).join('')}</ul></div><div><h4>Contact</h4><ul class="footer-links"><li><a href="${esc(contactHref)}">${esc(plan.navCta)}</a></li></ul></div></div><div class="copyright">&copy; ${new Date().getFullYear()} ${esc(plan.name)}. All rights reserved.</div></div></footer>`;
  return header + '\n<main>\n' + body + '\n</main>\n' + footer;
}
const themeSummary = (plan) => { const P = PRESETS[plan.preset] || PRESETS.aurora; return { primaryColor: hexOr(plan.brandColor, P.primary), backgroundColor: P.bg, textColor: P.text, fontFamily: P.head }; };

module.exports = { PRESETS, TYPES, DOCS, shortlist, presetMenu, normalizePlan, kitCss, pageJs, cleanPageContent, renderPage, themeSummary };
