/* ═══════════════════════════════════════════════════════
   Settings → Set-up: what the answers set up (modules/guided/plan.js).
   An install is a proposal, installed by the Install button through the
   same route as the Harness tray; a key is pasted, saved as Field → API keys
   saves it, then tested by listing the provider's models.
   ═══════════════════════════════════════════════════════ */

// Where a role's model is chosen once its provider works: the agent's own model is set from here.
let _guidedLastPlan = null;   // the plan drawn last: each key row's providers and their key pages
const _GUIDED_WHERE = { coding: 'Controls → the agent\'s ⚙ (or a specialist\'s own model)', vision: 'Settings → Harness → Vision', embeddings: 'Settings → Harness → Retrieval' };

function guidedPlanRender(p, applied) {
  const el = document.getElementById('guided-plan');
  if (!el) return;
  _guidedLastPlan = p;
  // The agent's model, whichever way this machine would get it, can also be one the person already runs elsewhere.
  const rows = p.steps.map((s, i) => (s.type === 'have' ? _guidedHaveRow(s)
    : (s.type === 'install' ? _guidedInstallRow(s, i, applied) : _guidedKeyRow(s, i)) + (s.role === 'chat' ? _guidedOwnRow(i) : ''))).join('');
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
    ? ` <button class="btn btn-xs" id="guided-use-${i}" style="display:${pr?.status === 'installed' ? '' : 'none'}" onclick="guidedUseModel('ollama', ${jsArg(s.id)}, ${i})">Use it for the agent</button>` : '';
  return `<div class="guided-step"><div class="guided-step-title">⬇ ${escHtml(s.label)} <span class="guided-muted">— ${escHtml(s.why)}</span></div>
    <div class="toolbar">${state}${use}<span class="status-line" id="guided-st-${i}"></span></div></div>`;
}

/** Already set up: the agent's model answers (whatever provider it is on). */
function _guidedHaveRow(s) {
  return `<div class="guided-step"><div class="guided-step-title">✓ ${escHtml(s.label)}: ${escHtml(s.model)} <span class="guided-muted">— on ${escHtml(s.provider)}, and it answers. Change it with ⚙ on its row in Controls.</span></div></div>`;
}

/** Or a model the person already runs (llama.cpp, vLLM, LM Studio, Ollama…) at an address: added as Field → API keys → + Add provider adds it. */
function _guidedOwnRow(i) {   // the advanced route: folded, so the common way (a key) is what a newcomer meets first
  return advancedFold(`<div class="guided-step" id="guided-own-${i}"><div class="guided-step-title">🖧 Or a model you already run <span class="guided-muted">— llama.cpp, vLLM, LM Studio, Ollama or any OpenAI-compatible server, by its address</span></div>
    <div class="form-row guided-key">
      ${_gField(`guided-own-url-${i}`, 'Address', 'Where the model server answers, usually ending in /v1, e.g. http://192.168.1.20:8080/v1. It is tested before anything is saved.', `<input class="input" autocomplete="off" placeholder="http://192.168.1.20:8080/v1" id="guided-own-url-${i}">`)}
      ${_gField(`guided-own-key-${i}`, 'Key', 'Only if the server asks for one. Most servers on your own machines do not: leave it empty.', `<input class="input" type="password" autocomplete="off" placeholder="if it needs one" id="guided-own-key-${i}">`)}
      ${_gField(`guided-own-name-${i}`, 'Its name', 'What it is called in your lists, e.g. My model at the office. Empty: "My model at" its address.', `<input class="input" autocomplete="off" placeholder="optional" id="guided-own-name-${i}">`)}
      <button class="btn btn-xs btn-blue" onclick="guidedOwnConnect(${i})">Connect and test</button></div>
    <span class="status-line" id="guided-own-st-${i}"></span>
    <div class="toolbar" id="guided-own-models-${i}"></div></div>`, { id: 'guided-own', label: 'Advanced — a model you already run, by its address' });
}

const _gField = (id, label, info, input) => `<div class="field"><label class="input-label" for="${id}">${label}${infoBtn(info)}</label>${input}</div>`;

