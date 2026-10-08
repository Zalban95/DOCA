/* ═══════════════════════════════════════════════════════
   HEADER SEARCH: pages and Settings sections first, then settings,
   then files. It sits on every page, so it finds places as well as
   files; places are matched here, with no request, and come first.
   Settings come from the hub (GET /api/settings/find, the same rows
   the agent is told), and one opens its page with the field marked.
   ═══════════════════════════════════════════════════════ */

let _searchActiveIdx = -1;
let _searchPlaces = [];

/** The panel's pages and Settings sections whose name (or `find` words) contains q. */
function globalSearchPlaces(q) {
  const t = q.toLowerCase();
  const pages = [...document.querySelectorAll('nav .nav-tab[data-tab]')]
    .map(b => ({ label: b.textContent.trim(), where: 'Page', go: () => nav(b.dataset.tab) }));
  const sections = (typeof _SETTINGS_SUBTABS !== 'undefined' ? _SETTINGS_SUBTABS : [])
    .filter(s => !s.group || (typeof _harnessesInstalled !== 'undefined' && _harnessesInstalled[s.group]))
    .map(s => ({ label: s.group ? `${(_HARNESS_GROUPS[s.group] || '')} · ${s.label}` : s.label, words: s.find, where: s.page ? 'Field' : s.group ? 'Settings → Harnesses' : 'Settings',
      go: () => (s.page ? nav(s.page) : (_settingsActiveSubtab = s.id, nav('settings'), settingsSubNav(s.id))) }));
  return [...pages, ...sections].filter(p => `${p.label} ${p.words || ''}`.toLowerCase().includes(t));
}

/** A path's folder, on either separator: Windows paths have no '/' to cut at. */
function globalSearchDir(p) {
  return p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))) || '/';
}

function globalSearchPlace(i) {
  document.getElementById('global-search-results').classList.remove('open');
  document.getElementById('global-search').value = '';
  _searchPlaces[i]?.go();
}

const globalSearchDebounced = debounce(async () => {
  const input   = document.getElementById('global-search');
  const results = document.getElementById('global-search-results');
  const q = input.value.trim();

  if (q.length < 2) {
    results.classList.remove('open');
    results.innerHTML = '';
    return;
  }

  _searchPlaces = globalSearchPlaces(q);
  const item = (p, i) => `<div class="header-search-item" data-idx="${i}"
                   onclick="globalSearchPlace(${i})" onmouseenter="globalSearchHover(${i})">
        <span class="header-search-item-icon">${p.where === 'Page' ? '▸' : p.setting ? '✎' : '⚙'}</span>
        <span class="header-search-item-name">${escHtml(p.label)}</span>
        <span class="header-search-item-path" title="${escHtml(p.title || p.where)}">${escHtml(p.where)}</span>
      </div>`;
  let places = _searchPlaces.map(item).join('');
  // Places at once; a search of home can take seconds, and they need no request.
  _searchActiveIdx = -1;
  results.innerHTML = places + '<div class="header-search-empty">Searching settings and files…</div>';
  results.classList.add('open');

  // Settings by the words people use — "theme", "approval", "voice" (deep test A: 15 of 22 newcomer words found nothing).
  try {
    const found = (await apiFetch(`/api/settings/find?q=${encodeURIComponent(q)}`)).results || [];
    if (input.value.trim() !== q) return;
    const settings = found.map(r => ({ label: r.label, where: r.where || 'Setting', title: [r.where, r.control].filter(Boolean).join(' → '),
      setting: true, go: () => settingJump(r) }));
    _searchPlaces = [..._searchPlaces, ...settings];
    places = _searchPlaces.map(item).join('');
    results.innerHTML = places + '<div class="header-search-empty">Searching files…</div>';
  } catch { /* an older hub: pages and files still answer */ }

  // Where the Files tab is, else nothing: the server then searches home. '/' is refused on Windows.
  const root = (typeof fm !== 'undefined' && fm.cwd) || '';
  let files;
  try {
    const items = (await apiFetch(`${fmApi()}/search?root=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}`)).results || [];
    files = items.map((item, j) => {
      const i = _searchPlaces.length + j;
      const icon = item.isDir ? '📁' : fmFileIcon(item.name);
      const dir  = globalSearchDir(item.path);
      return `<div class="header-search-item" data-idx="${i}"
                   onclick="globalSearchGo(${jsArg(item.path)}, ${item.isDir})"
                   onmouseenter="globalSearchHover(${i})">
        <span class="header-search-item-icon">${icon}</span>
        <span class="header-search-item-name">${escHtml(item.name)}</span>
        <span class="header-search-item-path" title="${escHtml(item.path)}">${escHtml(dir)}</span>
      </div>`;
    }).join('');
  } catch {
    // A file search refused or failed still leaves the places worth showing.
    files = '<div class="header-search-empty">File search unavailable</div>';
  }
  if (input.value.trim() !== q) return;   // typed on meanwhile; the newer search draws
  results.innerHTML = places + files || '<div class="header-search-empty">No results found</div>';
}, 300);

