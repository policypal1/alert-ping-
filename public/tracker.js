<script>
/* Lightweight client tracker
   - Prompts once for tester name, stores in localStorage + cookie
   - Gathers basic device/network info
   - Sends a POST to /api/alert on page load
*/
(function(){
  const KEY = 'tester_name';
  function setCookie(name, value, days){
    try{
      const d = new Date(); d.setTime(d.getTime() + (days*24*60*60*1000));
      document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + d.toUTCString() + '; path=/; SameSite=Lax';
    }catch(_){}
  }
  function getName(){
    let n = localStorage.getItem(KEY);
    if (!n) {
      n = prompt('Tester name for logs?'); // consent prompt for your test group
      if (n) {
        localStorage.setItem(KEY, n);
        setCookie('name', n, 365); // also expose via cookie so GET hits can read it
      }
    } else {
      // keep cookie fresh
      setCookie('name', n, 365);
    }
    return n || null;
  }
  async function collect(){
    const name = getName();

    const payload = {
      name,
      path: location.pathname,
      language: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      color: { scheme: matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' },
      screen: { w: screen.width, h: screen.height, colorDepth: screen.colorDepth },
      hw: { cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null },
      net: (navigator.connection ? { type: navigator.connection.effectiveType, downlink: navigator.connection.downlink } : null),
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

    // Minimal WebGL GPU hint
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

    // Fire the alert (non-blocking)
    try {
      await fetch('/api/alert', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
    } catch {}
  }

  if (document.readyState === 'complete') collect();
  else addEventListener('load', collect);
})();
</script>
