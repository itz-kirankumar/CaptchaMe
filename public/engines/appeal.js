document.getElementById('actor').value = new URLSearchParams(location.search).get('actor') || '';
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await fetch('/api/appeal', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: document.getElementById('actor').value, message: document.getElementById('msg').value }) });
  const b = await r.json();
  document.getElementById('out').innerHTML = r.ok ? `<div class="result pass">${b.reason}</div>` : `<div class="result fail">${b.reason || 'Failed'}</div>`;
});
