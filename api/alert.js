// api/alert.js
// Minimal, reliable Discord alert endpoint for Vercel

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  // 1) Webhook from Vercel env
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    // Visible error so you notice instantly
    return res
      .status(500)
      .send("❌ ERROR: DISCORD_WEBHOOK_URL is NOT set in Vercel Environment Variables");
  }

  // 2) Parse body (POST) or use defaults
  let body = {};
  if (req.method === "POST") {
    try { body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}"); }
    catch { body = {}; }
  }

  // 3) Basic request metadata
  const ua = req.headers["user-agent"] || "unknown";
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const path = body.path || req.headers["x-pathname"] || req.url || "/";
  const name = body.name || "Unknown Tester";

  // 4) Compose a human-friendly message (kept < 2000 chars)
  const lines = [
    `**New Visit Alert**`,
    `👤 Name: ${name}`,
    `🌐 IP: ${ip}`,
    `💻 User Agent: ${ua}`,
    `📍 Path: ${path}`,
    ``,
    `🗣 Language: ${body.language || "unknown"}`,
    `⏱ Timezone: ${body.timezone || "unknown"}`,
    ``,
    `🎨 Color Mode: ${body.color?.scheme || "unknown"}`,
    `🖥 Screen: ${body.screen?.w || "?"}×${body.screen?.h || "?"} (${body.screen?.colorDepth || "?"}-bit)`,
    `⚙️ CPU Cores: ${body.hw?.cores || "?"}`,
    `💾 RAM (approx): ${body.hw?.memoryGB || "?"} GB`,
    ``,
    `🔋 Battery: ${
      body.battery
        ? `${Math.round((body.battery.level || 0) * 100)}% (${body.battery.charging ? "Charging" : "Idle"})`
        : "unknown"
    }`,
    ``,
    `🎮 GPU: ${body.gpu ? (body.gpu.renderer || body.gpu.vendor) : "unknown"}`
  ];
  const message = lines.join("\n").slice(0, 1900); // hard cap for Discord safety

  // 5) Send to Discord
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch (err) {
    return res.status(500).send("❌ Failed to send to Discord: " + String(err));
  }

  // 6) Respond to browser
  return res.status(204).end();
};
