/* ═══════════════════════════════════════════════════════
   HEADER SEARCH: pages and Settings sections first, then files.
   It sits on every page, so it finds places as well as files;
   places are matched here, with no request, and come first.
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
    .map(s => ({ label: s.group ? `${(_HARNESS_GROUPS[s.group] || '')} · ${s.label}` : s.label, words: s.find, where: s.group ? 'Settings → Harnesses' : 'Settings',
      go: () => { _settingsActiveSubtab = s.id; nav('settings'); settingsSubNav(s.id); } }));
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
  const places = _searchPlaces.map((p, i) => `<div class="header-search-item" data-idx="${i}"
                   onclick="globalSearchPlace(${i})" onmouseenter="globalSearchHover(${i})">
        <span class="header-search-item-icon">${p.where === 'Page' ? '▸' : '⚙'}</span>
        <span class="header-search-item-name">${escHtml(p.label)}</span>
        <span class="header-search-item-path">${p.where}</span>
      </div>`).join('');
  // Places at once; a search of home can take seconds, and they need no request.
  _searchActiveIdx = -1;
  results.innerHTML = places + '<div class="header-search-empty">Searching files…</div>';
  results.classList.add('open');

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
