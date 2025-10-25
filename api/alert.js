export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ua = req.headers['user-agent'] || 'unknown';
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  // --- Parse device ---
  let device = 'Unknown Device';
  if (/mobile|android|iphone|ipad|ipod/i.test(ua)) {
    if (/android/i.test(ua)) device = 'Android';
    else if (/iphone|ipad|ipod/i.test(ua)) device = 'iPhone';
    else device = 'Mobile';
  } else {
    device = 'PC';
  }

  // --- Parse browser ---
  let browser = 'Unknown';
  if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opera|opr/i.test(ua)) browser = 'Opera';

  // --- Oregon time ---
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

  // --- Discord webhook ---
  const webhook = process.env.WEBHOOK_URL; // or paste your webhook directly here if you prefer
  if (!webhook) return res.status(400).send('Webhook not set');

  const embed = {
    title: '👀 New Page View',
    color: 0x57f287,
    fields: [
      { name: '🕒 Time', value: now, inline: false },
      { name: '💻 Device', value: `${device}`, inline: true },
      { name: '🌐 Browser', value: `${browser}`, inline: true },
      { name: '📍 IP', value: ip, inline: false }
    ],
  };

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  res.status(200).json({ ok: true });
}
