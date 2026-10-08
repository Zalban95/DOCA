/* ═══════════════════════════════════════════════════════
   Hub → Files: the shortcuts down the side (from /api/paths).

   On a fresh install most of them answered 404 — ".openclaw", Workspace, Skills, Docker dir, Snapshots — and "Root fs"
   403, with nothing on the page (self-test round two, C10). Now a shortcut is shown only where it leads somewhere:
   another product's folders (.openclaw, OpenClaw's Docker folder) only when they exist, the root only when the files
   tab may read it, and DOCA's own folders (Workspace, Skills, Snapshots) greyed with "create it" until they exist —
   made through Settings → System → Paths' own route.
   ═══════════════════════════════════════════════════════ */

let FM_BOOKMARKS = [];

/** The shortcuts this hub has: `paths` is GET /api/paths (its `shortcuts` say which exist). */
function fmBookmarksFrom(paths) {
  const h = paths.home || '/', here = paths.shortcuts || {};
  const known = k => here[k] !== false;   // an older hub says nothing: shown as before
  return [
    { id: 'home', icon: '⌂', label: 'Home', path: h },
    known('openclawDir') && { id: 'openclaw', icon: '⚙', label: '.openclaw', path: (paths.configPath || `${h}/.openclaw/x`).replace(/[\\/][^\\/]*$/, '') },
    { id: 'workspace', icon: '📁', label: 'Workspace', path: paths.workspaceDir, key: 'WORKSPACE_DIR', missing: !known('workspaceDir') },
    { id: 'skills', icon: '🔌', label: 'Skills', path: paths.skillsDir, key: 'SKILLS_DIR', missing: !known('skillsDir') },
    known('composeDir') && { id: 'compose', icon: '🐳', label: 'Docker dir', path: paths.composeDir },
    { id: 'snapshots', icon: '📷', label: 'Snapshots', path: paths.snapshotDir, key: 'SNAPSHOT_DIR', missing: !known('snapshotDir') },
    known('root') && { id: 'root', icon: '/', label: 'Root fs', path: '/' },
  ].filter(b => b && b.path);
}

function fmBuildBookmarks() {
  const ul = document.getElementById('fm-bookmarks-list');
  ul.innerHTML = '';
  FM_BOOKMARKS.forEach(b => {
    const btn     = document.createElement('button');
    btn.className = `fm-bookmark${b.missing ? ' fm-bookmark-missing' : ''}`;
    btn.id        = `fmbk-${b.id}`;
    btn.title     = b.missing ? `${b.path} — not made yet: click to create it` : b.path;
    btn.innerHTML = `<span class="fm-bookmark-icon">${b.icon}</span>
                     <span class="fm-bookmark-name">${escHtml(b.label)}${b.missing ? ' <span class="fm-bookmark-make">＋ create</span>' : ''}</span>`;
    btn.onclick   = () => (b.missing ? fmBookmarkCreate(b) : (fmNavigate(b.path), fmTreeMount(b.path)));
    ul.appendChild(btn);
  });
}

/** A DOCA folder not made yet: made on a click (POST /api/paths/create, as Settings → System → Paths does), then opened. */
function fmBookmarkCreate(b) {
  appConfirm(`${b.label} does not exist yet. Create ${b.path}?`, async () => {
    try {
      await apiFetch('/api/paths/create', { method: 'POST', body: { key: b.key } });
      b.missing = false;
      fmBuildBookmarks();
      fmNavigate(b.path); fmTreeMount(b.path);
    } catch (e) {
      const list = document.getElementById('fm-list-inner');
      if (list) list.innerHTML = `<div class="placeholder" style="padding:16px;color:var(--red)">Could not create ${escHtml(b.path)}: ${escHtml(e.message)}</div>`;
    }
  });
}
