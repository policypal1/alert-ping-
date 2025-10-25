// api/alert.js — minimal test + pageview endpoint
module.exports = async (req, res) => {
  try {
    const webhook = process.env.DISCORD_WEBHOOK_URL;

    // Build a simple message
    const ts = new Date().toISOString();
    const ua = req.headers['user-agent'] || 'unknown';
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim()
           || req.socket?.remoteAddress || 'unknown';
    const ref = req.headers['referer'] || 'none';

    let body = {};
    if (req.method !== 'GET') {
      const raw = await new Promise((resolve) => {
        let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d));
      });
      try { body = JSON.parse(raw || '{}'); } catch {}
    }
    const path = body.path || (req.query.path || 'unknown');

    if (!webhook) {
      console.error('Missing DISCORD_WEBHOOK_URL');
      return res.status(500).send('Missing DISCORD_WEBHOOK_URL');
    }

    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content:
          `🔔 **Alert**\n` +
          `• Time: ${ts}\n` +
          `• Path: ${path}\n` +
          `• IP: ${ip}\n` +
          `• UA: ${ua}\n` +
          `• Referrer: ${ref}`
      })
    });

    // Return simple OK so you see something in the browser
    res.status(200).send('ok');
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
};
