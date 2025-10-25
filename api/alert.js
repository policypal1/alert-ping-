// Vercel Serverless Function (CommonJS)
module.exports = async (req, res) => {
  // --- CORS (harmless for GET pixel; helpful for POST testing)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // --- Parse request ---
  const ua = req.headers['user-agent'] || '';
  const q = req.query || {};
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

  // --- Handle POST body if provided ---
  let body = {};
  if (req.method === 'POST') {
    try {
      body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    } catch {
      body = {};
    }
  }

  // --- Merge query and body data ---
  const lang = body.language || q.lang || req.headers['accept-language']?.split(',')[0] || 'unknown';
  const tzFromClient = body.timezone || q.tz || '';
  const screen = body.screen || null;
  const hw = body.hw || null;
  const connection = body.connection || null;
  const ref = body.ref || q.ref || req.headers['referer'] || 'none';
  const path = body.path || q.path || (req.url || '');

  // --- Vercel Geo Headers ---
  const city     = req.headers['x-vercel-ip-city'] || '';
  const region   = req.headers['x-vercel-ip-country-region'] || '';
  const country  = (req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const latitude = req.headers['x-vercel-ip-latitude'] || '';
  const longitude = req.headers['x-vercel-ip-longitude'] || '';

  // --- Device & Browser detection ---
  let device = 'PC';
  if (/mobile|android|iphone|ipad|ipod/i.test(ua)) {
    if (/android/i.test(ua)) device = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) device = 'iPhone';
    else device = 'Mobile';
  }

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

  // --- Oregon (Pacific) time ---
  const nowOR = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date());

  // --- Country flag emoji ---
  const flag = country
    ? String.fromCodePoint(...[...country].map(c => 0x1F1A5 + c.charCodeAt(0)))
    : '';

  // --- Location formatting ---
  const locPretty = city || region || country
    ? `${city ? city + ', ' : ''}${region ? region + ', ' : ''}${country}${flag ? ' ' + flag : ''}`
    : 'Unknown';

  // --- Discord message ---
  const lines = [
    `🆕 **New Visit**`,
    `🕒 **Time (Oregon):** ${nowOR}`,
    `💻 **Device:** ${device} (${os})   •   🌐 **Browser:** ${browser}`,
    `📍 **Approx. Location:** ${locPretty}${latitude && longitude ? `  (${latitude}, ${longitude})` : ''}`,
    `🗣️ **Browser Lang:** ${lang}`,
    `⏱️ **Visitor TZ:** ${tzFromClient || '—'}`,
    `🔢 **IP:** ${ip}`,
    path ? `🧭 **Path:** ${path}` : null,
    ref ? `🔗 **Referrer:** ${ref}` : null,
    screen ? `🖥️ **Screen:** ${screen.width}×${screen.height} @ ${screen.colorDepth}-bit` : null,
    hw ? `🧠 **Hardware:** ${hw.cores ?? '?'} cores • ${hw.memoryGB ?? '?'}GB` : null,
    connection ? `📶 **Network:** ${connection.effectiveType ?? '?'} • ${connection.downlink ?? '?'} Mbps` : null
  ].filter(Boolean);

  // --- Send to Discord ---
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: lines.join('\n') })
  });

  // --- Response ---
  if (req.method === 'GET') return res.status(200).send('ok');
  return res.status(204).end();
};
