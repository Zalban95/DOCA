/* ═══════════════════════════════════════════════════════
   DOCA PANEL — API KEYS
   ═══════════════════════════════════════════════════════ */

async function loadKeys() {
  devicesLoad();        // this server's /api/v1 device tokens
  keysLoadProviders();  // third-party LLM providers
}

/* ── LLM Providers ────────────────────────────────────── */

let _keyPresets = [];   // known endpoints, for the add form and the unconfigured list

async function keysLoadProviders() {
  const list = document.getElementById('providers-list');
  if (!list) return;
  try {
    const data      = await apiFetch('/api/keys');
    const providers = data.providers || {};
    _keyPresets     = data.presets || [];
    _keyPresetsRender(Object.keys(providers));
    if (!Object.keys(providers).length) {
      list.innerHTML = '<div class="placeholder">No providers configured — add one below</div>';
      return;
    }
    list.innerHTML = Object.entries(providers).map(([name, p]) => _providerCardHtml(name, p)).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${e.message}</div>`;
  }
}

/** A local server needs no key, so it is "ready", not "NO KEY". */
function _providerCardHtml(name, p) {
  const ready = p.hasKey || p.local;
  const badge = p.hasKey ? 'KEY SET' : p.local ? 'LOCAL' : 'NO KEY';
  return `
    <div class="provider-card ${ready ? 'has-key' : 'no-key'}">
      <div class="provider-header">
        <span class="provider-name">${escHtml(name)}</span>
        <span class="provider-badge ${ready ? 'ok' : 'no'}">${badge}</span>
      </div>
      ${p.models?.length ? `<div class="provider-models">Models: ${escHtml(p.models.slice(0,4).join(', '))}${p.models.length>4?' …':''}</div>` : ''}
      <div class="provider-key-row">
        <input class="input" id="url-${escHtml(name)}" value="${escHtml(p.baseUrl || '')}"
               placeholder="https://…/v1" title="Base URL">
        <input class="input" type="password" id="key-${escHtml(name)}"
               placeholder="${escHtml(p.apiKeyMasked || (p.local ? 'no key needed' : 'Enter API key…'))}">
        <button class="btn btn-sm btn-green" onclick="saveKey(${jsArg(name)})">Save</button>
        <button class="btn btn-sm btn-red"   onclick="deleteProvider(${jsArg(name)})">✕</button>
      </div>
      <div class="status-line mt4" id="key-status-${escHtml(name)}"></div>
    </div>`;
}

/** One-click adds for endpoints we know but that are not configured yet. */
function _keyPresetsRender(configured) {
  const el = document.getElementById('provider-presets');
  if (!el) return;
  const missing = _keyPresets.filter(p => !configured.includes(p.id));
  el.innerHTML = !missing.length ? '' : `
    <div class="input-label" style="margin:10px 0 6px">Known endpoints — click to add</div>
    <div class="provider-preset-row">
      ${missing.map(p => `
        <button class="btn btn-xs ${p.local ? 'btn-green' : ''}" onclick="addPreset(${jsArg(p.id)})"
                title="${escHtml(p.baseUrl)}${p.env ? ` — or set $${p.env}` : ''}">
          ${escHtml(p.label)}
        </button>`).join('')}
    </div>`;
}

/** Adds a known endpoint by id; its URL comes from the server's preset table. */
async function addPreset(id) {
  const status = document.getElementById('np-status');
  try {
    const r = await apiFetch('/api/keys/add-provider', { method: 'POST', body: { name: id } });
    setStatus(status, `✓ Added ${id} at ${r.baseUrl} — set a key below if it needs one`, 'ok');
    keysLoadProviders();
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

async function saveKey(provider) {
  const status  = document.getElementById(`key-status-${provider}`);
  const apiKey  = document.getElementById(`key-${provider}`).value.trim();
  const baseUrl = document.getElementById(`url-${provider}`).value.trim();
  if (!apiKey && !baseUrl) { setStatus(status, 'Enter a key or a base URL first', 'err'); return; }
  try {
    await apiFetch('/api/keys', { method: 'POST', body: { provider, apiKey, baseUrl } });
    // DOCA's own harness reads this file on every call (harness/providers.js),
    // so the key works at once — "restart" was wrong for it, and for everyone
    // without OpenClaw. OpenClaw reads it at start, so when it is installed it
    // gets its own phrase: "restart OpenClaw", never "restart DOCA" — paths.js
    // and settings say that one, and the two are different restarts.
    const oc = typeof _openclawInstalled !== 'undefined' && _openclawInstalled;
    setStatus(status, `✓ Saved — DOCA uses it now${oc ? '; restart OpenClaw to apply it there' : ''}`, 'ok');
    document.getElementById(`key-${provider}`).value = '';
    setTimeout(keysLoadProviders, 1500);
  } catch (e) {
    setStatus(status, `✗ ${e.message}`, 'err');
  }
}

function deleteProvider(name) {
  appConfirm(`Remove provider "${name}"?`, async () => {
    const status = document.getElementById(`key-status-${name}`);
    try {
      await apiFetch(`/api/keys/${encodeURIComponent(name)}`, { method: 'DELETE' });
      keysLoadProviders();
    } catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
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
