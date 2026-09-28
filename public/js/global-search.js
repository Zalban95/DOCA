/* ═══════════════════════════════════════════════════════
   GLOBAL FILE SEARCH (header bar)
   ═══════════════════════════════════════════════════════ */

let _searchActiveIdx = -1;

const globalSearchDebounced = debounce(async () => {
  const input   = document.getElementById('global-search');
  const results = document.getElementById('global-search-results');
  const q = input.value.trim();

  if (q.length < 2) {
    results.classList.remove('open');
    results.innerHTML = '';
    return;
  }

  const root = (typeof fm !== 'undefined' && fm.cwd) ? fm.cwd : '/';
  try {
    const data = await apiFetch(`${fmApi()}/search?root=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}`);
    const items = data.results || [];
    _searchActiveIdx = -1;

    if (!items.length) {
      results.innerHTML = '<div class="header-search-empty">No results found</div>';
      results.classList.add('open');
      return;
    }

    results.innerHTML = items.map((item, i) => {
      const icon = item.isDir ? '📁' : fmFileIcon(item.name);
      const dir  = item.path.substring(0, item.path.lastIndexOf('/')) || '/';
      return `<div class="header-search-item" data-idx="${i}"
                   onclick="globalSearchGo(${jsArg(item.path)}, ${item.isDir})"
                   onmouseenter="globalSearchHover(${i})">
        <span class="header-search-item-icon">${icon}</span>
        <span class="header-search-item-name">${escHtml(item.name)}</span>
        <span class="header-search-item-path" title="${escHtml(item.path)}">${escHtml(dir)}</span>
      </div>`;
    }).join('');
    results.classList.add('open');
  } catch {
    results.innerHTML = '<div class="header-search-empty">Search error</div>';
    results.classList.add('open');
  }
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
    const dir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    fmNavigate(dir);
  }
}

document.addEventListener('click', (e) => {
  const search = document.getElementById('header-search');
  if (search && !search.contains(e.target)) {
    document.getElementById('global-search-results').classList.remove('open');
  }
});
