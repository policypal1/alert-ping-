// api/alert.js — Vercel Serverless Function (CommonJS, Node 18+)
module.exports = async (req, res) => {
  // CORS (useful for local tests; harmless for pixel GET)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // -------- helpers --------
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

  const oregonNow = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date());

  // -------- basics --------
  const ua = req.headers['user-agent'] || '';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.socket?.remoteAddress || 'unknown';
  const refHeader = req.headers['referer'] || 'none';

  // Vercel geo headers
  const city      = req.headers['x-vercel-ip-city'] || '';
  const region    = req.headers['x-vercel-ip-country-region'] || req.headers['x-vercel-ip-region'] || '';
  const country   = (req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const latitude  = req.headers['x-vercel-ip-latitude'] || '';
  const longitude = req.headers['x-vercel-ip-longitude'] || '';

  const q = req.query || {};
  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
    catch { body = {}; }
  }

  // -------- merge client/server values --------
  const uaParsed = parseUA(ua);
  const client = {
    // identity-ish
    fpHash: body.fpHash || null,
    browser: body.browser || uaParsed.browser,
    os: body.os || uaParsed.os,
    device: body.device || uaParsed.device,

    // env
    language: body.language || (req.headers['accept-language'] || '').split(',')[0] || 'unknown',
    languages: body.languages || null,
    timezone: body.timezone || null,
    dnt: body.dnt ?? null,
    cookiesEnabled: body.cookiesEnabled ?? null,
    storage: body.storage || null,
    screen: body.screen || null,
    color: body.color || null,
    hw: body.hw || null,
    gpu: body.gpu || null,
    net: body.net || null,
    battery: body.battery || null,
    media: body.media || null,
    sensors: body.sensors || null,
    perms: body.perms || null,
    fontsSample: body.fontsSample || null,
    geo: body.geo || null,

    // routing
    path: (body.path || q.path || '').toString().slice(0, 512), // avoid pasting long text by accident
    ref: body.ref || q.ref || refHeader
  };

  // country flag
  const flag = country ? String.fromCodePoint(...[...country].map(c => 0x1F1A5 + c.charCodeAt(0))) : '';
  const approxLoc = (city || region || country)
    ? `${city ? city + ', ' : ''}${region ? region + ', ' : ''}${country}${flag ? ' ' + flag : ''}`
    : 'Unknown';

  // -------- Discord message --------
  const lines = [
    `🆕 **New Visit**`,
    `🕒 **Time (Oregon):** ${oregonNow}`,
    `💻 **Device:** ${client.device} (${client.os})   •   🌐 **Browser:** ${client.browser}`,
    `🧩 **FP Hash:** ${client.fpHash || '—'}`,
    `📍 **Approx. Location:** ${approxLoc}${latitude && longitude ? `  (${latitude}, ${longitude})` : ''}`,
    client.geo ? `📡 **Precise Geo (consented):** ${client.geo.lat.toFixed(5)}, ${client.geo.lon.toFixed(5)} ±${client.geo.accuracy_m}m` : null,
    `🗣️ **Lang:** ${client.language}${client.languages ? `  •  ${client.languages.join(', ')}` : ''}`,
    `⏱️ **TZ:** ${client.timezone || '—'}  •  DNT:${client.dnt === true ? 'on' : client.dnt === false ? 'off' : '—'}`,
    `🔢 **IP:** ${ip}`,
    client.path ? `🧭 **Path:** ${client.path}` : null,
    client.ref ? `🔗 **Referrer:** ${client.ref}` : null,
    client.screen ? `🖥️ **Screen:** ${client.screen.w}×${client.screen.h} (inner ${client.screen.innerW}×${client.screen.innerH}) @${client.screen.pixelRatio} • ${client.screen.colorDepth}-bit` : null,
    client.color ? `🎨 **Color:** gamut=${client.color.gamut || '—'}, scheme=${client.color.scheme || '—'}, contrast=${client.color.contrast || '—'}, motion=${client.color.motion || '—'}` : null,
    client.hw ? `🧠 **HW:** ${client.hw.cores ?? '?'} cores • ${client.hw.memoryGB ?? '?'}GB` : null,
    client.gpu ? `🖼️ **GPU:** ${client.gpu.vendor || '—'} / ${client.gpu.renderer || '—'}` : null,
    client.net ? `📶 **Net:** ${client.net.type || '—'} • ${client.net.downlink ?? '—'} Mb/s • RTT=${client.net.rtt ?? '—'} • Ping=${client.net.pingMs ?? '—'}ms • SaveData=${client.net.saveData ?? '—'}` : null,
    client.battery ? `🔋 **Battery:** ${Math.round((client.battery.level ?? 0)*100)}% • Charging=${client.battery.charging ?? '—'}` : null,
    client.storage ? `💾 **Storage:** local=${client.storage.local} • session=${client.storage.session} • quota≈${client.storage.quotaMB ?? '—'}MB • used≈${client.storage.usageMB ?? '—'}MB` : null,
    client.media ? `🎥 **Media Devices:** audio=${client.media.hasAudio} • video=${client.media.hasVideo}` : null,
    client.sensors ? `📱 **Sensors:** touchPoints=${client.sensors.touchPoints ?? '—'}` : null,
    client.perms ? `🔒 **Permissions:** geo=${client.perms.geolocation} • notif=${client.perms.notifications}` : null,
    client.fontsSample ? `🔤 **Fonts (coarse hash):** ${client.fontsSample}` : null
  ].filter(Boolean);

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: lines.join('\n') })
  });

  if (req.method === 'GET') return res.status(200).send('ok');
  return res.status(204).end();
};
