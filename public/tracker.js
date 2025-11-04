/* public/tracker.js
   - No consent prompt. Sends once per page load automatically.
   - Collects rich device/browser info.
   - Generates click_id and a light fpHash (SHA-256 of stable traits).
*/
(function () {
  const CLICK_ID  = (crypto.randomUUID && crypto.randomUUID()) || (Date.now() + "-" + Math.random().toString(36).slice(2));

  function colorGamut() {
    try {
      if (matchMedia("(color-gamut: rec2020)").matches) return "rec2020";
      if (matchMedia("(color-gamut: p3)").matches) return "p3";
      if (matchMedia("(color-gamut: srgb)").matches) return "srgb";
    } catch {}
    return null;
  }

  function motionPref() {
    try { return matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference"; } catch {}
    return null;
  }

  function contrastPref() {
    try {
      if (matchMedia("(prefers-contrast: more)").matches) return "more";
      if (matchMedia("(prefers-contrast: less)").matches) return "less";
    } catch {}
    return "no-preference";
  }

  function hdrSupport() {
    try { return matchMedia("(dynamic-range: high)").matches ? "high" : "standard"; } catch {}
    return null;
  }

  async function getGPUInfo() {
    const info = { vendor: null, renderer: null, maxTextureSize: null, extensions: null };
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return info;
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        info.vendor   = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
        info.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      }
      info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || null;
      try {
        const exts = gl.getSupportedExtensions() || [];
        info.extensions = exts.slice(0, 30); // cap to keep payload small
      } catch {}
    } catch {}
    return info;
  }

  async function getBattery() {
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        return { level: b.level, charging: b.charging };
      }
    } catch {}
    return null;
  }

  async function sha256Hex(s) {
    try {
      const enc = new TextEncoder().encode(s);
      const buf = await crypto.subtle.digest("SHA-256", enc);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("").slice(0, 32);
    } catch { return null; }
  }

  async function collectAndSend() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

    // Lightweight, stable fingerprint
    const fpSource = JSON.stringify({
      ua: navigator.userAgent,
      platform: navigator.platform,
      lang: navigator.language,
      langs: navigator.languages,
      cores: navigator.hardwareConcurrency,
      mem: navigator.deviceMemory,
      dpr: window.devicePixelRatio,
      scr: [screen.width, screen.height, screen.colorDepth],
      tz,
    });
    const fpHash = await sha256Hex(fpSource);

    const gpu = await getGPUInfo();
    const battery = await getBattery();

    const payload = {
      path: location.pathname,                     // pathname only
      click_id: CLICK_ID,
      fpHash,

      // Browser & locale
      language: navigator.language || null,
      languages: (navigator.languages && navigator.languages.slice(0, 8)) || null,
      timezone: tz,
      timezoneOffsetMin: new Date().getTimezoneOffset(),

      // Device / platform
      extra: {
        platform: navigator.platform || null,
        vendor: navigator.vendor || null,
        cookieEnabled: navigator.cookieEnabled || null,
        doNotTrack: navigator.doNotTrack || null,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        userAgentData: (navigator.userAgentData && {
          mobile: navigator.userAgentData.mobile || false,
          platform: navigator.userAgentData.platform || null,
          brands: (navigator.userAgentData.brands || []).map(b => `${b.brand} ${b.version}`).slice(0, 6)
        }) || null
      },

      // Display & UX prefs
      color: { scheme: (matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light",
               gamut: colorGamut(), hdr: hdrSupport(), prefersReducedMotion: motionPref(), prefersContrast: contrastPref() },

      screen: {
        w: screen.width, h: screen.height, colorDepth: screen.colorDepth,
        availW: screen.availWidth, availH: screen.availHeight,
        dpr: window.devicePixelRatio || 1,
        innerW: window.innerWidth, innerH: window.innerHeight
      },

      // Hardware & network
      hw: { cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null },
      net: (navigator.connection ? { type: navigator.connection.effectiveType, downlink: navigator.connection.downlink } : null),

      // Power & graphics
      battery,
      gpu
    };

    try {
      await fetch("/api/alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch {}
  }

  if (document.readyState === "complete") collectAndSend();
  else addEventListener("load", collectAndSend);
})();
