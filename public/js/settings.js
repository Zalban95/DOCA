/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SETTINGS TAB
   ═══════════════════════════════════════════════════════ */

const SETTINGS_TABS = [
  { id: 'controls',  label: 'Controls' },
  { id: 'logs',      label: 'Logs' },
  { id: 'keys',      label: 'API Keys' },
  { id: 'skills',    label: 'Skills' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'setup',     label: 'Setup' },
  { id: 'config',    label: 'Config' },
  { id: 'files',     label: 'Files' },
  { id: 'code',      label: 'Code' },
  { id: 'terminal',  label: 'Terminal' },
  { id: 'models',    label: 'Models' },
  { id: 'docker',    label: 'Docker' },
];

let _settingsHidden = [];

async function settingsInit() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _settingsHidden = prefs.hiddenTabs || [];
    _settingsRender();
  } catch (e) {
    const el = document.getElementById('settings-tabs-list');
    if (el) el.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
  sysdepsLoad();
  updateCheck();
}

function _settingsRender() {
  const list = document.getElementById('settings-tabs-list');
  if (!list) return;
  list.innerHTML = SETTINGS_TABS.map(t => `
    <div class="settings-tab-row">
      <label class="skill-toggle">
        <input type="checkbox" id="settings-show-${t.id}"
               ${!_settingsHidden.includes(t.id) ? 'checked' : ''}>
        <span class="skill-toggle-track"></span>
      </label>
      <span class="settings-tab-label">${t.label}</span>
    </div>
  `).join('');
}

async function settingsSave() {
  const status = document.getElementById('settings-status');
  const hiddenTabs = SETTINGS_TABS
    .filter(t => !document.getElementById(`settings-show-${t.id}`)?.checked)
    .map(t => t.id);

  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { hiddenTabs } });
    setStatus(status, '✓ Saved', 'ok');
    _settingsHidden = hiddenTabs;
    _applyHiddenTabs(hiddenTabs);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function _applyHiddenTabs(hiddenTabs) {
  document.querySelectorAll('.nav-tab[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab;
    if (tab === 'settings') return;
    btn.style.display = hiddenTabs.includes(tab) ? 'none' : '';
  });
}

/* Called on app startup to apply persisted hidden tabs */
async function settingsApplyOnLoad() {
  try {
    const prefs = await apiFetch('/api/prefs');
    _settingsHidden = prefs.hiddenTabs || [];
    _applyHiddenTabs(_settingsHidden);
  } catch {}
  _silentUpdateBadgeCheck();
}

async function _silentUpdateBadgeCheck() {
  try {
    const data = await apiFetch('/api/update-check');
    const badge = document.getElementById('update-badge');
    if (badge && data.updateAvailable) {
      badge.style.display = 'inline-block';
      badge.title = `Update: v${data.latest} available`;
    }
  } catch {}
}

/* ── System Tools (sysdeps) ──────────────────────────── */

const SYSDEP_CATEGORY_LABEL = { required: 'Required', recommended: 'Recommended', optional: 'Optional' };
const SYSDEP_CATEGORY_COLOR = { required: 'var(--red)', recommended: 'var(--amber)', optional: 'var(--muted)' };

let _sysdepsInstalling = null; // tool id currently installing
let _sysdepsTools      = [];   // cached list from last fetch (used by sysdepsInstall)

