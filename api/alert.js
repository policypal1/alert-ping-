// api/alert.js  (TRACKER PROJECT)
module.exports = async (req, res) => {
  // --- CORS (so your website can call this from another domain) ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // Read JSON body if present (sendBeacon/fetch)
  let body = {};
  if (req.method === 'POST') {
    const raw = await new Promise((resolve) => {
      let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d));
    });
    try { body = JSON.parse(raw || '{}'); } catch {}
  }

  // Basic metadata
  const ts = new Date().toISOString();
  const ua = req.headers['user-agent'] || 'unknown';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim()
           || req.socket?.remoteAddress || 'unknown';
  const path = body.path || req.query.path || 'unknown';
  const ref  = body.ref  || req.headers['referer'] || 'none';

  // Send to Discord
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content:
          `👀 **Page view**\n` +
          `• Time: ${ts}\n` +
          `• Path: ${path}\n` +
          `• Referrer: ${ref}\n` +
          `• IP: ${ip}\n` +
          `• UA: ${ua}`
      })
    });
  } catch (e) {
    console.error('Webhook post failed:', e);
    return res.status(502).send('Discord webhook failed');
  }

  // Return
  if (req.method === 'GET') return res.status(200).send('ok'); // handy for browser tests
  return res.status(204).end();
};
