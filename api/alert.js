\// api/alert.js
// Aggregated, info-dense Discord alerts with VPN score + approx location.
// Works on Vercel (Node 18). One readable alert per burst.

const dns = require('node:dns').promises;

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return res.status(500).send('❌ ERROR: DISCORD_WEBHOOK_URL is NOT set');

  // ---------- config ----------
  const AGG_WINDOW_MS = 3500;
  const HOLD_MS = 12000;
  const DEBUG_MAX = 1400;
  const RDNS_TIMEOUT = 350;

  if (!global.__ALERT_AGG) global.__ALERT_AGG = new Map();
  const agg = global.__ALERT_AGG;

  const safeJson = o => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } };
  const trim = (s, n) => (s && s.length > n ? s.slice(0, n - 100) + '\n...trimmed...' : (s || ''));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const parseUA = (ua='')=>{
    let browser='Unknown';
    if (/edg/i.test(ua)) browser='Edge';
    else if (/opr|opera/i.test(ua)) browser='Opera';
    else if (/firefox|fxios/i.test(ua)) browser='Firefox';
    else if (/chrome|crios/i.test(ua)) browser='Chrome';
    else if (/safari/i.test(ua)) browser='Safari';
    let os='Unknown';
    if (/windows nt/i.test(ua)) os='Windows';
    else if (/macintosh|mac os x/i.test(ua)) os='macOS';
    else if (/android/i.test(ua)) os='Android';
    else if (/iphone|ipad|ipod/i.test(ua)) os='iOS';
    else if (/linux/i.test(ua)) os='Linux';
    const device = /mobile|android|iphone|ipad|ipod/i.test(ua) ? (/android/i.test(ua) ? 'Android' : (/iphone|ipad|ipod/i.test(ua) ? 'iPhone' : 'Mobile')) : 'PC';
    return {browser, os, device};
  };

  const flagFor = (cc='')=>{
    if(!cc) return '';
    try { return String.fromCodePoint(...[...cc].map(c=>0x1F1E6 + (c.charCodeAt(0)-65))); } catch { return ''; }
  };

  const postDiscord = async (payloads) => {
    for (const p of payloads) {
      const r = await fetch(webhook, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(p)
      });
      if (!r.ok) {
        await fetch(webhook, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ content: '⚠️ Alert too large; sent minimal summary.' })
        }).catch(()=>{});
        break;
      }
    }
  };

  // ---------- parse request ----------
  const ua = req.headers['user-agent'] || '';
  const uaParsed = parseUA(ua);
  const ip = (req.headers['x-forwarded-for']||'').split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const refHeader = req.headers['referer'] || 'none';

  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}'); }
    catch { body = {}; }
  }

  // Vercel geo headers
  const city      = req.headers['x-vercel-ip-city'] || '';
  const region    = req.headers['x-vercel-ip-country-region'] || req.headers['x-vercel-ip-region'] || '';
  const country   = (req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const asn       = req.headers['x-vercel-ip-asn'] || '';
  const latitude  = req.headers['x-vercel-ip-latitude'] || '';
  const longitude = req.headers['x-vercel-ip-longitude'] || '';

  // Use pathname only
  const onlyPathname = (s)=>{
    try { return new URL(s, 'https://x.invalid').pathname || '/'; } catch { return (s||'/').split('?')[0]; }
  };

  const client = {
    clickId: body.click_id || null,
    fpHash: body.fpHash || null,

    browser: body.browser || uaParsed.browser,
    os:      body.os || uaParsed.os,
    device:  body.device || uaParsed.device,

    language: body.language || (req.headers['accept-language']||'').split(',')[0] || 'unknown',
    languages: Array.isArray(body.languages) ? body.languages : null,
    timezone: body.timezone || null,
    timezoneOffsetMin: body.timezoneOffsetMin ?? null,

    extra: body.extra || null,

    color:  body.color || null,
    screen: body.screen || null,
    hw:     body.hw || null,
    net:    body.net || null,
    battery:body.battery || null,
    gpu:    body.gpu || null,

    path: onlyPathname(body.path || req.url || '/'),
    ref:  body.ref || refHeader || 'none'
  };

  // ---------- VPN / proxy score ----------
  async function vpnScore() {
    let score = 0;
    const reasons = [];

    if (client.timezone && country) {
      const usTZ = ['America/Los_Angeles','America/Denver','America/Chicago','America/New_York','America/Phoenix','America/Anchorage','Pacific/Honolulu'];
      const tzIsUS = usTZ.includes(client.timezone);
      if ((country !== 'US' && tzIsUS) || (country === 'US' && !tzIsUS)) {
        score += 20; reasons.push('Timezone vs country mismatch');
      }
    }
    if (client.language && country) {
      const lang = client.language.toLowerCase();
      if (country === 'US' && !lang.startsWith('en')) { score += 10; reasons.push('Non-EN language in US'); }
      if (country !== 'US' && lang.startsWith('en') && !['GB','CA','AU','NZ','IE'].includes(country)) { score += 5; reasons.push('English outside EN-dominant country'); }
    }
    const asnL = (asn||'').toLowerCase();
    const vpnAsnHints = ['m247','ovh','digitalocean','linode','choopa','contabo','hetzner','leaseweb','vultr','azure','amazon','aws','google','gcp','cloudflare','warp','mullvad','proton','surfshark','windscribe','airvpn','privateinternetaccess','hivelocity','nocix','colo'];
    if (asnL && vpnAsnHints.some(k=>asnL.includes(k))) { score += 35; reasons.push(`ASN: ${asn}`); }

    let rdns = '';
    try {
      const p = dns.reverse(ip);
      const r = await Promise.race([
        p.then(names => (Array.isArray(names) && names[0]) || '').catch(()=> ''),
        new Promise(res => setTimeout(()=>res(''), RDNS_TIMEOUT))
      ]);
      rdns = r || '';
    } catch {}
    const rdnsL = (rdns||'').toLowerCase();
    if (rdnsL) {
      const bads = ['vpn','proxy','m247','ovh','aws','amazonaws','compute','google','gcp','cloud','azure','linode','digitalocean','mullvad','proton','surfshark','windscribe','airvpn','piavpn','leaseweb','contabo','choopa','colo','nocix'];
      if (bads.some(x=>rdnsL.includes(x))) { score += 35; reasons.push(`rDNS: ${rdns}`); }
    }

    score = clamp(score, 0, 100);
    const tier = score >= 70 ? 'High' : score >= 35 ? 'Medium' : 'Low';
    return { score, tier, reasons, rdns, asn };
  }

  const vpn = await vpnScore();

  // ---------- approx location ----------
  const flag = flagFor(country);
  const approxLoc = (city || region || country)
    ? `${city ? city + ', ' : ''}${region ? region + ', ' : ''}${country}${flag ? ' ' + flag : ''}`
    : 'Unknown';

  // ---------- aggregation ----------
  const key = [ip, client.device||'-', client.browser||'-', client.path||'/', client.fpHash || '-', client.clickId || '-'].join('|');
  const now = Date.now();
  const existing = agg.get(key);
  if (existing) {
    existing.count += 1;
    existing.lastTs  = now;
    existing.client  = client;
    existing.body    = body;
    existing.headers = req.headers;
    existing.vpn     = vpn;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(()=>send(key), AGG_WINDOW_MS);
  } else {
    agg.set(key, {
      count: 1,
      firstTs: now,
      lastTs: now,
      client, body, headers: req.headers, vpn,
      timer: setTimeout(()=>send(key), AGG_WINDOW_MS)
    });
  }

  if (req.method === 'GET') return res.status(200).send('ok');
  res.status(204).end();

  async function send(k){
    const item = agg.get(k); if (!item) return;
    const c = item.client;
    const first = new Date(item.firstTs).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const last  = new Date(item.lastTs).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

    const fields = [
      { name:'Count (deduped)', value:String(item.count), inline:true },
      { name:'When', value:`${first} → ${last}`, inline:false },
      { name:'VPN/Proxy', value:`${item.vpn.tier} (${item.vpn.score}/100)`, inline:true },
      { name:'VPN hints', value:item.vpn.reasons.length ? item.vpn.reasons.join(' • ') : '—', inline:false },
      { name:'Device / OS / Browser', value:`${c.device} / ${c.os} / ${c.browser}`, inline:false },
      { name:'Approx Location', value:`${approxLoc}${latitude&&longitude?` (${latitude}, ${longitude})`:''}`, inline:false },
      { name:'IP', value: ip, inline:true },
      { name:'Path', value: c.path || '/', inline:true },
      { name:'Referrer', value: c.ref || 'none', inline:true },
      { name:'Lang / TZ', value: `${c.language}${c.languages?` (${c.languages.join(', ')})`:''} / ${c.timezone || '—'}`, inline:false },
      { name:'TZ offset (min)', value: String(c.timezoneOffsetMin ?? '—'), inline:true },
      { name:'FP Hash', value: c.fpHash || '—', inline:true },
      { name:'Click ID', value: c.clickId || '—', inline:true }
    ];

    if (c.extra) fields.push({ name:'Platform/Vendor', value:`${c.extra.platform || '-'} / ${c.extra.vendor || '-'}`, inline:true });
    if (c.extra) fields.push({ name:'Touch/Cookies/DNT', value:`touch=${c.extra.maxTouchPoints||0} • cookies=${c.extra.cookieEnabled?'on':'off'} • dnt=${c.extra.doNotTrack||'n/a'}`, inline:false });
    if (c.extra && c.extra.userAgentData) fields.push({ name:'UA-CH', value:`${c.extra.userAgentData.platform || '-'} • ${c.extra.userAgentData.mobile?'mobile':'desktop'} • ${ (c.extra.userAgentData.brands||[]).join(', ') }`, inline:false });

    if (c.color) fields.push({ name:'Color/Prefs', value:`${c.color.scheme || '-'} • gamut=${c.color.gamut || '-'} • hdr=${c.color.hdr || '-'} • motion=${c.color.prefersReducedMotion || '-'} • contrast=${c.color.prefersContrast || '-'}`, inline:false });

    if (c.screen) fields.push({ name:'Screen', value:`${c.screen.w}×${c.screen.h} (${c.screen.colorDepth}-bit) • dpr=${c.screen.dpr} • avail=${c.screen.availW}×${c.screen.availH} • inner=${c.screen.innerW}×${c.screen.innerH}`, inline:false });

    if (c.hw) fields.push({ name:'Hardware', value:`${c.hw.cores ?? '-'} cores • ${c.hw.memoryGB ?? '-'} GB RAM`, inline:true });
    if (c.net) fields.push({ name:'Network', value:`${c.net.type || '-'} • ${c.net.downlink ?? '-'} Mb/s`, inline:true });

    if (c.battery) fields.push({ name:'Battery', value:`${Math.round((c.battery.level ?? 0)*100)}% • ${c.battery.charging ? '⚡ charging' : 'idle'}`, inline:true });

    if (c.gpu) fields.push({ name:'GPU', value:`${c.gpu.renderer || c.gpu.vendor || '-'} • maxTex=${c.gpu.maxTextureSize || '-'} • exts=${Array.isArray(c.gpu.extensions)?c.gpu.extensions.join(', '):'-'}`, inline:false });

    // geo tech details
    if (item.vpn.rdns) fields.push({ name:'rDNS', value:item.vpn.rdns, inline:false });
    if (item.vpn.asn)  fields.push({ name:'ASN',  value:String(item.vpn.asn), inline:false });

    const embed = {
      title: 'New Visit (aggregated)',
      color: 0x00A3FF,
      fields,
      timestamp: new Date(item.lastTs).toISOString()
    };

    const debug = { headers: item.headers || {}, body: item.body || {}, rawUa: ua };
    const debugMsg = '```json\n' + trim(safeJson(debug), DEBUG_MAX) + '\n```';

    try {
      await postDiscord([{ embeds:[embed] }, { content: debugMsg }]);
    } catch (e) {
      console.error('Discord send error', e && e.stack || e);
    }

    clearTimeout(item.timer);
    setTimeout(()=>agg.delete(k), HOLD_MS);
  }
};
