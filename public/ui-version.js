// Both frontends share only the version preference; their settings stay independent.
(() => {
  const key = 'helios_leaderboard_ui_version';
  const legacy = /\/v1\.html$/i.test(location.pathname);
  let selected = 'current';
  try { selected = localStorage.getItem(key) || 'current'; } catch {}
  function go(version) {
    location.replace(version === 'v1' ? '/v1.html' : '/');
  }
  window.HeliosVersion = {
    choose(version) {
      if (!['v1', 'current'].includes(version)) return;
      try { localStorage.setItem(key, version); } catch {
        alert('Cannot save your choice. Please enable browser storage.'); return;
      }
      go(version);
    }
  };
  if (legacy !== (selected === 'v1')) go(selected);
})();
