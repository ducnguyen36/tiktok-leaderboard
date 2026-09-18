(() => {
  let checking = false, denied = false;
  function clearPrivateView() {
    if (denied) return; denied = true;
    document.documentElement.style.visibility = 'hidden';
    try { for (const key of Object.keys(localStorage)) if (key.startsWith('helios_leaderboard') || key === 'leaderboard_config') localStorage.removeItem(key); } catch {}
    document.body?.replaceChildren();
    location.replace('/auth');
  }
  async function check() {
    if (checking || denied) return; checking = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/auth/status', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) return;
      if (!(await response.json()).authorized) clearPrivateView();
    } catch {
      // Container restarts and temporary network failures are not access revocations.
      // The next scheduled check will verify authorization again.
    } finally { clearTimeout(timer); checking = false; }
  }
  // Never let a late response repaint or repersist private history after denial.
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    if (denied) throw Error('Access lost');
    const response = await originalFetch(...args);
    const originalJson = response.json.bind(response);
    response.json = async () => { const data = await originalJson(); if (denied) throw Error('Access lost'); return data; };
    if (denied) throw Error('Access lost'); return response;
  };
  window.addEventListener('pageshow', check);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, 5000); check();
})();
