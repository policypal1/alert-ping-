// Vercel Serverless Function (CommonJS)
module.exports = async (req, res) => {
  // CORS (harmless for GET pixel; helpful if you POST during tests)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // -------- Parse request --------
  const q = req.query || {};
  const ua = req.headers['user-agent'] || '';
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  // From browser (pixel)
  const lang = q.lang || '';
  const tzFromClient = q.tz || '';

  // Vercel-provided geo (if available)
  const city    = req.headers['x-vercel-ip-city'] || '';
  const region  = req.headers['x-vercel-ip-country-region'] || '';
  const country = (req.headers['x-vercel-ip-country'] || '').toUpperCase();

  // Device
  let device = 'PC';
  if (/mobile|android|iphone|ipad|ipod/i.test(ua)) {
    if (/android/i.test(ua)) device = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) device = 'iPhone';
    else device = 'Mobile';
  }

  // Browser
  let browser = 'Unknown';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opr|opera/i.test(ua)) browser = 'Opera';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua)) browser = 'Safari';

  // Oregon time (Pacific)
  const nowOR = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date());

  // Country flag emoji from ISO code
  const flag = country
    ? String.fromCodePoint(...[...country].map(c => 0x1F1A5 + c.charCodeAt(0)))
    : '';

  const locPretty = city || region || country
    ? `${city ? city + ', ' : ''}${region ? region + ', ' : ''}${country}${flag ? ' ' + flag : ''}`
    : 'Unknown';

  // -------- Discord message (clean + emojis) --------
  const lines = [
    `🆕 **New Visit**`,
    `🕒 **Time (Oregon):** ${nowOR}`,
    `💻 **Device:** ${device}   •   🌐 **Browser:** ${browser}`,
    `📍 **Approx. Location:** ${locPretty}`,
    lang ? `🗣️ **Browser Lang:** ${lang}` : null,
    tzFromClient ? `⏱️ **Visitor TZ:** ${tzFromClient}` : null,
    `🔢 **IP:** ${ip}`
  ].filter(Boolean);

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: lines.join('\n') })
  });

  // Friendly responses
  if (req.method === 'GET') return res.status(200).send('ok');
  return res.status(204).end();
};
