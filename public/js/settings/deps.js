/* ═══════════════════════════════════════════════════════
   Settings → General → Updates → Check dependencies (modules/deps.js).
   A toggle beside Update: when on, every check also lists the panel's own
   packages that are behind (current → wanted → latest, with the licence) and
   npm's security advisories. Updating them is a release step (npm run
   deps:update), so this reports; it does not install.
   ═══════════════════════════════════════════════════════ */

function _depsBlock() {
  let el = document.getElementById('deps-block');
  if (el) return el;
  const card = document.getElementById('update-log')?.closest('.card');
  if (!card) return null;
  el = document.createElement('div');
  el.id = 'deps-block';
  el.style.marginTop = '12px';
  el.innerHTML = `
    <div class="settings-tab-row">
      <label class="skill-toggle">
        <input type="checkbox" id="deps-toggle" onchange="depsToggle(this)">
        <span class="skill-toggle-track"></span>
      </label>
      <span class="settings-tab-label">Check dependencies — packages behind, and security advisories</span>
    </div>
    <div id="deps-list"></div>`;
  card.appendChild(el);
  return el;
}

let _depsSeq = 0;   // only the latest check draws: two can overlap (a check, then the toggle)

async function depsLoad(force = false) {
  if (!_depsBlock()) return;
  const seq = ++_depsSeq;
  let on = false;
  try { on = !!(await apiFetch('/api/prefs')).updates?.checkDeps; } catch {}
  document.getElementById('deps-toggle').checked = on;
  const list = document.getElementById('deps-list');
  if (!on) { list.innerHTML = ''; return; }
  list.innerHTML = '<div class="placeholder pulse" style="margin-top:8px">Asking npm…</div>';
  try { const d = await apiFetch(`/api/deps${force ? '?force=1' : ''}`); if (seq === _depsSeq) _depsRender(d); }
  catch (e) { if (seq === _depsSeq) list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; }
}

async function depsToggle(box) {
  try {
    const prefs = await apiFetch('/api/prefs');
    await apiFetch('/api/prefs', { method: 'POST', body: { updates: { ...(prefs.updates || {}), checkDeps: box.checked } } });
  } catch {}
  depsLoad(true);
}

function _depsRender(d) {
  const list = document.getElementById('deps-list');
  const sevColor = { critical: 'var(--red)', high: 'var(--red)', moderate: 'var(--amber)', low: 'var(--muted)', info: 'var(--muted)' };
  const adv = d.advisories.map(a => `
    <div class="snap-item">
      <div style="min-width:0">
        <div class="snap-name"><span style="color:${sevColor[a.severity] || 'var(--text)'}">${escHtml(a.severity)}</span> · ${escHtml(a.name)}${a.direct ? '' : ' <span class="snap-date">(through another package)</span>'}</div>
        <div class="snap-date">${a.url ? `<a href="${escHtml(a.url)}" target="_blank" rel="noopener noreferrer">${escHtml(a.title || a.url)}</a>` : escHtml(a.title || '')}${a.fixInRange ? ' · fixed by updating within the declared ranges' : ' · needs a range change'}</div>
      </div>
    </div>`).join('');
  const pk = d.packages.map(p => `
    <div class="snap-item">
      <div style="min-width:0">
        <div class="snap-name">${escHtml(p.name)} <span class="snap-date">${escHtml(p.licence || 'licence unknown')}</span></div>
        <div class="snap-date">${escHtml(p.current || '—')} → ${escHtml(p.wanted || '—')}${p.latest && p.latest !== p.wanted ? ` · latest ${escHtml(p.latest)}${p.major ? ' (a new major version: a decision, not an update)' : ''}` : ''}</div>
      </div>
    </div>`).join('');
  const inRange = d.packages.filter(p => p.inRange).length;
  const summary = d.advisories.length || d.packages.length
    ? `${d.advisories.length} advisor${d.advisories.length === 1 ? 'y' : 'ies'}, ${d.packages.length} package(s) behind (${inRange} within their ranges). `
      + 'Updating is a release step: npm run deps:update, then the tests, then a version.'
    : 'Everything is current and npm reports no advisories.';
  list.innerHTML = `
    <div class="input-label" style="text-transform:none;letter-spacing:0;margin:8px 0">${escHtml(summary)} Checked ${fmtDate(d.checkedAt)}.
      <button class="btn btn-xs" onclick="depsLoad(true)">↺ Ask again</button></div>
    ${d.errors.length ? `<div class="placeholder" style="color:var(--amber)">${d.errors.map(escHtml).join('<br>')}</div>` : ''}
    ${adv}${pk}`;
}
