/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — API KEYS + TOOL APIS
   ═══════════════════════════════════════════════════════ */

async function loadKeys() {
  keysLoadToolApis();
  const list = document.getElementById('providers-list');
  try {
    const data = await apiFetch('/api/keys');
    const providers = data.providers || {};
    if (!Object.keys(providers).length) {
      list.innerHTML = '<div class="placeholder">No providers configured</div>'; return;
    }
    list.innerHTML = Object.entries(providers).map(([name, p]) => `
      <div class="provider-card ${p.hasKey ? 'has-key' : 'no-key'}">
        <div class="provider-header">
          <span class="provider-name">${name}</span>
          <span class="provider-badge ${p.hasKey ? 'ok' : 'no'}">${p.hasKey ? 'KEY SET' : 'NO KEY'}</span>
        </div>
        ${p.models?.length ? `<div class="provider-models">Models: ${p.models.slice(0,4).join(', ')}${p.models.length>4?' …':''}</div>` : ''}
        <div class="provider-key-row">
          <input class="input" type="password" id="key-${name}" placeholder="${p.apiKeyMasked || 'Enter API key…'}">
          <button class="btn btn-sm btn-green" onclick="saveKey('${name}')">Save Key</button>
          <button class="btn btn-sm btn-red"   onclick="deleteProvider('${name}')">✕</button>
        </div>
        <div class="status-line mt4" id="key-status-${name}"></div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

async function saveKey(provider) {
  const input  = document.getElementById(`key-${provider}`);
  const status = document.getElementById(`key-status-${provider}`);
  const apiKey = input.value.trim();
  if (!apiKey) { setStatus(status, 'Enter a key first', 'err'); return; }
  try {
    await apiFetch('/api/keys', { method: 'POST', body: { provider, apiKey } });
    setStatus(status, '✓ Saved — restart OpenClaw to apply', 'ok');
    input.value = '';
    setTimeout(loadKeys, 1500);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function deleteProvider(name) {
  appConfirm(`Remove provider "${name}"?`, async () => {
    try {
      await apiFetch(`/api/keys/${name}`, { method: 'DELETE' });
      loadKeys();
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

function showAddProvider() { document.getElementById('add-provider-form').style.display = 'block'; }
function hideAddProvider() { document.getElementById('add-provider-form').style.display = 'none'; }

async function addProvider() {
  const name    = document.getElementById('np-name').value.trim();
  const baseUrl = document.getElementById('np-url').value.trim();
  const apiKey  = document.getElementById('np-key').value.trim();
  const status  = document.getElementById('np-status');
  if (!name || !baseUrl) { setStatus(status, 'Name and URL required', 'err'); return; }
  try {
    await apiFetch('/api/keys/add-provider', { method: 'POST', body: { name, baseUrl, apiKey } });
    setStatus(status, `✓ Added ${name}`, 'ok');
    hideAddProvider();
    setTimeout(loadKeys, 500);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

/* ── Tool APIs ────────────────────────────────────────── */

const TOOL_API_DEFS = [
  { key: 'stableDiffusion', label: 'Stable Diffusion WebUI', placeholder: 'http://127.0.0.1:7860' },
  { key: 'comfyui',         label: 'ComfyUI',                placeholder: 'http://127.0.0.1:8188' },
  { key: 'openwebui',       label: 'Open WebUI',             placeholder: 'http://127.0.0.1:3000' },
  { key: 'kokoro',          label: 'Kokoro TTS',             placeholder: 'http://127.0.0.1:8880' },
  { key: 'whisper',         label: 'Whisper API',            placeholder: 'http://127.0.0.1:9000' },
];

let _toolApis = {};

async function keysLoadToolApis() {
  const el = document.getElementById('tool-apis-list');
  if (!el) return;
  try {
    const data = await apiFetch('/api/keys/tool-apis');
    _toolApis = data.toolApis || {};
    _keysRenderToolApis(el);
  } catch (e) {
    el.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

function _keysRenderToolApis(el) {
  el.innerHTML = TOOL_API_DEFS.map(t => {
    const val = _toolApis[t.key]?.url || '';
    return `
      <div class="tool-api-row">
        <span class="tool-api-label">${t.label}</span>
        <input class="input" id="tool-api-${t.key}" placeholder="${t.placeholder}" value="${val}">
        <span class="status-line" id="tool-api-status-${t.key}"></span>
      </div>
    `;
  }).join('');
}

async function keysSaveToolApis() {
  const status = document.getElementById('tool-apis-status');
  const toolApis = {};
  TOOL_API_DEFS.forEach(t => {
    const val = document.getElementById(`tool-api-${t.key}`)?.value.trim();
    if (val) toolApis[t.key] = { url: val };
  });
  try {
    await apiFetch('/api/keys/tool-apis', { method: 'POST', body: { toolApis } });
    setStatus(status, '✓ Saved', 'ok');
    _toolApis = toolApis;
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function keysShowToolApis() {
  const section = document.getElementById('tool-apis-section');
  if (section) section.scrollIntoView({ behavior: 'smooth' });
}
