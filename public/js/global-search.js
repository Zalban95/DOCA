/* ═══════════════════════════════════════════════════════
   HEADER SEARCH, in sections (asked 2026-10-12: "sections with dropdowns within the search dropdown to separate between
   settings, files, repos that open directly in the right place or ask you if multiple choices are available"):
     Pages      the panel's pages and Settings sections, matched here with no request — drawn at once
     Settings   GET /api/settings/find, the same rows the agent is told; one opens its page with the field marked
     Projects   the projects (repositories) by name or folder; one opens in Projects
     Files      the Files search, from where the Files tab is
   Each section folds (remembered per browser), shows its first few with "Show all", and a result opens where it lives
   — or, when it can open in more than one place (a file inside a project), asks which, right under it.
   ═══════════════════════════════════════════════════════ */

let _searchActiveIdx = -1;
let _searchPlaces = [];   // every result drawn, in order: {label, where, icon, title, go, choices}
const _SEARCH_SECTIONS = [['pages', 'Pages'], ['settings', 'Settings'], ['projects', 'Projects'], ['files', 'Files']];
const _SEARCH_FIRST = 6;
let _searchAll = new Set();       // sections shown whole this search
let _searchProjects = null;       // {at, list}: the projects, read once a minute

const _searchFolded = () => { try { return new Set(JSON.parse(localStorage.getItem('doca.search.folded') || '[]')); } catch { return new Set(); } };
function globalSearchFold(id, open) {
  const s = _searchFolded();
  if (open) s.delete(id); else s.add(id);
  try { localStorage.setItem('doca.search.folded', JSON.stringify([...s])); } catch { /* per browser only */ }
}

/** The panel's pages and Settings sections whose name (or `find` words) contains q. */
function globalSearchPlaces(q) {
  const t = q.toLowerCase();
  const pages = [...document.querySelectorAll('nav .nav-tab[data-tab]')]
    .map(b => ({ label: b.textContent.trim(), where: 'Page', icon: '▸', go: () => nav(b.dataset.tab) }));
  const sections = (typeof _SETTINGS_SUBTABS !== 'undefined' ? _SETTINGS_SUBTABS : [])
    .filter(s => !s.group || (typeof _harnessesInstalled !== 'undefined' && _harnessesInstalled[s.group]))
    .filter(s => typeof licencePageOn !== 'function' || licencePageOn(s.page || `settings/${s.id}`))   // not licensed here: not found (lib/licence.js)
    .map(s => ({ label: s.group ? `${(_HARNESS_GROUPS[s.group] || '')} · ${s.label}` : s.label, words: s.find, where: s.page ? 'Field' : s.group ? 'Settings → Harnesses' : 'Settings', icon: '⚙',
      go: () => (s.page ? nav(s.page) : (_settingsActiveSubtab = s.id, nav('settings'), settingsSubNav(s.id))) }));
  return [...pages, ...sections].filter(p => `${p.label} ${p.words || ''}`.toLowerCase().includes(t));
}

/** A path's folder, on either separator: Windows paths have no '/' to cut at. */
function globalSearchDir(p) {
  return p.substring(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))) || '/';
}

async function _searchProjectList() {
  if (_searchProjects && Date.now() - _searchProjects.at < 60000) return _searchProjects.list;
  let list = [];
  try { list = (await apiFetch('/api/projects')).projects || []; } catch { /* a person without projects */ }
  _searchProjects = { at: Date.now(), list };
  return list;
}

const _openProject = async (id, file) => { nav('projects'); if (typeof pjOpen === 'function') await pjOpen(id); if (file && typeof pjOpenFile === 'function') pjOpenFile(file); };
const _under = (path, root) => !!root && (path === root || path.startsWith(root.replace(/[\\/]+$/, '') + (root.includes('\\') ? '\\' : '/')));