async function sysdepsLoad() {
  const list   = document.getElementById('sysdeps-list');
  const btn    = document.getElementById('sysdeps-refresh-btn');
  if (!list) return;
  list.innerHTML = '<div class="placeholder pulse">Checking…</div>';
  if (btn) btn.disabled = true;
  try {
    const data  = await apiFetch('/api/system/tools');
    _sysdepsTools = data.tools || [];
    _sysdepsRender(_sysdepsTools);
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function sysdepsRefresh() { sysdepsLoad(); }

function _sysdepsRender(tools) {
  const list = document.getElementById('sysdeps-list');
  if (!list) return;

  // Group by category
  const cats = ['required', 'recommended', 'optional'];
  let html = '';

  cats.forEach(cat => {
    const group = tools.filter(t => t.category === cat);
    if (!group.length) return;

    html += `<div class="sysdep-group-label" style="color:${SYSDEP_CATEGORY_COLOR[cat]}">${SYSDEP_CATEGORY_LABEL[cat]}</div>`;
    html += group.map(t => {
      const statusIcon  = t.detected ? '✓' : '✗';
      const statusClass = t.detected ? 'sysdep-ok' : 'sysdep-missing';
      const versionStr  = t.detected && t.version ? `<span class="sysdep-version">${_escHtml(t.version)}</span>` : '';
      const installBtn  = !t.detected && t.canInstall
        ? `<button class="btn btn-xs btn-teal" onclick="sysdepsInstall('${t.id}')" ${_sysdepsInstalling === t.id ? 'disabled' : ''}>
             ${_sysdepsInstalling === t.id ? '⏳ Installing…' : '⬇ Install'}
           </button>`
        : '';
      const repoLink = !t.detected
        ? `<a class="sysdep-repo" href="${t.repo}" target="_blank" title="${t.repo}">${_escHtml(t.repoLabel || t.repo)}</a>`
        : '';
      const manualNote = !t.detected && !t.canInstall
        ? `<span class="sysdep-manual">manual install required</span>`
        : '';

      return `<div class="sysdep-row ${statusClass}">
        <span class="sysdep-status">${statusIcon}</span>
        <span class="sysdep-label">${_escHtml(t.label)}</span>
        ${versionStr}
        <span class="sysdep-note">${_escHtml(t.note || '')}</span>
        <span class="sysdep-actions">${installBtn}${repoLink}${manualNote}</span>
      </div>`;
    }).join('');
  });

  list.innerHTML = html;
}

function sysdepsInstall(id) {
  const tool = _sysdepsTools.find(t => t.id === id);
  const needsSudo = tool && typeof tool.installCmd === 'string' && tool.installCmd.includes('sudo ');

  if (needsSudo) {
    sudoAsk(`Installing "${tool.label}" requires elevated privileges.`, pw => {
      if (pw === null) return; // user cancelled
      _sysdepsRunInstall(id, pw);
    });
  } else {
    _sysdepsRunInstall(id, null);
  }
}

async function _sysdepsRunInstall(id, password) {
  _sysdepsInstalling = id;
  // Re-render with installing flag using cached tools list
  if (_sysdepsTools.length) _sysdepsRender(_sysdepsTools);

  const out = document.getElementById('sysdeps-out');
  if (out) { out.style.display = 'block'; out.textContent = `Installing ${id}…\n`; }

  try {
    const body = { id };
    if (password !== null && password !== undefined) body.password = password;

    const res = await fetch('/api/system/tools/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    const read    = async () => {
      const { done, value } = await reader.read();
      if (done) return;
      decoder.decode(value).split('\n').forEach(line => {
        if (!line.startsWith('data: ')) return;
        try {
          const obj = JSON.parse(line.slice(6));
          if (obj.status && out) { out.textContent += obj.status; out.scrollTop = out.scrollHeight; }
          if (obj.done) {
            _sysdepsInstalling = null;
            setTimeout(sysdepsLoad, 800);
          }
        } catch {}
      });
      await read();
    };
    await read();
  } catch (e) {
    if (out) out.textContent += `\nError: ${e.message}`;
    _sysdepsInstalling = null;
    setTimeout(sysdepsLoad, 500);
  }
}

function _escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Update Checker ──────────────────────────────────── */

async function updateCheck() {
  const el = document.getElementById('update-status');
  const badge = document.getElementById('update-badge');
  const btn = document.getElementById('update-check-btn');
  if (btn) btn.disabled = true;
  if (el) el.innerHTML = '<span class="placeholder pulse" style="font-size:12px">Checking for updates…</span>';

  try {
    const data = await apiFetch('/api/update-check');
    if (data.updateAvailable) {
      if (el) el.innerHTML = `<div class="update-info">
        <strong style="color:var(--amber)">Update available!</strong><br>
        Current: <code>${_escHtml(data.current)}</code> → Latest: <code>${_escHtml(data.latest)}</code><br>
        <a href="${_escHtml(data.repo)}/releases" target="_blank" rel="noopener">View release notes ↗</a><br>
        <span style="font-size:11px;color:var(--muted)">Run <code>git pull</code> in the DOCA directory, then restart the server.</span>
      </div>`;
      if (badge) { badge.style.display = 'inline-block'; badge.title = `Update: v${data.latest} available`; }
    } else {
      if (el) el.innerHTML = `<div class="update-info" style="color:var(--green)">
        ✓ Up to date — <code>${_escHtml(data.current)}</code>
      </div>`;
      if (badge) badge.style.display = 'none';
    }
  } catch (e) {
    if (el) el.innerHTML = `<div class="update-info" style="color:var(--red)">
      ✗ Could not check: ${_escHtml(e.message)}
    </div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ── Sidebar quick tab-toggle panel ──────────────────── */

async function sidebarTabToggleChange(tabId, visible) {
  if (visible) {
    _settingsHidden = _settingsHidden.filter(id => id !== tabId);
  } else {
    if (!_settingsHidden.includes(tabId)) _settingsHidden.push(tabId);
  }
  _applyHiddenTabs(_settingsHidden);
  try {
    await apiFetch('/api/prefs', { method: 'POST', body: { hiddenTabs: _settingsHidden } });
  } catch {}
  // Sync settings tab if open
  const el = document.getElementById(`settings-show-${tabId}`);
  if (el) el.checked = visible;
}
