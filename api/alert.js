// CommonJS for Vercel Node functions
module.exports = async (req, res) => {
  // CORS (harmless for GET pixel; useful if you keep POST tests)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL; // <-- keep your existing env var
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // --- Collect request data ---
  const ua = req.headers['user-agent'] || '';
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  // --- Parse device ---
  let device = 'PC';
  if (/mobile|android|iphone|ipad|ipod/i.test(ua)) {
    if (/android/i.test(ua)) device = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) device = 'iPhone';
    else device = 'Mobile';
  }

  // --- Parse browser (simple) ---
  let browser = 'Unknown';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opr|opera/i.test(ua)) browser = 'Opera';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua)) browser = 'Safari';

  // --- Oregon time (Pacific) ---
  const now = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date());

  // --- Send to Discord (clean text, no raw UA, no path/ref) ---
  const content =
    `👀 **New Visit**\n` +
    `**Time:** ${now} (Oregon)\n` +
    `**Device:** ${device}\n` +
    `**Browser:** ${browser}\n` +
    `**IP:** ${ip}`;

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });

  // Browser-friendly responses
  if (req.method === 'GET') return res.status(200).send('ok');
  return res.status(204).end();
};
