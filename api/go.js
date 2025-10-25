// Serverless function: /api/go
// 1) Posts a Discord webhook notification with click metadata
// 2) Redirects to DEST_URL (your real link)

// This file uses Node.js on Vercel (no extra setup needed)

export default async function handler(req, res) {
  try {
    const ts = new Date().toISOString();
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    const referer = req.headers['referer'] || 'none';

    const webhook = process.env.DISCORD_WEBHOOK_URL;
    const dest = process.env.DEST_URL; // <- set to https://buy-a-brainrot.vercel.app/

    const contentLines = [
      '🔔 **Link clicked**',
      `• **Time**: ${ts}`,
      `• **IP**: ${ip}`,
      `• **User-Agent**: ${ua}`,
      `• **Referer**: ${referer}`,
      `• **Redirecting to**: ${dest || 'UNKNOWN'}`
    ];
    const content = contentLines.join('\n');

    // Notify Discord (if webhook set)
    if (webhook) {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
    } else {
      console.error('Missing DISCORD_WEBHOOK_URL');
    }

    // Redirect the user
    if (dest) {
      res.writeHead(302, { Location: dest });
      return res.end();
    } else {
      return res.status(500).send('DEST_URL not configured.');
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error.');
  }
}
