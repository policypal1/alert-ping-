// api/ping.js
module.exports = async (req, res) => {
  try {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) return res.status(500).end();

    const ts = new Date().toISOString();
    const ua = req.headers['user-agent'] || 'unknown';
    const ip = (req.headers['x-forwarded-for']||'').split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const ref = req.headers['referer'] || 'none';

    let body = {};
    if (req.method !== 'GET') {
      const raw = await new Promise(resolve => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>resolve(d)); });
      try { body = JSON.parse(raw || '{}'); } catch {}
    }
    const path = body.path || (req.headers['x-pathname'] || 'unknown');

    await fetch(webhook, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ embeds: [{
        title: 'Page view',
        color: 0x8888ff,
        fields: [
          { name:'Time', value: ts, inline: false },
          { name:'Path', value: path, inline: true },
          { name:'IP', value: ip, inline: true },
          { name:'Referrer', value: ref, inline: false }
        ]
      }]})
    });

    return res.status(204).end();
  } catch (e) {
    console.error(e && e.stack || e);
    return res.status(500).end();
  }
};
