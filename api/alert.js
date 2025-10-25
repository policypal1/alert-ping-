// api/alert.js  — tracker project
module.exports = async (req, res) => {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('Missing DISCORD_WEBHOOK_URL');

  // Body/params (accept JSON, text, or query)
  let body = {};
  if (req.method === 'POST') {
    const raw = await new Promise((r) => {
      let d = ''; req.on('data', c => d += c); req.on('end', () => r(d));
    });
    try { body = JSON.parse(raw || '{}'); } catch { body = { raw }; }
  }
  const path = body.path || req.query.path || 'unknown';
  const ref  = body.ref  || req.query.ref  || req.headers['referer'] || 'none';
  const ua   = req.headers['user-agent'] || 'unknown';
  const ip   = (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim()
            || req.socket?.remoteAddress || 'unknown';
  const ts   = new Date().toISOString();

  // Send to Discord
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

  // Browser-friendly responses
  if (req.method === 'GET') return res.status(200).send('ok');
  return res.status(204).end();
};
