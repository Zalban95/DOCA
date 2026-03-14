/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — CONFIG  (multi-file editor + editable favorites)
   ═══════════════════════════════════════════════════════ */

/* ── File registry ───────────────────────────────────────
   Groups: favorites · core · providers · system
──────────────────────────────────────────────────────── */
const CONFIG_FILES = [
  { group: 'favorites', id: 'openclaw',  label: 'openclaw.json',       path: '/home/al/.openclaw/openclaw.json',      type: 'json', description: 'Main OpenClaw config — models, providers, tools' },
  { group: 'favorites', id: 'soul',      label: 'SOUL.md',             path: '/home/al/.openclaw/SOUL.md',            type: 'text', description: "Bob's rules and personality definition" },
  { group: 'favorites', id: 'compose',   label: 'docker-compose.yml',  path: '/home/al/openclaw/docker-compose.yml',  type: 'text', description: 'Docker Compose stack definition' },

  { group: 'config', id: 'aider',           label: '.aider.conf.yml',      path: '/home/al/.aider.conf.yml',              type: 'text', description: 'Aider defaults — model, API key, flags' },
  { group: 'config', id: 'env',             label: '.env',                 path: '/home/al/openclaw/.env',                type: 'env',  description: 'Docker env overrides for the stack' },
  { group: 'config', id: 'modelfile-qwen',  label: 'Modelfile.qwen-coder', path: '/home/al/.ollama/Modelfile.qwen-coder-gpu', type: 'text', description: 'Ollama Modelfile for qwen-coder-gpu' },
  { group: 'config', id: 'modelfile-qwen3', label: 'Modelfile.qwen3',      path: '/home/al/.ollama/Modelfile.qwen3',     type: 'text', description: 'Ollama Modelfile for qwen3:30b' },

  { group: 'custom', id: 'setup',    label: 'setup-openclaw.sh',  path: '/home/al/setup-openclaw.sh',  type: 'sh', description: 'Initial setup script' },
  { group: 'custom', id: 'snapshot', label: 'snapshot-agent.sh',  path: '/home/al/snapshot-agent.sh',  type: 'sh', description: 'Agent snapshot script' },
  { group: 'custom', id: 'restore',  label: 'restore-agent.sh',   path: '/home/al/restore-agent.sh',   type: 'sh', description: 'Agent restore script' }
];

const GROUP_LABELS = {
  favorites: '★ Favorites',
  config:    '⚙ Config',
  custom:    '⚡ Scripts'
};

let cfgActive = null;
let customFavorites = [];
let favEditMode = false;

function guessFileType(p) {
  if (p.endsWith('.json'))                   return 'json';
  if (p.endsWith('.sh'))                     return 'sh';
  if (p.endsWith('.env') || p.includes('.env')) return 'env';
  return 'text';
}

function getAllConfigFiles() {
  const custom = customFavorites.map((f, i) => ({
    group: 'favorites',
    id: `custom-fav-${i}`,
    label: f.label || f.path.split('/').pop(),
    path: f.path,
    type: f.type || guessFileType(f.path),
    description: f.description || f.path,
    custom: true
  }));
  return [...CONFIG_FILES, ...custom];
}

/* ── Init ────────────────────────────────────────────── */
async function initConfig() {
  await loadCustomFavorites();
  buildConfigSidebar();
  if (!cfgActive) cfgOpenFile('openclaw');
  else cfgLoadFile(cfgActive);
}

async function loadCustomFavorites() {
  try {
    const data = await apiFetch('/api/config-favorites');
    customFavorites = data.favorites || [];
  } catch { customFavorites = []; }
}

function buildConfigSidebar() {
  const container = document.getElementById('config-file-list');
  container.innerHTML = '';
  const allFiles = getAllConfigFiles();
  const groups   = ['favorites', 'config', 'custom'];

  groups.forEach(grp => {
    const files = allFiles.filter(f => f.group === grp);
    if (!files.length && grp !== 'favorites') return;

    const section = document.createElement('div');
    section.className = 'config-file-group';

    const labelRow = document.createElement('div');
    labelRow.className = 'config-file-group-label';
    labelRow.style.display = 'flex';
    labelRow.style.alignItems = 'center';
    labelRow.style.justifyContent = 'space-between';

    const labelText = document.createElement('span');
    labelText.textContent = GROUP_LABELS[grp];
    labelRow.appendChild(labelText);

    if (grp === 'favorites') {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-xs';
      editBtn.textContent = favEditMode ? 'Done' : 'Edit';
      editBtn.onclick = () => { favEditMode = !favEditMode; buildConfigSidebar(); };
      labelRow.appendChild(editBtn);
    }

    section.appendChild(labelRow);

    files.forEach(f => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';

      const btn = document.createElement('button');
      btn.className = 'config-file-item';
      btn.id        = `cfgbtn-${f.id}`;
      btn.title     = f.description + '\n' + f.path;
      btn.innerHTML = `<div class="config-file-name">${f.label}</div>
                       <div class="config-file-path">${f.path}</div>`;
      btn.style.flex = '1';
      btn.onclick = () => cfgOpenFile(f.id);

      row.appendChild(btn);

      if (favEditMode && grp === 'favorites' && f.custom) {
        const del = document.createElement('button');
        del.className = 'btn btn-xs btn-red';
        del.textContent = '✕';
        del.title = 'Remove from favorites';
        del.style.flexShrink = '0';
        del.style.margin = '0 4px';
        del.onclick = () => removeFavorite(f.path);
        row.appendChild(del);
      }

      section.appendChild(row);
    });

    if (favEditMode && grp === 'favorites') {
      const addRow = document.createElement('div');
      addRow.className = 'config-fav-add';
      addRow.innerHTML = `
        <input class="input" id="cfg-fav-add-path" placeholder="/path/to/file" style="font-size:10px;padding:4px 8px;flex:1">
        <button class="btn btn-xs btn-blue" onclick="addFavorite()">+ Add</button>
      `;
      section.appendChild(addRow);
    }

    container.appendChild(section);
  });

  if (cfgActive) {
    const btn = document.getElementById(`cfgbtn-${cfgActive}`);
    if (btn) btn.classList.add('active');
  }
}

