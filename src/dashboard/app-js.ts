/** Small progressive-enhancement script: auto-submit filters, POST forms via fetch, show the result. */
export const APP_JS = `
document.querySelectorAll('form[data-autosubmit] select').forEach(function (s) {
  s.addEventListener('change', function () { s.form.submit(); });
});
document.querySelectorAll('form[data-post]').forEach(function (f) {
  f.addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
    var out = f.querySelector('.result') || f.appendChild(Object.assign(document.createElement('span'), { className: 'result why', role: 'status' }));
    try {
      var r = await fetch(f.action, { method: 'POST', body: new URLSearchParams(new FormData(f)), headers: { 'accept': 'application/json' } });
      var j = await r.json().catch(function () { return { message: r.statusText }; });
      out.textContent = ' ' + (j.message || (r.ok ? 'Done.' : 'Failed.'));
      if (r.ok && f.hasAttribute('data-reload')) setTimeout(function () { location.reload(); }, 900);
    } catch (err) { out.textContent = ' Could not reach the dashboard server. Is npm run dashboard still running?'; }
    if (btn) btn.disabled = false;
  });
});
`;
