/* ═══════════════════════════════════════════════════════
   DOCA PANEL — API KEYS
   ═══════════════════════════════════════════════════════ */

async function loadKeys() {
  devicesLoad();        // this server's /api/v1 device tokens
  if (!(typeof _settingsNoHost !== 'undefined' && _settingsNoHost)) keysLoadProviders();  // third-party LLM providers: the machine's keys
  clientAppsRender();   // DOCA's Android apps: the newest builds, built here (settings/client-apps.js)
}

/* ── LLM Providers ────────────────────────────────────── */

async function keysLoadProviders() {
  const list = document.getElementById('providers-list');
  if (!list) return;
  try {
    const data      = await apiFetch('/api/keys');
    const providers = data.providers || {};
    keysChecksLoad();   // the same provider twice, a missing /v1 (keys-checks.js)
    if (typeof serviceDraftsPoll === 'function') serviceDraftsPoll();
    if (!Object.keys(providers).length) {
      list.innerHTML = '<div class="placeholder">No providers yet — ＋ Add above.</div>';
      if (!document.getElementById('svc-add-providers')) keysAddToggle();
      return;
    }
    list.innerHTML = Object.entries(providers).map(([name, p]) => _providerCardHtml(name, p)).join('');
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

/** A local server needs no key, so it is "ready", not "NO KEY". Its address is typed or picked from the model servers
 *  and services on this machine (lib/choice-input.js, GET /api/services/choices). */
function _providerCardHtml(name, p) {
  const ready = p.hasKey || p.local;
  const badge = p.hasKey ? 'KEY SET' : p.local ? 'LOCAL' : 'NO KEY';
  return `
    <div class="provider-card ${ready ? 'has-key' : 'no-key'}" data-provider="${escHtml(name)}">
      <div class="provider-header">
        <span class="provider-name">${escHtml(name)}</span>
        <span class="provider-badge ${ready ? 'ok' : 'no'}" ${p.local && !/^https?:\/\/(127|10|192|172|localhost|0\.0|\[)/.test(p.baseUrl || '') ? 'title="This hub\'s own address: no key needed"' : ''}>${badge}</span>
      </div>
      ${p.models?.length ? `<div class="provider-models">Models: ${escHtml(p.models.slice(0,4).join(', '))}${p.models.length>4?' …':''}</div>` : ''}
      ${p.pace ? `<div class="provider-models" title="Its own first-token wait and reply limit, used when larger than the harness's settings">Pace: ${escHtml(p.pace)}</div>` : ''}
      <div class="provider-key-row">
        ${choiceInput({ id: `url-${name}`, value: p.baseUrl || '', placeholder: 'https://…/v1', attrs: 'title="Base URL"', source: 'this machine',
          load: () => apiFetch(`/api/services/choices?what=provider-url&provider=${encodeURIComponent(name)}`) })}
        <input class="input" type="password" id="key-${escHtml(name)}"
               placeholder="${escHtml(p.apiKeyMasked || (p.local ? 'no key needed' : 'Enter API key…'))}">
        <button class="btn btn-sm btn-green" onclick="saveKey(${jsArg(name)})">Save</button>
        <button class="btn btn-sm btn-red"   onclick="deleteProvider(${jsArg(name)})">✕</button>
      </div>
      <div class="status-line mt4" id="key-status-${escHtml(name)}"></div>
    </div>`;
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
  appConfirm(`Remove the provider “${name}” and its key? Models it serves stop answering here until it is added again.`, async () => {
    const status = document.getElementById(`key-status-${name}`);
    try {
      await apiFetch(`/api/keys/${encodeURIComponent(name)}`, { method: 'DELETE' });
      keysLoadProviders();
    } catch (e) { setStatus(status, `✗ ${e.message}`, 'err'); }
  });
}

/** A provider's row, from elsewhere (the harness ⚙ when its models did not load): its address field, in view. */
function keysShowProvider(name) {
  nav('apikeys');
  setTimeout(() => { const el = document.getElementById(`url-${name}`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }, 700);
}

/** ＋ Add: the one "Add a service" box (settings/service-add.js), above the list — a chat model is added here, any
 *  other API goes on to Field → Connectors → API services. */
function keysAddToggle() {
  const slot = document.getElementById('svc-add-providers-slot');
  if (!slot) return;
  if (slot.innerHTML) { slot.innerHTML = ''; return; }
  slot.innerHTML = serviceAddBoxHtml('providers');
  serviceAddSuggest('providers');
  document.getElementById('sa-q-providers').focus();
}