/** Draw the sections from what is known so far; `waiting` names those still being looked for. */
function _searchDraw(groups, waiting) {
  const folded = _searchFolded();
  _searchPlaces = [];
  let html = '';
  for (const [id, label] of _SEARCH_SECTIONS) {
    const list = groups[id];
    if (!list) { if (waiting.includes(id)) html += `<div class="header-search-empty">Searching ${label.toLowerCase()}…</div>`; continue; }
    if (!list.length) continue;
    const shown = _searchAll.has(id) ? list : list.slice(0, _SEARCH_FIRST);
    const rows = shown.map(p => {
      const i = _searchPlaces.push(p) - 1;
      return `<div class="header-search-item" data-idx="${i}" onclick="globalSearchPlace(${i})" onmouseenter="globalSearchHover(${i})">
          <span class="header-search-item-icon">${p.icon}</span>
          <span class="header-search-item-name">${escHtml(p.label)}${p.choices?.length > 1 ? ' <span class="header-search-more">▾</span>' : ''}</span>
          <span class="header-search-item-path" title="${escHtml(p.title || p.where)}">${escHtml(p.where)}</span></div>`;
    }).join('');
    const more = list.length > shown.length ? `<button type="button" class="header-search-all" onclick="event.stopPropagation(); globalSearchShowAll('${id}')">Show all ${list.length}</button>` : '';
    html += `<details class="header-search-section" data-sec="${id}"${folded.has(id) ? '' : ' open'} ontoggle="globalSearchFold('${id}', this.open)">
        <summary>${label} <span class="header-search-count">${list.length}</span></summary>${rows}${more}</details>`;
  }
  return html;
}

let _searchGroups = {}, _searchWaiting = [];
function _searchPaint() {
  const results = document.getElementById('global-search-results');
  results.innerHTML = _searchDraw(_searchGroups, _searchWaiting) || (_searchWaiting.length ? '' : '<div class="header-search-empty">No results found</div>');
  _searchActiveIdx = -1;
}
function globalSearchShowAll(id) { _searchAll.add(id); _searchPaint(); }

/** One place: open it, or — when it opens in more than one — ask which, under it. */
function globalSearchPlace(i) {
  const p = _searchPlaces[i];
  if (!p) return;
  if (p.choices?.length > 1) {
    const row = document.querySelector(`.header-search-item[data-idx="${i}"]`);
    if (!row || row.nextElementSibling?.classList.contains('header-search-choices')) return;
    const box = Object.assign(document.createElement('div'), { className: 'header-search-choices' });
    box.innerHTML = `<span class="desc">Open it in:</span>${p.choices.map((c, k) => `<button type="button" class="btn btn-xs" data-k="${k}">${escHtml(c.label)}</button>`).join('')}`;
    box.addEventListener('click', e => { const k = e.target.closest('[data-k]')?.dataset.k; if (k == null) return; e.stopPropagation(); _searchClose(); p.choices[k].go(); });
    row.after(box);
    return;
  }
  _searchClose();
  (p.choices?.[0]?.go || p.go)();
}

function _searchClose() {
  document.getElementById('global-search-results').classList.remove('open');
  document.getElementById('global-search').value = '';
}

