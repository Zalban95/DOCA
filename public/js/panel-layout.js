/* ═══════════════════════════════════════════════════════
   The panel's structure as data (modules/panel-layout; TODO P1.2). A person's
   change to the panel — groups in another order, a page hidden or renamed, a
   page of their own made of the panel's pages, bigger text, other colours —
   is their data, layered install → person → screen, and this draws it. The
   hub resolves the layers (`resolved`): every page placed exactly once, so
   nothing a person had or an update added can go missing. Until it answers,
   the panel is today's exactly (nav-groups.js), and a screen that cannot
   reach it stays so.
   ═══════════════════════════════════════════════════════ */

let _panelLayout = null;   // {groups, labels, hidden, views, style} from GET /api/screen/layout

/** Fetch this screen's layout and draw it: the nav, the person's own pages, the style. */
async function panelLayoutLoad() {
  try { _panelLayout = (await apiFetch(`/api/screen/layout${typeof _screenQ === 'function' ? _screenQ() : ''}`)).resolved || null; }
  catch { _panelLayout = null; }
  if (_panelLayout) panelLayoutApply(_panelLayout);
  return _panelLayout;
}

/** The pages the layout leaves out of the nav, beside Settings → General's hidden tabs (settings.js). */
function panelLayoutHidden() { return _panelLayout?.hidden || []; }

function panelLayoutApply(r) {
  if (!Array.isArray(r?.groups) || !r.groups.length) return;
  const gone = NAV_TABS.filter(t => t.startsWith('view-') && !r.views.some(v => v.id === t));
  for (const t of gone) { NAV_TABS.splice(NAV_TABS.indexOf(t), 1); document.getElementById(`tab-${t}`)?.remove(); }
  for (const v of r.views) if (!NAV_TABS.includes(v.id)) NAV_TABS.push(v.id);
  NAV_GROUPS.splice(0, NAV_GROUPS.length, ...r.groups.map(g => ({ id: g.id, label: g.label, icon: g.icon, tabs: [...g.tabs] })));
  Object.assign(NAV_LABELS, r.labels);
  navGroupsRender();
  _panelLayoutStyle(r.style || {});
  for (const v of r.views) _panelViewPage(v);   // after the nav, so an open view redrawn finds its group
  if (gone.includes(currentTab)) nav('controls');
}

/** Style: theme tokens over the theme's, a text scale for the pages, and how close together things sit. */
function _panelLayoutStyle(s) {
  let el = document.getElementById('panel-layout-style');
  if (!el) { el = Object.assign(document.createElement('style'), { id: 'panel-layout-style' }); document.head.append(el); }
  const vars = Object.entries(s.vars || {}).map(([k, v]) => `${k}:${v} !important;`).join('');   // checked by the hub: tokens and plain values only
  const pad = { compact: ['8px', '8px 12px', '8px'], roomy: ['24px', '20px 24px', '18px'] }[s.density];
  el.textContent = (vars ? `:root{${vars}}` : '')
    + (s.fontScale && s.fontScale !== 1 ? `.content .tab-page{zoom:${s.fontScale}}.content .panel-view .tab-page{zoom:1}` : '')
    + (pad ? `.tab-page{padding:${pad[0]};gap:${pad[2]}}.card{padding:${pad[1]}}` : '');
  document.body.dataset.density = s.density || '';
}

/* ── A page of the person's own ─────────────────────────── */

function _panelViewPage(v) {
  let el = document.getElementById(`tab-${v.id}`);
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: `tab-${v.id}`, className: 'tab-page panel-view' });
    document.getElementById('tab-settings')?.before(el);
  }
  const spec = JSON.stringify(v);
  if (el.dataset.spec === spec) return;
  el.dataset.spec = spec;
  if (currentTab === v.id) nav(v.id);   // the open view changed: draw it again
}

const _panelViewOf = name => (String(name).startsWith('view-') ? (_panelLayout?.views || []).find(v => v.id === name) : null);

/** nav(): the pages shown for `name` — a view's parts, else the page itself. */
function panelViewParts(name) {
  const v = _panelViewOf(name);
  return v ? v.parts.map(p => p.page) : [name];
}

/** nav(), after each page's init: a view's pages go into its cells; any other page sends them home. */
function panelViewPlace(name) {
  const v = _panelViewOf(name), home = document.getElementById('tab-settings');
  document.querySelectorAll('.panel-view-cell > .tab-page').forEach(p => {
    if (!v || !v.parts.some(x => `tab-${x.page}` === p.id)) home?.before(p);
  });
  if (!v) return;
  const el = document.getElementById(`tab-${v.id}`);
  if (!el) return;
  if (el.dataset.drawn !== el.dataset.spec) {
    el.querySelectorAll('.panel-view-cell > .tab-page').forEach(p => home?.before(p));   // never drawn over
    el.style.setProperty('--panel-view-cols', v.columns);
    el.innerHTML = `<div class="panel-view-head"><span>${escHtml(v.label)}</span>
      <button class="btn btn-xs" onclick="nav('settings');settingsSubNav('general')" title="Your panel: change or undo">✎</button></div>
      <div class="panel-view-grid">${v.parts.map(p => `<div class="panel-view-cell" data-part="${p.page}"></div>`).join('')}</div>`;
    el.dataset.drawn = el.dataset.spec;
  }
  for (const p of v.parts) {
    const cell = el.querySelector(`.panel-view-cell[data-part="${p.page}"]`), page = document.getElementById(`tab-${p.page}`);
    if (cell && page && page.parentElement !== cell) cell.append(page);
  }
}

/* ── Kept in step ───────────────────────────────────────── */

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('load', () => {
  // A change made anywhere — the agent, another screen of theirs, Undo — is drawn here at once.
  if (typeof liveOn === 'function') liveOn('screen', c => {
    if (c.what === 'layout') panelLayoutLoad().then(() => { if (typeof settingsHiddenApply === 'function') settingsHiddenApply(); });
    // A proposal accepted for this screen (harness/screen-proposals.js) — its colours among them: drawn at once.
    if (c.what === 'settings' && typeof screenLoad === 'function') screenLoad(true).then(() => { if (typeof themeApplyOnLoad === 'function') themeApplyOnLoad(); });
  });
});
