/* public/tracker.js
   - Prompts once for tester name (consent)
   - Saves name to localStorage + cookie
   - Generates a clickId per page load
   - Collects device info
   - Sends EXACTLY ONCE per page load (client guard)
*/
(function(){
  const NAME_KEY  = 'tester_name';
  const SEND_KEY  = 'sent_once_' + location.pathname; // per-path guard
  const CLICK_ID  = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);

  function setCookie(name, value, days){
    try {
      const d = new Date(); d.setTime(d.getTime() + (days*864e5));
      document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + d.toUTCString() + '; path=/; SameSite=Lax';
    } catch {}
  }
  function getName(){
    let n = localStorage.getItem(NAME_KEY);
    if (!n) {
      n = prompt('Tester name for logs?');
      if (n) {
        localStorage.setItem(NAME_KEY, n);
        setCookie('name', n, 365);
      }
    } else {
      setCookie('name', n, 365);
    }
    return n || null;
  }

  async function collectAndSend(){
    if (sessionStorage.getItem(SEND_KEY)) return; // client "send once" guard
    sessionStorage.setItem(SEND_KEY, '1');

    const name = getName();
    const payload = {
      name,
      click_id: CLICK_ID,
      path: location.pathname,                 // pathname only (no random queries)
      language: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      color: { scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
      screen: { w: screen.width, h: screen.height, colorDepth: screen.colorDepth },
      hw: { cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null },
      net: navigator.connection ? { type: navigator.connection.effectiveType, downlink: navigator.connection.downlink } : null,
      battery: null,
      gpu: null
    };

    // Battery (best-effort)
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        payload.battery = { level: b.level, charging: b.charging };
      }
    } catch {}

    // Minimal GPU hint
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) payload.gpu = {
          vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
          renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        };
      }
    } catch {}

    // Send (non-blocking)
    try {
      await fetch('/api/alert', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {}
  }

  if (document.readyState === 'complete') collectAndSend();
  else addEventListener('load', collectAndSend);
})();