const globalSearchDebounced = debounce(async () => {
  const input = document.getElementById('global-search'), results = document.getElementById('global-search-results');
  const q = input.value.trim();
  if (q.length < 2) { results.classList.remove('open'); results.innerHTML = ''; return; }
  const stale = () => input.value.trim() !== q;   // typed on meanwhile: the newer search draws
  _searchAll = new Set();
  _searchGroups = { pages: globalSearchPlaces(q) };
  _searchWaiting = ['settings', 'projects', 'files'];
  _searchPaint();
  results.classList.add('open');
  const arrived = (id, list) => { if (stale()) return; _searchGroups[id] = list; _searchWaiting = _searchWaiting.filter(x => x !== id); _searchPaint(); };

  // Settings by the words people use — "theme", "approval", "voice" (deep test A: 15 of 22 newcomer words found nothing).
  const settings = apiFetch(`/api/settings/find?q=${encodeURIComponent(q)}`, { noAsk: true }).then(d => (d.results || []).map(r => ({
    label: r.label, where: r.where || 'Setting', icon: '✎', setting: true, title: [r.where, r.control].filter(Boolean).join(' → '), go: () => settingJump(r) })))
    .catch(() => []).then(list => arrived('settings', list));

  const projects = _searchProjectList().then(all => {
    const t = q.toLowerCase();
    arrived('projects', all.filter(p => !p.archivedAt && `${p.name} ${p.root}`.toLowerCase().includes(t))
      .map(p => ({ label: p.name, where: p.root, icon: '◧', go: () => _openProject(p.id) })));
    return all;
  });

  // Where the Files tab is, else nothing: the server then searches home. '/' is refused on Windows. A file inside a
  // project opens in either place: asked under it.
  const root = (typeof fm !== 'undefined' && fm.cwd) || '';
  const files = apiFetch(`${fmApi()}/search?root=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}`, { noAsk: true }).then(d => d.results || []).catch(() => null);
  const [items, all] = await Promise.all([files, projects, settings]).then(([f, p]) => [f, p]);
  if (items === null) { if (!stale()) { _searchGroups.files = []; _searchWaiting = []; _searchPaint(); results.insertAdjacentHTML('beforeend', '<div class="header-search-empty">File search unavailable</div>'); } return; }
  arrived('files', items.map(item => {
    const inFiles = { label: 'Files', go: () => globalSearchGo(item.path, item.isDir) };
    const proj = item.isDir ? null : all.find(p => !p.archivedAt && _under(item.path, p.root));
    return { label: item.name, where: globalSearchDir(item.path), title: item.path, icon: item.isDir ? '📁' : fmFileIcon(item.name),
      choices: proj ? [inFiles, { label: `the project ${proj.name}`, go: () => _openProject(proj.id, item.path) }] : [inFiles] };
  }));
}, 300);

function globalSearchShow() {
  const results = document.getElementById('global-search-results');
  if (results && results.innerHTML && document.getElementById('global-search').value.trim().length >= 2) results.classList.add('open');
}

/** The results a person can reach now: not inside a folded section. */
const _searchVisible = () => [...document.querySelectorAll('#global-search-results .header-search-item')].filter(el => el.offsetParent !== null);

function globalSearchKey(event) {
  const results = document.getElementById('global-search-results');
  const items = _searchVisible();
  if (event.key === 'Escape') { results.classList.remove('open'); document.getElementById('global-search').blur(); return; }
  if (!items.length) return;
  if (event.key === 'ArrowDown') { event.preventDefault(); _searchActiveIdx = Math.min(_searchActiveIdx + 1, items.length - 1); globalSearchHighlight(items); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); _searchActiveIdx = Math.max(_searchActiveIdx - 1, 0); globalSearchHighlight(items); }
  else if (event.key === 'Enter') { event.preventDefault(); if (_searchActiveIdx >= 0 && items[_searchActiveIdx]) items[_searchActiveIdx].click(); }
}

function globalSearchHighlight(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === _searchActiveIdx));
  if (items[_searchActiveIdx]) items[_searchActiveIdx].scrollIntoView({ block: 'nearest' });
}

function globalSearchHover(idx) {
  const items = _searchVisible();
  _searchActiveIdx = items.findIndex(el => Number(el.dataset.idx) === idx);
  globalSearchHighlight(items);
}

function globalSearchGo(filePath, isDir) {
  _searchClose();
  fmShow(filePath, isDir);   // its own folder, the file selected (files.js)
}

document.addEventListener('click', (e) => {
  const search = document.getElementById('header-search');
  if (search && !search.contains(e.target)) document.getElementById('global-search-results').classList.remove('open');
});
