/* ═══════════════════════════════════════════════════════
   DOCA PANEL — SETTINGS → SYSTEM → PATHS

   Where the dashboard looks for the stack, its config and the
   workspace. Saved overrides live in prefs and beat the environment;
   an empty field hands the path back to the env var or the default.
   ═══════════════════════════════════════════════════════ */

const PATH_KIND_LABEL = { dir: 'directory', json: 'JSON file', script: 'script' };

async function pathsLoad() {
  const list = document.getElementById('paths-list');
  if (!list) return;
  try {
    const data = await apiFetch('/api/paths');
    _pathsRender(data.settable || []);
    _pathsWorkspaceOffer();
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

/** The paths a newcomer may want to point somewhere else; the stack's, OpenClaw's and the scripts' are under Advanced. */
const PATHS_COMMON = ['WORKSPACE_DIR', 'ATTACHMENTS_DIR'];

function _pathsRender(rows) {
  const list = document.getElementById('paths-list');
  if (!list) return;
  const rest = rows.filter(p => !PATHS_COMMON.includes(p.key));
  list.innerHTML = rows.filter(p => PATHS_COMMON.includes(p.key)).map(_pathRowHtml).join('')
    + (rest.length ? advancedFold(rest.map(_pathRowHtml).join(''), { id: 'paths', label: 'Advanced — the stack, OpenClaw, scripts, the rest',
      changed: rest.filter(p => p.source === 'saved').length }) : '');
}

function _pathRowHtml(p) {
  const id = `path-in-${p.key}`;
  const browse = p.kind === 'dir' ? 'dir' : 'file';

  // Where the value in the box comes from, so a field that looks editable but is
  // really coming from systemd or Docker does not look like the user's own choice.
  const origin = p.source === 'saved' ? 'set here'
    : p.source === 'env' ? (p.overridden ? `overridden by ENV (${p.key}) — the environment wins over what is saved here` : `from ${p.key}`)
    : 'default';

  const state = p.exists === null
    ? `<span class="path-note">${p.value ? '' : 'not set (optional)'}</span>`
    : p.exists
    ? '<span class="path-ok">● exists</span>'
    : '<span class="path-missing">✗ missing</span>';

  // Saved, but this process is still running on the old value. The same two
  // words as the status line below says out loud: it is this panel that has to
  // come back, not the external stack.
  const pending = p.pending
    ? ` · <span class="path-missing">restart DOCA to apply</span> (using <code>${escHtml(p.active)}</code>)`
    : '';

  const create = p.exists !== false || !['dir', 'json', 'script'].includes(p.kind) ? '' : `
    <button class="btn btn-xs btn-teal" onclick="pathsCreate(${jsArg(p.key)})"
            title="Create this ${PATH_KIND_LABEL[p.kind] || 'path'}">+ Create</button>`;

  return `
    <div class="path-row">
      <div class="path-label">${escHtml(p.label)}<small>${escHtml(p.note || '')}</small></div>
      <div>
        <div class="path-fields">
          <input id="${id}" class="input flex1" data-key="${escHtml(p.key)}" data-default="" data-label="${escHtml(p.label)}"
                 value="${p.source === 'saved' ? escHtml(p.value) : ''}"
                 placeholder="${escHtml(p.value)}">
          ${p.kind === 'url' ? '' : `<button class="btn btn-xs" title="Browse" onclick="fpOpen('${id}','${browse}')">📁</button>`}
          ${create}
        </div>
        <div class="path-meta">${state} · ${escHtml(origin)} · <code>${escHtml(p.value)}</code>${pending}</div>
      </div>
    </div>`;
}

async function pathsSave() {
  const st = document.getElementById('paths-status');
  const body = {};
  document.querySelectorAll('#paths-list input[data-key]').forEach(el => {
    body[el.dataset.key] = el.value.trim();
  });

  try {
    const data = await apiFetch('/api/paths', { method: 'POST', body });
    _pathsRender(data.settable || []);
    // "restart DOCA" — this process, which reads the saved paths at boot, and
    // the words each pending row is already marked with. The external OpenClaw
    // stack has its own phrase ("restart OpenClaw", keys.js) and the two are not
    // interchangeable: one brings this panel back, one brings the stack back.
    setStatus(st, '✓ Saved — restart DOCA to apply', 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function pathsCreate(key) {
  const st = document.getElementById('paths-status');
  try {
    const data = await apiFetch('/api/paths/create', { method: 'POST', body: { key } });
    _pathsRender(data.settable || []);
    setStatus(st, data.created ? `✓ Created ${data.path}` : `Already there: ${data.path}`, 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/* Still working in OpenClaw's folder (an install from before DOCA had its own workspace): offer the move, once. */
async function _pathsWorkspaceOffer() {
  const list = document.getElementById('paths-list');
  let st; try { st = await apiFetch('/api/paths/workspace'); } catch { return; }
  if (!list || !st.legacy) return;
  const box = document.createElement('div');
  box.className = 'card mt8';
  box.innerHTML = `<div class="card-title">Your workspace is still in OpenClaw's folder</div>
    <div class="desc">${escHtml(st.from)} — from when this panel was OpenClaw's. ${st.canMove
      ? `Move your attachments and specialists into ${escHtml(st.to)}, the workspace of its own. Their old places keep a link, so nothing that names them breaks; the rest of OpenClaw's folder stays as it is. Used from the next restart.`
      : st.pinned.length ? 'Some of these paths were set by hand: change them above instead.' : `${escHtml(st.to)} exists already: move what you want there by hand.`}</div>
    ${st.canMove ? '<button class="btn btn-primary mt8" onclick="pathsMoveWorkspace(this)">Move to the workspace of its own</button>' : ''}`;
  list.prepend(box);
}

async function pathsMoveWorkspace(btn) {
  appConfirm('Move your attachments and specialists into the new workspace? Their old places keep a link to the new one.', async () => {
    btn.disabled = true; btn.textContent = 'Moving…';
    try { const r = await apiFetch('/api/paths/move-workspace', { method: 'POST' }); appAlert(r.note || 'Moved.'); pathsLoad(); }
    catch (e) { btn.disabled = false; btn.textContent = 'Move to the workspace of its own'; appAlert(e.message); }
  });
}
