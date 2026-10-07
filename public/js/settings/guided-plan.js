/* ═══════════════════════════════════════════════════════
   Settings → Set-up: what the answers set up (modules/guided/plan.js).
   An install is a proposal, installed by the Install button through the
   same route as the Harness tray; a key is pasted, saved as Field → API keys
   saves it, then tested by listing the provider's models.
   ═══════════════════════════════════════════════════════ */

// Where a role's model is chosen once its provider works: the agent's own model is set from here.
let _guidedLastPlan = null;   // the plan drawn last: each key row's providers and their key pages
const _GUIDED_WHERE = { coding: 'Controls → DOCA ⚙ (or a specialist\'s own model)', vision: 'Settings → Harness → Vision', embeddings: 'Settings → Harness → Retrieval' };

function guidedPlanRender(p, applied) {
  const el = document.getElementById('guided-plan');
  if (!el) return;
  _guidedLastPlan = p;
  const rows = p.steps.map((s, i) => (s.type === 'install' ? _guidedInstallRow(s, i, applied) : _guidedKeyRow(s, i))).join('');
  const devices = p.devices.length ? `<div class="guided-step"><div class="guided-step-title">Your devices</div>${p.devices.map(d =>
    `<div class="guided-muted">• ${escHtml(d.label)}: ${escHtml(d.how)}</div>`).join('')}</div>` : '';
  el.innerHTML = `<div class="card"><div class="card-title">${applied ? 'Waiting for you' : 'What it would set up'}</div>
    ${p.steps.length ? '' : '<p class="guided-muted">Nothing to set up: everything this needs is here.</p>'}
    ${rows}${devices}
    ${applied ? '' : '<p class="guided-muted">Nothing has changed yet: "Set it up" keeps your answers and puts each install in front of you.</p>'}</div>`;
  p.steps.forEach((s, i) => { if (s.type === 'key' && s.providers.length) guidedKeyProvider(i); });
}

function _guidedInstallRow(s, i, applied) {
  const pr = s.proposal;
  const state = s.error ? `<span style="color:var(--red)">${escHtml(s.error)}</span>`
    : !applied ? '<span class="guided-muted">a click installs it, once you choose "Set it up"</span>'
    : pr?.status === 'installed' ? '<span style="color:var(--green)">✓ installed</span>'
    : pr ? `<button class="btn btn-xs btn-green" onclick="guidedInstall(${jsArg(pr.id)}, ${i}, ${pr.needsPassword ? 'true' : 'false'})">${escHtml(pr.verb || 'Install')}</button>` : '';
  const use = s.role === 'chat' && s.kind === 'ollama-model'
    ? ` <button class="btn btn-xs" id="guided-use-${i}" style="display:${pr?.status === 'installed' ? '' : 'none'}" onclick="guidedUseModel('ollama', ${jsArg(s.id)}, ${i})">Use it for DOCA's agent</button>` : '';
  return `<div class="guided-step"><div class="guided-step-title">⬇ ${escHtml(s.label)} <span class="guided-muted">— ${escHtml(s.why)}</span></div>
    <div class="toolbar">${state}${use}<span class="status-line" id="guided-st-${i}"></span></div></div>`;
}

function _guidedKeyRow(s, i) {
  if (!s.providers.length) return `<div class="guided-step"><div class="guided-step-title">✎ ${escHtml(s.label)}</div><div class="guided-muted">${escHtml(s.note || 'No provider serves this yet.')}</div></div>`;
  const first = s.providers.find(x => x.hasKey) || s.providers[0];
  const opts = s.providers.map(x => `<option value="${escHtml(x.id)}"${x === first ? ' selected' : ''}>${escHtml(x.label)}${x.hasKey ? ' — key already here' : ''}</option>`).join('');
  return `<div class="guided-step" id="guided-key-${i}" data-role="${escHtml(s.role)}"><div class="guided-step-title">🔑 ${escHtml(s.label)} <span class="guided-muted">— ${escHtml(s.why)}</span></div>
    <div class="toolbar guided-key">
      <select class="input" onchange="guidedKeyProvider(${i})">${opts}</select>
      <a class="btn btn-xs" target="_blank" rel="noopener" id="guided-key-link-${i}">Get a key ↗</a>
      <input class="input" type="password" autocomplete="off" placeholder="Paste the key here" id="guided-key-in-${i}">
      <button class="btn btn-xs btn-blue" onclick="guidedKeyTest(${i})">Save and test</button>
      <span class="status-line" id="guided-st-${i}"></span></div>
    <div class="toolbar" id="guided-key-models-${i}"></div></div>`;
}

