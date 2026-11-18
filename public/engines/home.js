(function () {
  'use strict';
  // Live counters under the hero.
  async function stats() {
    if (!document.getElementById('statband')) return;
    try {
      const s = await (await fetch('/api/stats', { cache: 'no-store' })).json();
      const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = Number(n || 0).toLocaleString(); };
      set('st-checks', s.checks); set('st-humans', s.humans); set('st-bots', s.botsCaught); set('st-agents', s.agents); set('st-scrape', s.scrapersStopped);
    } catch { /* offline */ }
    setTimeout(stats, 4000);
  }
  stats();
})();
