// api/alert.js — Vercel Serverless Function (CommonJS, Node 18+)
module.exports = async (req, res) => {
  // CORS (harmless; useful when testing)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // ---- Parse basics ----
  const ua = req.headers['user-agent'] || '';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const ref = req.headers['referer'] || 'none';

  // Vercel Geo
  const city      = req.headers['x-vercel-ip-city'] || '';
  const region    = req.headers['x-vercel-ip-country-region'] || req.headers['x-vercel-ip-region'] || '';
  const country   = (req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const latitude  = req.headers['x-vercel-ip-latitude'] || '';
  const longitude = req.headers['x-vercel-ip-longitude'] || '';

  // Merge query + body
  const q = req.query || {};
  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
    catch { body = {}; }
  }

  const path = body.path || q.path || (req.url || '');
  const client = {
    // core identity-ish signals
    fpHash: body.fpHash || null,          // SHA-256 of combined signals
    ua: ua,
    uaCH: body.uaCH || null,              // UA-CH brands, model, platformVersion
    browser: body.browser || 'Unknown',
    os: body.os || 'Unknown',
    device: body.device || 'PC',
    // env
    language: body.language || (req.headers['accept-language']||'').split(',')[0] || 'unknown',
    languages: body.languages || null,
    timezone: body.timezone || null,
    dnt: body.dnt ?? null,
    cookiesEnabled: body.cookiesEnabled ?? null,
    storage: body.storage || null,        // {local,session,quotaMB,usageMB}
    screen: body.screen || null,          // {w,h,innerW,innerH,colorDepth,pixelRatio}
    color: body.color || null,            // {gamut, scheme, contrast, motion}
    hw: body.hw || null,                  // {cores, memoryGB}
    gpu: body.gpu || null,                // {vendor, renderer}
    net: body.net || null,                // {type, downlink, rtt, saveData, pingMs}
    battery: body.battery || null,        // {charging, level}
    media: body.media || null,            // {hasAudio, hasVideo}
    sensors: body.sensors || null,        // {touchPoints}
    perms: body.perms || null,            // {geolocation, notifications}
    fontsSample: body.fontsSample || null,// font metrics hash (coarse)
    // location (client geolocation if user allowed)
    geo: body.geo || null,                // {lat, lon, accuracy_m}
    // routing
    path,
    ref: body.ref || q.ref || ref
  };

  // Oregon (Pacific) time
  const nowOR = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date());

  // Country flag
  const flag = country ? String.fromCodePoint(...[...country].map(c => 0x1F1A5 + c.charCodeAt(0))) : '';

  // Pretty location
  const approxLoc = (city || region || country)
    ? `${city ? city + ', ' : ''}${region ? region + ', ' : ''}${country}${flag ? ' ' + flag : ''}`
    : 'Unknown';

  // Build Discord lines (keep under limits)
  const lines = [
    `🆕 **New Visit**`,
    `🕒 **Time (Oregon):** ${nowOR}`,
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

  // Pixel response for GET
  if (req.method === 'GET') return res.status(200).send('ok');
  return res.status(204).end();
};
