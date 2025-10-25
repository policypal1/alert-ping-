// /api/go.js  — minimal + reliable
module.exports = async (req, res) => {
  try {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    const dest = process.env.DEST_URL || 'https://buy-a-brainrot.vercel.app/';

    const ts = new Date().toISOString();
    const ua = req.headers['user-agent'] || 'unknown';
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const ref = req.headers['referer'] || 'none';

    if (!webhook) {
      console.error('Missing DISCORD_WEBHOOK_URL');
    } else {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content:
            `🔔 **Tracked link clicked**\n` +
            `• **Time**: ${ts}\n` +
            `• **IP**: ${ip}\n` +
            `• **User-Agent**: ${ua}\n` +
            `• **Referrer**: ${ref}\n` +
            `• **Redirecting to**: ${dest}`
        })
      });
    }

    // Always redirect (even if webhook missing), so the link still works
    res.writeHead(302, { Location: dest });
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error.');
  }
};
