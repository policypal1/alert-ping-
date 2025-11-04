// api/selftest.js — quick E2E test for your Discord webhook + fetch
module.exports = async (req, res) => {
  try {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (!webhook) {
      return res
        .status(500)
        .json({ ok: false, error: 'Missing DISCORD_WEBHOOK_URL env var' });
    }

    const ts = new Date().toISOString();
    const resp = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `✅ Self-test ping @ ${ts}` })
    });

    const text = await resp.text();
    return res.status(200).json({
      ok: resp.ok,
      status: resp.status,
      note: 'If ok=true, check your Discord channel for a self-test message.',
      discord_response_snippet: text.slice(0, 200)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
};
