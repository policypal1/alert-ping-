// api/alert.js — Vercel Serverless Function (CommonJS, Node 18+)
// Sends a compact, high-signal Discord alert with simple in-memory de-dup.

module.exports = async (req, res) => {
  // --- CORS (safe for GET pixel; handy for POST tests)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // ---------- small in-memory dedupe (works per warm instance) ----------
  // Keyed by IP + device + browser + path — throttles repeated identical alerts
  const DEDUPE_WINDOW_MS = 5000; // 5 seconds
  if (!global.__alert_dedupe) global.__alert_dedupe = new Map();
  const dedupeMap = global.__alert_dedupe;

  // ---------- helpers ----------
  const parseUA = (ua = '') => {
    let browser = 'Unknown';
    if (/edg/i.test(ua)) browser = 'Edge';
    else if (/opr|opera/i.test(ua)) browser = 'Opera';
    else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
    else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
    else if (/safari/i.test(ua)) browser = 'Safari';

    let os = 'Unknown';
    if (/windows nt/i.test(ua)) os = 'Windows';
    else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
    else if (/android/i.test(ua)) os = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
    else if (/linux/i.test(ua)) os = 'Linux';

    const device = /mobile|android|iphone|ipad|ipod/i.test(ua)
      ? (/android/i.test(ua) ? 'Android' : (/iphone|ipad|ipod/i.test(ua) ? 'iPhone' : 'Mobile'))
      : 'PC';

    return { browser, os, device };
  };

  const pick = (v, d = null) => (v === undefined ? d : v);

  // ---------- request basics ----------
  const ua = req.headers['user-agent'] || '';
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress || 'unknown';
  const refHeader = req.headers['referer'] || 'none';

  // Vercel geo headers (may be empty)
  const city      = req.headers['x-vercel-ip-city'] || '';
  const region    = req.headers['x-vercel-ip-country-region'] || req.headers['x-vercel-ip-region'] || '';
  const country   = (req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const latitude  = req.headers['x-vercel-ip-latitude'] || '';
  const longitude = req.headers['x-vercel-ip-longitude'] || '';

  // queries + body
  const q = req.query || {};
  let body = {};
  if (req.method === 'POST') {
    try {
      body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    } catch { body = {}; }
  }

  // ---------- merge client/server values ----------
  const uaParsed = parseUA(ua);

  const client = {
    fpHash: pick(body.fpHash, null),
    browser: pick(body.browser, uaParsed.browser),
    os: pick(body.os, uaParsed.os),
    device: pick(body.device, uaParsed.device),

    language: pick(body.language, (req.headers['accept-language']||'').split(',')[0] || 'unknown'),
    timezone: pick(body.timezone, q.tz || null),

    // rich extras (may be null if your page only sent the pixel)
    gpu: pick(body.gpu, null),
    net: pick(body.net, null),
    hw: pick(body.hw, null),
    screen: pick(body.screen, null),
    battery: pick(body.battery, null),
    color: pick(body.color, null),

    // routing
    path: (pick(body.path, q.path || '') || '').toString().slice(0, 512),
    ref: pick(body.ref, q.ref || refHeader) || 'none'
  };

  // location formatting — fixed flag construction
  const flag = country
    ? (() => {
        // country is expected like 'US' — construct regional indicator symbols correctly
        try {
          const chars = [...country].map(c => 0x1F1E6 + (c.charCodeAt(0) - 65));
          return String.fromCodePoint(...chars);
        } catch {
          return '';
        }
      })()
    : '';
  const approxLoc = (city || region || country)
    ? `${city ? city + ', ' : ''}${region ? region + ', ' : ''}${country}${flag ? ' ' + flag : ''}`
    : 'Unknown';

  // ---------- dedupe decision ----------
  const dedupeKey = `${ip}|${client.device}|${client.browser}|${client.path}`;
  const now = Date.now();
  const last = dedupeMap.get(dedupeKey);
  if (last && (now - last) < DEDUPE_WINDOW_MS) {
    // Rapid duplicate — skip sending another alert from this warm instance.
    // Update last timestamp so the window slides a bit (prevents a storm).
    dedupeMap.set(dedupeKey, now);
    // Respond quickly. Pixel clients expect 200 on GET or 204 on POST; maintain behavior.
    if (req.method === 'GET') return res.status(200).send('ok');
    return res.status(204).end();
  }
  // record send time
  dedupeMap.set(dedupeKey, now);

  // Garbage-collect dedupeMap entries older than (window * 10) to avoid memory leak
  try {
    for (const [k, t] of dedupeMap) {
      if (now - t > DEDUPE_WINDOW_MS * 10) dedupeMap.delete(k);
    }
  } catch (e) { /* non-fatal */ }

  // ---------- COMPACT, SCANNABLE MESSAGE ----------
  const oregonNow = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date());

  const lines = [
    `🆕 **New Visit**`,
    `🕒 ${oregonNow}`,
    `💻 ${client.device} (${client.os}) • 🌐 ${client.browser}`,
    `📍 ${approxLoc}${latitude && longitude ? ` (${latitude}, ${longitude})` : ''}`,
    `🔢 IP: ${ip}`,
    `🧩 Hash: ${client.fpHash ? String(client.fpHash).slice(0, 12) : '—'}`,
    client.gpu ? `🎮 GPU: ${client.gpu.renderer || client.gpu.vendor || '—'}` : null,
    client.net ? `📶 Net: ${client.net.type || '—'} • ${client.net.downlink ?? '—'} Mb/s` : null,
    client.hw ? `⚙️ HW: ${client.hw.cores ?? '—'} cores • ${client.hw.memoryGB ?? '—'} GB` : null,
    client.screen ? `🖥️ ${client.screen.w}×${client.screen.h} (${client.screen.colorDepth}-bit)` : null,
    client.battery ? `🔋 ${Math.round((client.battery.level ?? 0)*100)}% • ${client.battery.charging ? '⚡ Charging' : '🔌 Idle'}` : null,
    `🎨 Mode: ${client.color?.scheme || '—'}`,
    `⏱️ TZ: ${client.timezone || '—'}`,
    `🗣️ Lang: ${client.language}`,
    `🧭 Path: ${client.path || '/'}`
  ].filter(Boolean);

  // send safely
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: lines.join('\n') })
    });
  } catch (err) {
    console.error('Alert webhook send error:', err && err.stack || err);
    // continue — don't break pixel behavior
  }

  // pixel OK
  if (req.method === 'GET') return res.status(200).send('ok');
  return res.status(204).end();
};