function _guidedKeyRow(s, i) {
  if (!s.providers.length) return `<div class="guided-step"><div class="guided-step-title">✎ ${escHtml(s.label)}</div><div class="guided-muted">${escHtml(s.note || 'No provider serves this yet.')}</div></div>`;
  const first = s.providers.find(x => x.hasKey) || s.providers[0];
  const opts = s.providers.map(x => `<option value="${escHtml(x.id)}"${x === first ? ' selected' : ''}>${escHtml(x.label)}${x.hasKey ? ' — key already here' : ''}</option>`).join('');
  return `<div class="guided-step" id="guided-key-${i}" data-role="${escHtml(s.role)}"><div class="guided-step-title">🔑 ${escHtml(s.label)} <span class="guided-muted">— ${escHtml(s.why)}</span></div>
    <div class="form-row guided-key">
      ${_gField(`guided-key-prov-${i}`, 'Provider', 'The company whose models you would use for this. "Get a key" opens the page where it makes one; they bill you for what is used.', `<select class="input" id="guided-key-prov-${i}" onchange="guidedKeyProvider(${i})">${opts}</select>`)}
      <a class="btn btn-xs" target="_blank" rel="noopener" id="guided-key-link-${i}">Get a key ↗</a>
      ${_gField(`guided-key-in-${i}`, 'Key', 'Paste the key the provider gave you. It is saved on this machine (as under Field → API keys), then tested by listing the provider\'s models.', `<input class="input" type="password" autocomplete="off" placeholder="Paste the key here" id="guided-key-in-${i}">`)}
      <button class="btn btn-xs btn-blue" onclick="guidedKeyTest(${i})">Save and test</button></div>
    <span class="status-line" id="guided-st-${i}"></span>
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
         <button class="btn btn-xs btn-green" onclick="guidedUseModel(${jsArg(provider)}, document.getElementById('guided-key-model-${i}').value, ${i})">Use it for the agent</button>`
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
  const st = document.getElementById(String(i).startsWith('own-') ? `guided-own-st-${String(i).slice(4)}` : `guided-st-${i}`);
  try {
    const r = await apiFetch('/api/harness/doca/config', { method: 'POST', body: { provider, model } });
    // A local model's own pace (harness/provider-pace.js): said here, where it was chosen.
    setStatus(st, `✓ The agent now uses ${model}${r.paceText ? ` — it ${r.paceText}` : ''}`, 'ok');
    setTimeout(() => { if (document.getElementById('guided-plan')) guidedLoad(); }, 1500);   // Set-up then says it has a model
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * A model the person runs: tested first (POST /api/keys/test-provider saves nothing), and only a server that answers is
 * kept — under the provider already at that address when there is one, else a new one through the same route as
 * Field → API keys → + Add provider. Saving first added a provider on every try (deep test B, C3).
 */
async function guidedOwnConnect(i) {
  const st = document.getElementById(`guided-own-st-${i}`);
  const typedUrl = document.getElementById(`guided-own-url-${i}`).value.trim().replace(/\/+$/, ''), keyIn = document.getElementById(`guided-own-key-${i}`);
  if (!/^https?:\/\/[^\s/]+/i.test(typedUrl)) return setStatus(st, '✗ Give its address, like http://192.168.1.20:8080/v1', 'err');
  const apiKey = keyIn.value.trim();
  try {
    setStatus(st, 'testing…', 'info');
    const t = await apiFetch('/api/keys/test-provider', { method: 'POST', body: { baseUrl: typedUrl, apiKey } });
    if (!t.ok) return setStatus(st, `✗ Not saved: ${t.error}. Check the address (most end in /v1) and that the server is running.`, 'err');
    const baseUrl = t.baseUrl;
    let name = t.existing;
    if (name) {
      if (apiKey) await apiFetch('/api/keys', { method: 'POST', body: { provider: name, apiKey } });
    } else {
      const known = await apiFetch('/api/keys').catch(() => ({}));
      const taken = [...(known.presets || []).map(p => p.id), ...Object.keys(known.providers || {})];
      name = guidedOwnName(baseUrl, document.getElementById(`guided-own-name-${i}`)?.value, taken);
      await apiFetch('/api/keys/add-provider', { method: 'POST', body: { name, baseUrl, apiKey } });
    }
    keyIn.value = '';
    const moved = baseUrl !== typedUrl ? ` (at ${baseUrl})` : '';
    setStatus(st, `✓ It answers${moved} — ${t.models.length} model${t.models.length === 1 ? '' : 's'}${t.existing ? `, kept as "${name}" as before` : `, saved as "${name}"`}`, 'ok');
    document.getElementById(`guided-own-models-${i}`).innerHTML = `<select class="input" id="guided-own-model-${i}">${t.models.map(m => `<option>${escHtml(m)}</option>`).join('')}</select>
      <button class="btn btn-xs btn-green" onclick="guidedUseModel(${jsArg(name)}, document.getElementById('guided-own-model-${i}').value, 'own-${i}')">Use it for the agent</button>`;
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * The name a person's own model is listed under: theirs if they gave one, else "My model at <host>" — it was
 * `own-172-17-0-1`, and a newcomer asked "who is own-172-17-0-1?" (self-test round two, C6). No slash or colon, which
 * separate a provider from its model and a grant's parts; never a name already taken (a preset's, another provider's),
 * so it cannot replace one.
 */
function guidedOwnName(baseUrl, typed, taken = []) {
  const where = String(baseUrl || '').replace(/^https?:\/\//i, '').split('/')[0];
  const host = where.startsWith('[') ? where.slice(1, where.indexOf(']')) : where.replace(/:\d+$/, '');   // [::1]:8080, or name:port
  const local = /^(localhost|127\.\d+\.\d+\.\d+|::1)$/i.test(host);
  let name = String(typed || '').trim() || (local ? 'My model on this machine' : `My model at ${host || 'another machine'}`);
  name = name.replace(/[/:\\]+/g, '-').replace(/\s+/g, ' ').slice(0, 60).trim();
  const lower = new Set(['ollama', ...taken].map(x => String(x).toLowerCase()));
  for (let n = 2, base = name; lower.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  return name;
}
