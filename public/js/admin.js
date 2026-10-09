/* Hub → Admin (modules/admin; the owner's yes of 2026-10-09): one page that answers "is everything fine, and what
   needs me?" — status and links, never a second copy of settings. Five cards from GET /api/admin/overview, each line
   a point (its state), a label, a value and where it is handled; a tap goes there. The hub words every line from
   fixed templates (visibility is mechanical: no model); this page only draws them. While shown it reads again when the
   live feed says something moved (missions, teams, devices, notices, the hub's activity), at most every few seconds,
   and once a minute besides. Servable alone: /?view=admin. Its page is made here: index.html is at its line ceiling. */
const ADMIN = { off: null, timer: null, data: null, loading: false };
const ADMIN_PT = { ok: 'pt-up', info: 'adm-pt-info', ask: 'pt-ask', err: 'pt-err' };
const ADMIN_LIVE = ['missions', 'teams', 'device', 'notice', 'activity'];

function adminTab(shown) {
  if (!shown) { ADMIN.off?.(); ADMIN.off = null; clearInterval(ADMIN.timer); ADMIN.timer = null; return; }
  adminLoad();
  if (!ADMIN.off && typeof liveOn === 'function') {
    const again = liveDebounce(() => { if (pageShown('admin')) adminLoad(); }, 3000);
    const offs = ADMIN_LIVE.map(t => liveOn(t, again));
    ADMIN.off = () => offs.forEach(o => o());
  }
  if (!ADMIN.timer) ADMIN.timer = setInterval(() => { if (pageShown('admin') && !document.hidden) adminLoad(); }, 60e3);
}

async function adminLoad(fresh = false) {
  const page = document.getElementById('tab-admin');
  if (!page || ADMIN.loading) return;
  if (!ADMIN.data) page.innerHTML = '<div class="card"><div class="placeholder pulse">Loading…</div></div>';
  ADMIN.loading = true;
  try { ADMIN.data = await apiFetch(`/api/admin/overview${fresh ? '?fresh=1' : ''}`); }
  catch (e) { if (!ADMIN.data) page.innerHTML = `<div class="card"><div class="placeholder">${escHtml(e.message)}</div></div>`; return; }
  finally { ADMIN.loading = false; }
  adminDraw(page, ADMIN.data);
}

/** Where a line is handled: a page, or a Settings section. */
function adminGo(go) {
  if (!go) return;
  if (go.startsWith('settings/')) return settingsSubNav(go.slice(9));
  if (typeof soloOn === 'function' && soloOn()) return window.open(`/#${go}`, '_blank');   // shown alone: the whole panel, in a tab
  nav(go);
}

function _adminMeter(m) {
  const f = m.max ? m.used / m.max : 0;
  const w = m.used ? Math.max(4, Math.min(100, f * 100)) : 0;
  return `<span class="usage-meter um-limit adm-meter" role="meter" aria-valuemin="0" aria-valuemax="${m.max}" aria-valuenow="${m.used}">`
    + `<span class="um-bar"><span class="um-fill" style="--um-c:${usageHeat(f)};width:${w.toFixed(1)}%"></span></span></span>`;
}

function _adminLine(l) {
  const tag = l.go ? 'button' : 'div';
  return `<${tag} ${l.go ? `type="button" class="adm-row" onclick="adminGo(${jsArg(l.go)})" title="${escHtml(l.label)}: ${escHtml(l.value)}"` : 'class="adm-row"'}>
    <span class="pt ${ADMIN_PT[l.state] || 'adm-pt-info'}" aria-hidden="true"></span>
    <span class="adm-text"><span class="adm-label">${escHtml(l.label)}</span>${l.sub ? `<span class="adm-sub">${escHtml(l.sub)}</span>` : ''}</span>
    <span class="adm-value">${l.meter ? _adminMeter(l.meter) : ''}<span>${escHtml(l.value)}</span></span>
    ${l.go ? '<span class="adm-go" aria-hidden="true">›</span>' : ''}</${tag}>`;
}

function _adminCard(s) {
  const body = s.error ? `<div class="placeholder">${escHtml(s.error)}</div>`
    : s.id === 'needs' && !s.lines.length ? emptyStateHtml({ title: 'Nothing needs you', text: 'No device, proposal, question or failed work is waiting. This card fills when something does.' })
      : s.lines.map(_adminLine).join('');
  const n = s.id === 'needs' ? s.lines.length : 0;
  return `<section class="card adm-card adm-${s.id}" aria-label="${escHtml(s.title)}">
    <div class="card-title">${escHtml(s.title)}${n ? ` <span class="adm-count">${n}</span>` : ''}</div>${body}</section>`;
}

function adminDraw(page, d) {
  const at = new Date(d.at);
  const sub = `Is everything fine, and what needs you — ${d.mode === 'production' ? 'a production' : 'a development'} hive${d.hosted ? ', hosted' : ''}.`;
  const needs = d.sections.find(s => s.id === 'needs');
  page.innerHTML = pageHeadHtml({ title: 'Admin', sub,
    actions: `<span class="adm-at" title="${escHtml(at.toLocaleString())}">${escHtml(at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span>
      <button type="button" class="btn" onclick="adminLoad(true)">Refresh</button>` })
    + (needs ? _adminCard(needs) : '')
    + `<div class="adm-grid">${d.sections.filter(s => s.id !== 'needs').map(_adminCard).join('')}</div>`;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-admin' });
  page.style.overflow = 'auto';
  document.getElementById('tab-settings')?.before(page);
});
