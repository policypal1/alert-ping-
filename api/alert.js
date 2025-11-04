// api/alert.js
// Debounced aggregator: collects multiple near-identical hits and sends one clear Discord message.
// Per-warm-instance in-memory solution (fast, no external infra). For cross-instance dedupe use Redis.

module.exports = async (req, res) => {
  // --- CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // -------------------- config --------------------
  const AGGREGATE_WINDOW_MS = 3000; // collect hits for this key for 3s before sending aggregated alert
  const DEDUPE_HOLD_MS = 12_000;    // keep a recent entry around for this long to avoid re-alerting immediately
  const MAX_JSON_SNIPPET = 1500;    // trim raw JSON debug to this many chars to keep webhook friendly

  // -------------------- in-memory store --------------------
  if (!global.__alert_agg) global.__alert_agg = new Map(); // key -> {count, firstTs, lastPayload, timer}
  const store = global.__alert_agg;

  // -------------------- helpers --------------------
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

  const safeJson = (o) => {
    try { return JSON.stringify(o, null, 2); } catch { return String(o); }
  };

  const trimStr = (s, n) => (s && s.length > n ? s.slice(0, n - 150) + '\n\n...trimmed...' : s);

  // -------------------- build request info --------------------
  const ua = req.headers['user-agent'] || '';
  const uaParsed = parseUA(ua);

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const refHeader = req.headers['referer'] || 'none';
  const q = req.query || {};
  let body = {};
  if (req.method === 'POST') {
    try {
      body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    } catch { body = {}; }
  }

  // client-provided id (optional) — use if you set it in the page (helps dedupe across instances)
  const clickId = body.click_id || q.click_id || req.headers['x-click-id'] || null;

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
    ref: body.ref ?? q.ref ?? refHeader ?? 'none'
  };

  // Vercel geo headers (may be empty)
  const city      = req.headers['x-vercel-ip-city'] || '';
  const region    = req.headers['x-vercel-ip-country-region'] || req.headers['x-vercel-ip-region'] || '';
  const country   = (req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const latitude  = req.headers['x-vercel-ip-latitude'] || '';
  const longitude = req.headers['x-vercel-ip-longitude'] || '';

  // construct flag safely (US -> 🇺🇸)
  const flag = country
    ? (() => {
        try {
          const chars = [...country].map(c => 0x1F1E6 + (c.charCodeAt(0) - 65));
          return String.fromCodePoint(...chars);
        } catch { return ''; }
      })()
    : '';

  const approxLoc = (city || region || country)
    ? `${city ? city + ', ' : ''}${region ? region + ', ' : ''}${country}${flag ? ' ' + flag : ''}`
    : 'Unknown';

  // -------------------- dedupe key --------------------
  // Use IP + device + browser + path + optional fpHash + optional clickId
  const keyParts = [ip, client.device || '-', client.browser || '-', client.path || '/'];
  if (client.fpHash) keyParts.push(String(client.fpHash).slice(0,12));
  if (clickId) keyParts.push(String(clickId));
  const dedupeKey = keyParts.join('|');

  const now = Date.now();

  // -------------------- aggregator logic --------------------
  const existing = store.get(dedupeKey);
  if (existing) {
    // update existing aggregation entry
    existing.count += 1;
    existing.lastTs = now;
    existing.lastClient = client;
    existing.lastBody = body;
    existing.lastHeaders = req.headers;

    // renew timeout: clear previous timer and schedule new send after AGGREGATE_WINDOW_MS from now
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => sendAggregated(dedupeKey), AGGREGATE_WINDOW_MS);
    // respond immediately to client (pixel friendly)
    if (req.method === 'GET') return res.status(200).send('ok');
    return res.status(204).end();
  }

  // create new aggregation entry and schedule send
  const entry = {
    count: 1,
    firstTs: now,
    lastTs: now,
    lastClient: client,
    lastBody: body,
    lastHeaders: req.headers,
    timer: null
  };
  entry.timer = setTimeout(() => sendAggregated(dedupeKey), AGGREGATE_WINDOW_MS);
  store.set(dedupeKey, entry);

  // quick client response
  if (req.method === 'GET') return res.status(200).send('ok');
  res.status(204).end();

  // -------------------- send function --------------------
  async function sendAggregated(key) {
    const item = store.get(key);
    if (!item) return;

    // Build a plain-language summary
    const firstTime = new Date(item.firstTs).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const lastTime = new Date(item.lastTs).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const count = item.count;
    const c = item.lastClient;
    const h = item.lastHeaders;

    // Pretty human summary for quick scanning
    const summaryLines = [
      `🆕 **Visit summary**`,
      `• **Count (deduped)**: ${count}`,
      `• **First seen**: ${firstTime}`,
      `• **Last seen**: ${lastTime}`,
      `• **Device / OS / Browser**: ${c.device} / ${c.os} / ${c.browser}`,
      `• **Location (approx)**: ${approxLoc}${latitude && longitude ? ` (${latitude}, ${longitude})` : ''}`,
      `• **IP**: ${ip}`,
      `• **Path**: ${c.path || '/'}`,
      `• **Referrer**: ${c.ref || 'none'}`,
      `• **FP hash**: ${c.fpHash ? String(c.fpHash).slice(0,12) : '—'}`,
      `• **Click ID**: ${clickId || '—'}`,
      `• **Lang / TZ**: ${c.language} / ${c.timezone || '—'}`
    ];

    // Extra parsed details (optional lines only if present)
    if (c.gpu) summaryLines.push(`• GPU: ${c.gpu.renderer || c.gpu.vendor || safeJson(c.gpu)}`);
    if (c.net) summaryLines.push(`• Net: ${c.net.type || '-'} • ${c.net.downlink ?? '-'} Mb/s`);
    if (c.hw) summaryLines.push(`• HW: ${c.hw.cores ?? '-'} cores • ${c.hw.memoryGB ?? '-'} GB`);
    if (c.screen) summaryLines.push(`• Screen: ${c.screen.w}×${c.screen.h} (${c.screen.colorDepth}-bit)`);
    if (c.battery) summaryLines.push(`• Battery: ${Math.round((c.battery.level ?? 0)*100)}% • ${c.battery.charging ? '⚡ charging' : 'idle'}`);
    if (c.color) summaryLines.push(`• Color scheme: ${c.color.scheme || '-'}`);

    // Build debug JSON snippet (headers + body), trimmed
    const debug = {
      headers: h || {},
      body: item.lastBody || {},
      rawUa: ua,
      q: q || {}
    };
    let debugStr = safeJson(debug);
    debugStr = trimStr(debugStr, MAX_JSON_SNIPPET);

    // Compose Discord payload - human summary + code block debug
    const discordContent = summaryLines.join('\n') + '\n\n' + '```json\n' + debugStr + '\n```';

    // send safely
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: discordContent })
      });
    } catch (err) {
      console.error('alert webhook send error', err && err.stack || err);
    }

    // mark to avoid immediate re-alert: keep entry timestamp, but clear the timer
    clearTimeout(item.timer);
    // update firstTs to lastTs so re-alert won't happen until DEDUPE_HOLD_MS later
    item.firstTs = Date.now();
    // schedule removal after DEDUPE_HOLD_MS
    setTimeout(() => store.delete(key), DEDUPE_HOLD_MS);
  }
};