function globalSearchShow() {
  const results = document.getElementById('global-search-results');
  if (results && results.innerHTML && document.getElementById('global-search').value.trim().length >= 2) {
    results.classList.add('open');
  }
}

function globalSearchKey(event) {
  const results = document.getElementById('global-search-results');
  const items   = results.querySelectorAll('.header-search-item');
  if (!items.length) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    _searchActiveIdx = Math.min(_searchActiveIdx + 1, items.length - 1);
    globalSearchHighlight(items);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    _searchActiveIdx = Math.max(_searchActiveIdx - 1, 0);
    globalSearchHighlight(items);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (_searchActiveIdx >= 0 && items[_searchActiveIdx]) {
      items[_searchActiveIdx].click();
    }
  } else if (event.key === 'Escape') {
    results.classList.remove('open');
    document.getElementById('global-search').blur();
  }
}

function globalSearchHighlight(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === _searchActiveIdx));
  if (items[_searchActiveIdx]) {
    items[_searchActiveIdx].scrollIntoView({ block: 'nearest' });
  }
}

function globalSearchHover(idx) {
  _searchActiveIdx = idx;
  const items = document.querySelectorAll('.header-search-item');
  globalSearchHighlight(items);
}

function globalSearchGo(filePath, isDir) {
  const results = document.getElementById('global-search-results');
  results.classList.remove('open');
  document.getElementById('global-search').value = '';

  nav('files');

  if (isDir) {
    fmNavigate(filePath);
  } else {
    const dir = globalSearchDir(filePath);
    fmNavigate(dir);
  }
}

document.addEventListener('click', (e) => {
  const search = document.getElementById('header-search');
  if (search && !search.contains(e.target)) {
    document.getElementById('global-search-results').classList.remove('open');
  }
});

/**
 * Open a setting where it is edited and mark it: its page (or Settings section), a panel action first when the form is
 * closed (the ⚙ on Controls), then the field or card — every Advanced fold around it opened, scrolled into view and
 * outlined for a moment. Pages draw themselves after nav(), so the element is waited for, briefly.
 */
async function settingJump(r) {
  const [top, sub] = String(r.page || '').split('/');
  if (top === 'settings' && sub) { if (typeof _settingsActiveSubtab !== 'undefined') _settingsActiveSubtab = sub; nav('settings'); settingsSubNav(sub); }
  else if (top) nav(top);
  if (r.open === 'harnessParams' && typeof settingsOpenHarnessParams === 'function') { try { await settingsOpenHarnessParams(); } catch { /* the page still opened */ } }
  // On the page in view: drawn, or folded inside an Advanced fold that is itself drawn (its summary shows).
  const shown = el => {
    if (!el) return false;
    if (el.getClientRects().length) return true;
    let outer = null;
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) outer = d;
    return !!outer && outer.getClientRects().length > 0;
  };
  const byCard = () => r.card && [...document.querySelectorAll('.card-title')]
    .find(t => t.textContent.trim().toLowerCase().startsWith(r.card.toLowerCase()) && shown(t))?.closest('.card');
  let el = null;
  for (let i = 0; i < 40 && !el; i++) {
    let f = null; try { f = r.field ? document.querySelector(r.field) : null; } catch { /* not a selector */ }
    el = (shown(f) && f) || byCard() || null;
    if (!el) await new Promise(res => setTimeout(res, 100));
  }
  if (!el) return;
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('setting-found');
  void el.offsetWidth;   // restart the mark when the same setting is opened twice
  el.classList.add('setting-found');
  setTimeout(() => el.classList.remove('setting-found'), 2600);
}
