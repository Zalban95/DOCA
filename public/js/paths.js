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
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

function _pathsRender(rows) {
  const list = document.getElementById('paths-list');
  if (!list) return;
  list.innerHTML = rows.map(_pathRowHtml).join('');
}

function _pathRowHtml(p) {
  const id = `path-in-${p.key}`;
  const browse = p.kind === 'dir' ? 'dir' : 'file';

  // Where the value in the box comes from, so a field that looks editable but is
  // really coming from systemd or Docker does not look like the user's own choice.
  const origin = p.source === 'saved' ? 'set here'
    : p.source === 'env' ? `from ${p.key}`
    : 'default';

  const state = p.exists
    ? '<span class="path-ok">● exists</span>'
    : '<span class="path-missing">✗ missing</span>';

  // Saved, but this process is still running on the old value.
  const pending = p.pending
    ? ` · <span class="path-missing">restart to apply</span> (using <code>${escHtml(p.active)}</code>)`
    : '';

  const create = p.exists ? '' : `
    <button class="btn btn-xs btn-teal" onclick="pathsCreate(${jsArg(p.key)})"
            title="Create this ${PATH_KIND_LABEL[p.kind] || 'path'}">+ Create</button>`;

  return `
    <div class="path-row">
      <div class="path-label">${escHtml(p.label)}<small>${escHtml(p.note || '')}</small></div>
      <div>
        <div class="path-fields">
          <input id="${id}" class="input flex1" data-key="${escHtml(p.key)}"
                 value="${p.source === 'saved' ? escHtml(p.value) : ''}"
                 placeholder="${escHtml(p.value)}">
          <button class="btn btn-xs" title="Browse" onclick="fpOpen('${id}','${browse}')">📁</button>
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
    // "restart DOCA" — this process, which reads the saved paths at boot; that
    // is why the row above it says "restart to apply" too. The external OpenClaw
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
