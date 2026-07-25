/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — SETUP SCRIPTS
   ═══════════════════════════════════════════════════════ */

async function loadScripts() {
  const list = document.getElementById('scripts-list');
  try {
    const data = await apiFetch('/api/setup/scripts');
    list.innerHTML = data.scripts.map(s => `
      <div class="script-item fade-in">
        <div>
          <div class="script-name">${s.name}</div>
          <div class="script-meta">${s.exists
            ? `${fmtBytes(s.size)} · ${fmtDate(s.modified)}`
            : 'not found'
          }</div>
        </div>
        <div class="toolbar-right">
          ${s.exists ? `<button class="btn btn-sm" onclick="editScript('${s.name}')">Edit</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

async function editScript(name) {
  const area   = document.getElementById('script-editor-area');
  const editor = document.getElementById('script-editor');
  const nameEl = document.getElementById('editing-script-name');
  try {
    const data = await apiFetch(`/api/setup/scripts/${name}`);
    editor.value     = data.content;
    nameEl.textContent = name;
    area.style.display = 'flex';
    editor.focus();
  } catch (e) { appAlert(`Error: ${e.message}`); }
}

function closeScriptEditor() {
  document.getElementById('script-editor-area').style.display = 'none';
}

async function saveScript() {
  const name    = document.getElementById('editing-script-name').textContent;
  const content = document.getElementById('script-editor').value;
  const status  = document.getElementById('script-status');
  try {
    await apiFetch(`/api/setup/scripts/${name}`, { method: 'POST', body: { content } });
    setStatus(status, '✓ Saved', 'ok');
    setTimeout(() => setStatus(status, ''), 4000);
  } catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
}
