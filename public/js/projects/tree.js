/* ═══════════════════════════════════════════════════════
   Projects → Files: the project's tree, from the Files tab's own routes
   (/api/files/list), folders first, opened a level at a time. A file opens in
   the editor; right-click (or long-press) offers compare and history.
   ═══════════════════════════════════════════════════════ */

const PJT = { open: new Set(), selected: null, compareFrom: null };
const PJT_DIM = new Set(['.git', 'node_modules', 'build', 'dist', '.gradle', 'target', '.idea', '.dart_tool', '__pycache__', '.next', 'out', '.venv']);

function pjTreeRender(body) {
  body.innerHTML = `<div class="pj-tree-tools">
      <button class="btn btn-xs" onclick="pjTreeRefresh()" title="Refresh">↺</button>
      <button class="btn btn-xs" onclick="pjTreeCollapse()" title="Collapse all">⊟</button>
      <button class="btn btn-xs" onclick="pjNewFile()" title="New file">+ File</button>
    </div><div class="pj-tree" id="pj-tree"></div>`;
  const tree = document.getElementById('pj-tree');
  _pjTreeLevel(tree, PJ.project.project.root, 0);
}

function pjTreeRefresh() { pjView('files'); }
function pjTreeCollapse() { PJT.open.clear(); pjView('files'); }

async function _pjTreeLevel(container, dir, depth) {
  let entries = [];
  try { entries = (await apiFetch(`/api/files/list?path=${encodeURIComponent(dir)}`)).entries || []; }
  catch (e) { container.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  entries.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  container.innerHTML = '';
  for (const e of entries) {
    const abs = `${dir}/${e.name}`;
    const row = document.createElement('div');
    row.className = `pj-node${e.isDir ? ' dir' : ''}${PJT_DIM.has(e.name) ? ' dim' : ''}${PJT.selected === abs ? ' selected' : ''}`;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.title = abs;
    row.textContent = `${e.isDir ? (PJT.open.has(abs) ? '▾ ' : '▸ ') : '  '}${e.name}`;
    const kids = document.createElement('div');
    row.onclick = () => {
      PJT.selected = abs;
      document.querySelectorAll('#pj-tree .pj-node.selected').forEach(n => n.classList.remove('selected'));
      row.classList.add('selected');
      if (!e.isDir) return pjOpenFile(abs);
      if (PJT.open.has(abs)) { PJT.open.delete(abs); kids.innerHTML = ''; row.textContent = `▸ ${e.name}`; }
      else { PJT.open.add(abs); row.textContent = `▾ ${e.name}`; _pjTreeLevel(kids, abs, depth + 1); }
    };
    if (!e.isDir) row.oncontextmenu = ev => { ev.preventDefault(); _pjFileMenu(abs); };
    container.append(row, kids);
    if (e.isDir && PJT.open.has(abs)) _pjTreeLevel(kids, abs, depth + 1);
  }
  if (!entries.length) container.innerHTML = `<div class="pj-node dim" style="padding-left:${8 + depth * 14}px">(empty)</div>`;
}

/** What a file offers besides opening: comparisons and its history. */
function _pjFileMenu(abs) {
  const rel = pjRel(abs);
  const choices = [
    PJ.project.git ? { label: 'Compare with last commit', value: 'head' } : null,
    PJ.project.git ? { label: 'History', value: 'history' } : null,
    PJT.compareFrom && PJT.compareFrom !== abs ? { label: `Compare with ${pjRel(PJT.compareFrom)}`, value: 'with' } : null,
    { label: 'Select for compare', value: 'select' },
  ].filter(Boolean);
  appChoose(rel, [{ label: 'Cancel', value: null }, ...choices], v => {
    if (v === 'head') pjCompareHead(abs);
    if (v === 'history') pjFileHistory(abs);
    if (v === 'select') { PJT.compareFrom = abs; setStatus(document.getElementById('pj-status'), `Selected ${rel} — right-click another file to compare`, 'info'); }
    if (v === 'with') pjCompare({ title: `${pjRel(PJT.compareFrom)} ↔ ${rel}`, originalPath: PJT.compareFrom, modifiedPath: abs });
  });
}

function pjNewFile() {
  const base = PJT.selected && !/\.[^/]+$/.test(PJT.selected) ? pjRel(PJT.selected) + '/' : '';
  appPrompt('New file (relative to the project):', async rel => {
    const abs = pjAbs(rel);
    try {
      await apiFetch('/api/files/write', { method: 'POST', body: { path: abs, content: '' } });
      pjView('files');
      pjOpenFile(abs);
    } catch (e) { appAlert(e.message); }
  }, base);
}
