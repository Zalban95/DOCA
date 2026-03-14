/* ═══════════════════════════════════════════════════════
   OPENCLAW PANEL — API KEYS + TOOL PROVIDERS
   ═══════════════════════════════════════════════════════ */

async function loadKeys() {
  keysLoadProviders();
  keysLoadToolProviders();
}

/* ── LLM Providers ────────────────────────────────────── */

async function keysLoadProviders() {
  const list = document.getElementById('providers-list');
  if (!list) return;
  try {
    const data      = await apiFetch('/api/keys');
    const providers = data.providers || {};
    if (!Object.keys(providers).length) {
      list.innerHTML = '<div class="placeholder">No providers configured</div>';
      return;
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
    setTimeout(keysLoadProviders, 1500);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function deleteProvider(name) {
  appConfirm(`Remove provider "${name}"?`, async () => {
    try {
      await apiFetch(`/api/keys/${name}`, { method: 'DELETE' });
      keysLoadProviders();
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
    setTimeout(keysLoadProviders, 500);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

/* ── Tool Providers (non-LLM) ─────────────────────────── */

async function keysLoadToolProviders() {
  const list = document.getElementById('tool-providers-list');
  if (!list) return;
  try {
    const data      = await apiFetch('/api/keys/tool-providers');
    const providers = data.providers || {};
    if (!Object.keys(providers).length) {
      list.innerHTML = '<div class="placeholder">No tool providers configured</div>';
      return;
    }
    list.innerHTML = Object.entries(providers).map(([name, p]) => `
      <div class="provider-card ${p.hasKey ? 'has-key' : 'no-key'}">
        <div class="provider-header">
          <span class="provider-name">${name}</span>
          <span class="provider-badge ${p.hasKey ? 'ok' : 'no'}">${p.hasKey ? 'KEY SET' : 'NO KEY'}</span>
        </div>
        ${p.baseUrl ? `<div class="provider-models" style="font-size:10px">${p.baseUrl}</div>` : ''}
        <div class="provider-key-row">
          <input class="input" type="password" id="tkey-${name}" placeholder="${p.apiKeyMasked || 'Enter API key (optional)…'}">
          <button class="btn btn-sm btn-green" onclick="saveToolProviderKey('${name}')">Save Key</button>
          <button class="btn btn-sm btn-red"   onclick="deleteToolProvider('${name}')">✕</button>
        </div>
        <div class="status-line mt4" id="tkey-status-${name}"></div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

async function saveToolProviderKey(name) {
  const input  = document.getElementById(`tkey-${name}`);
  const status = document.getElementById(`tkey-status-${name}`);
  const apiKey = input.value.trim();
  if (!apiKey) { setStatus(status, 'Enter a key first', 'err'); return; }
  try {
    await apiFetch('/api/keys/tool-providers', { method: 'POST', body: { provider: name, apiKey } });
    setStatus(status, '✓ Saved', 'ok');
    input.value = '';
    setTimeout(keysLoadToolProviders, 1500);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function deleteToolProvider(name) {
  appConfirm(`Remove tool provider "${name}"?`, async () => {
    try {
      await apiFetch(`/api/keys/tool-providers/${name}`, { method: 'DELETE' });
      keysLoadToolProviders();
    } catch (e) { alert(`Error: ${e.message}`); }
  });
}

function showAddToolProvider() { document.getElementById('add-tool-provider-form').style.display = 'block'; }
function hideAddToolProvider() { document.getElementById('add-tool-provider-form').style.display = 'none'; }

async function addToolProvider() {
  const name    = document.getElementById('tp-name').value.trim();
  const baseUrl = document.getElementById('tp-url').value.trim();
  const apiKey  = document.getElementById('tp-key').value.trim();
  const status  = document.getElementById('tp-status');
  if (!name || !baseUrl) { setStatus(status, 'Name and URL required', 'err'); return; }
  try {
    await apiFetch('/api/keys/tool-providers/add', { method: 'POST', body: { name, baseUrl, apiKey } });
    setStatus(status, `✓ Added ${name}`, 'ok');
    hideAddToolProvider();
    setTimeout(keysLoadToolProviders, 500);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}
