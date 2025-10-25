// api/ping.js — minimal pageview pinger to Discord
module.exports = async (req, res) => {
  try {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) {
      console.error('Missing DISCORD_WEBHOOK_URL');
      return res.status(500).end();
    }

    const ts = new Date().toISOString();
    const ua = (req.headers['user-agent'] || 'unknown');
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const ref = req.headers['referer'] || 'none';

    // Try to read JSON body (from sendBeacon/fetch)
    let body = {};
    if (req.method !== 'GET') {
      const raw = await new Promise((resolve) => {
        let d = ''; req.on('data', c => d += c); req.on('end', () => resolve(d));
      });
      try { body = JSON.parse(raw || '{}'); } catch {}
    }

    const path = body.path || (req.headers['x-pathname'] || 'unknown');

    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content:
          `👀 **Page view**\n` +
          `• **Time**: ${ts}\n` +
          `• **Path**: ${path}\n` +
          `• **IP**: ${ip}\n` +
          `• **User-Agent**: ${ua}\n` +
          `• **Referrer**: ${ref}`
      })
    });

    // No content, quick return
    return res.status(204).end();
  } catch (e) {
    console.error(e);
    return res.status(500).end();
  }
};
