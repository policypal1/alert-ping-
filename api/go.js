// api/go.js  — minimal + reliable, with simple dedupe per-warm-instance
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

    // tiny dedupe to prevent multiple near-identical "tracked link clicked" messages
    const DEDUPE_MS = 2000;
    if (!global.__go_dedupe) global.__go_dedupe = new Map();
    const key = `${ip}|${ua}|${dest}`;
    const now = Date.now();
    const last = global.__go_dedupe.get(key);
    if (last && (now - last) < DEDUPE_MS) {
      // skip sending duplicate webhook — still redirect
      res.writeHead(302, { Location: dest });
      return res.end();
    }
    global.__go_dedupe.set(key, now);
    // GC
    for (const [k, t] of global.__go_dedupe) if (now - t > DEDUPE_MS * 10) global.__go_dedupe.delete(k);

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
    console.error(e && e.stack || e);
    res.status(500).send('Server error.');
  }
};