async function addFavorite() {
  const input = document.getElementById('cfg-fav-add-path');
  const p = (input.value || '').trim();
  if (!p) return;
  if (customFavorites.some(f => f.path === p)) return;
  customFavorites.push({ path: p });
  await saveCustomFavorites();
  buildConfigSidebar();
}

async function removeFavorite(p) {
  customFavorites = customFavorites.filter(f => f.path !== p);
  await saveCustomFavorites();
  buildConfigSidebar();
}

async function saveCustomFavorites() {
  try {
    await apiFetch('/api/config-favorites', { method: 'POST', body: { favorites: customFavorites } });
  } catch (e) { console.error('Failed to save favorites:', e); }
}

/* ── Open a file ─────────────────────────────────────── */
async function cfgOpenFile(id) {
  const allFiles = getAllConfigFiles();
  const entry = allFiles.find(f => f.id === id);
  if (!entry) return;

  document.querySelectorAll('.config-file-item').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`cfgbtn-${id}`);
  if (btn) btn.classList.add('active');

  cfgActive = id;
  document.getElementById('config-editor-filename').textContent = `${entry.label}  —  ${entry.path}`;

  const editor = document.getElementById('config-editor');
  const status = document.getElementById('json-status');
  editor.value = '';
  setStatus(status, 'Loading…', 'info');

  try {
    let content;
    if (entry.custom) {
      const data = await apiFetch(`/api/files/read?path=${encodeURIComponent(entry.path)}`);
      content = data.content;
    } else {
      const data = await apiFetch(`/api/configs/${encodeURIComponent(entry.id)}`);
      content = data.content;
    }
    editor.value = entry.type === 'json'
      ? (() => { try { return JSON.stringify(JSON.parse(content), null, 2); } catch { return content; } })()
      : content;
    cfgValidate();
  } catch (e) {
    editor.value = `// Error loading file: ${e.message}`;
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function cfgLoadFile(id) { cfgOpenFile(id); }

/* ── Validate (JSON only) ────────────────────────────── */
function cfgValidate() {
  const allFiles = getAllConfigFiles();
  const entry  = allFiles.find(f => f.id === cfgActive);
  const editor = document.getElementById('config-editor');
  const status = document.getElementById('json-status');

  if (!entry || entry.type !== 'json') {
    editor.classList.remove('err');
    setStatus(status, entry ? `${entry.type} file` : '', '');
    return;
  }
  try {
    JSON.parse(editor.value);
    editor.classList.remove('err');
    setStatus(status, '✓ valid JSON', 'ok');
  } catch (e) {
    editor.classList.add('err');
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

/* ── Save ────────────────────────────────────────────── */
function saveConfig() {
  const allFiles = getAllConfigFiles();
  const entry  = allFiles.find(f => f.id === cfgActive);
  const editor = document.getElementById('config-editor');
  const status = document.getElementById('json-status');

  if (!entry) return;

  if (entry.type === 'json') {
    try { JSON.parse(editor.value); }
    catch { alert('Fix JSON errors before saving'); return; }
  }

  const needsRestart = entry.id === 'openclaw';
  const msg = needsRestart
    ? `Save ${entry.label} and restart OpenClaw?`
    : `Save ${entry.label}?`;

  appConfirm(msg, async () => {
    try {
      if (entry.custom) {
        await apiFetch('/api/files/write', { method: 'POST', body: { path: entry.path, content: editor.value } });
      } else {
        await apiFetch(`/api/configs/${encodeURIComponent(entry.id)}`, {
          method: 'POST',
          body: { content: editor.value }
        });
      }
      setStatus(status, '✓ Saved', 'ok');
      if (needsRestart) await action('restart');
      setTimeout(() => cfgValidate(), 4000);
    } catch (e) {
      setStatus(status, `✗ ${e.message}`, 'err');
    }
  });
}

function reloadConfig() {
  if (cfgActive) cfgOpenFile(cfgActive);
}