/** The chosen provider's key page, kept on the link (the plan carries it per provider). */
function guidedKeyProvider(i) {
  const row = document.getElementById(`guided-key-${i}`);
  const id = row?.querySelector('select')?.value;
  const step = _guidedLastPlan?.steps?.[i];
  const p = step?.providers?.find(x => x.id === id);
  const link = document.getElementById(`guided-key-link-${i}`);
  if (link) { link.href = p?.keyPage || '#'; link.style.display = p?.keyPage ? '' : 'none'; }
  const input = document.getElementById(`guided-key-in-${i}`);
  if (input) input.placeholder = p?.hasKey ? 'A key is here — leave empty to test it' : 'Paste the key here';
}

async function guidedKeyTest(i) {
  const row = document.getElementById(`guided-key-${i}`), st = document.getElementById(`guided-st-${i}`);
  const provider = row.querySelector('select').value, input = document.getElementById(`guided-key-in-${i}`);
  const apiKey = input.value.trim();
  try {
    if (apiKey) { await apiFetch('/api/keys', { method: 'POST', body: { provider, apiKey } }); input.value = ''; }
    setStatus(st, 'testing…', '');
    const r = await apiFetch(`/api/harness/models?provider=${encodeURIComponent(provider)}`);
    if (r.error || !r.models?.length) return setStatus(st, `✗ ${r.error || 'it answered with no models'} — check the key`, 'err');
    setStatus(st, `✓ works — ${r.models.length} models`, 'ok');
    const role = row.dataset.role, box = document.getElementById(`guided-key-models-${i}`);
    box.innerHTML = role === 'chat'
      ? `<select class="input" id="guided-key-model-${i}">${r.models.map(m => `<option>${escHtml(m)}</option>`).join('')}</select>
         <button class="btn btn-xs btn-green" onclick="guidedUseModel(${jsArg(provider)}, document.getElementById('guided-key-model-${i}').value, ${i})">Use it for DOCA's agent</button>`
      : `<span class="guided-muted">Choose its model in ${escHtml(_GUIDED_WHERE[role] || 'Field → Models')}.</span>`;
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function guidedInstall(id, i, needsPassword) {
  const st = document.getElementById(`guided-st-${i}`);
  const run = async password => {
    setStatus(st, 'installing… (this can take a while)', '');
    try {
      const { install } = await apiFetch(`/api/harness/installs/${encodeURIComponent(id)}/apply`, { method: 'POST', body: password ? { password } : {} });
      if (install.status !== 'installed') return setStatus(st, `✗ ${install.error || 'failed'}`, 'err');
      setStatus(st, '✓ installed', 'ok');
      const use = document.getElementById(`guided-use-${i}`);
      if (use) use.style.display = '';
    } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
  };
  if (needsPassword && typeof sudoAsk === 'function') sudoAsk('Its installer needs your password (sudo) — you type it, never the agent.', pw => { if (pw != null) run(pw); });
  else run();
}

/** The agent's own model: the same save as Controls → DOCA ⚙. */
async function guidedUseModel(provider, model, i) {
  const st = document.getElementById(`guided-st-${i}`);
  try {
    await apiFetch('/api/harness/doca/config', { method: 'POST', body: { provider, model } });
    setStatus(st, `✓ DOCA's agent now uses ${model}`, 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}
