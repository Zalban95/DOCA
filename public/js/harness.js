/* ═══════════════════════════════════════════════════════
   DOCA PANEL — HARNESSES
   Controls page: one line per harness (default, install, ⚙ params, custom).
   Harness tab:   the default harness's workspace — the built-in agent's
                  console, or an embedded terminal for a CLI harness.
   ═══════════════════════════════════════════════════════ */

let _harnesses     = [];
let _harnessDflt   = null;
let _harnessMeta   = null;   // { providers, tools, defaults } — fetched once
let _harnessOpenCfg = null;  // id whose ⚙ strip is open
let _harnessTerm   = null;   // { id, term, fit, ws, ro }

/* ── Controls page: the lines ─────────────────────────── */

async function harnessLoad() {
  const list = document.getElementById('harness-list');
  if (!list) return;
  try {
    const data   = await apiFetch('/api/harness');
    _harnesses   = data.harnesses || [];
    _harnessDflt = data.default;
    _harnessRender();
  } catch (e) {
    list.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

/**
 * Metadata for the ⚙ panel (providers, tool switches, defaults).
 *
 * Pass `force` when opening the panel: the tool list is no longer fixed at boot
 * now that a running MCP server contributes to it, so a cached copy would offer
 * tools of a server that has since stopped.
 */
async function _harnessLoadMeta(force) {
  if (_harnessMeta && !force) return _harnessMeta;
  _harnessMeta = await apiFetch('/api/harness/providers');
  return _harnessMeta;
}

/**
 * The main list stays short: the harnesses actually on this machine, plus the
 * default even when it is missing. Everything else lives behind ⬇ Install.
 */
function _harnessRender() {
  const list = document.getElementById('harness-list');
  if (!list) return;

  const shown = _harnesses.filter(h => h.detected || h.isDefault || h.kind === 'custom');
  const label = document.getElementById('harness-default-label');
  const dflt  = _harnesses.find(h => h.isDefault);
  if (label) label.textContent = dflt ? `default: ${dflt.label}` : '';

  list.innerHTML = shown.map(_harnessRowHtml).join('')
    || '<div class="placeholder">No harness detected — use ⬇ Install a harness.</div>';

  if (_harnessOpenCfg && shown.some(h => h.id === _harnessOpenCfg)) harnessConfigToggle(_harnessOpenCfg, true);
}

function _harnessRowHtml(h) {
  const id  = h.id;
  const arg = jsArg(id);
  const badge = h.detected
    ? `<span class="tool-version">${escHtml(h.version || 'installed')}</span>`
    : `<span class="harness-missing">not installed</span>`;

  const actions = [
    h.isDefault
      ? '<span class="badge badge-green" style="font-size:9px">default</span>'
      : `<button class="btn btn-xs" onclick="harnessSetDefault(${arg})" title="Make this the harness DOCA talks to">Use</button>`,
    h.detected
      ? `<button class="btn btn-xs btn-green" onclick="harnessOpen(${arg})" title="Open it on the Harness tab">▶ Open</button>`
      : '',
    !h.detected && h.canInstall
      ? `<button class="btn btn-xs btn-teal" onclick="harnessInstall(${arg})">⬇ Install</button>`
      : '',
    h.detected && h.canInstall
      ? `<button class="btn btn-xs" onclick="harnessInstall(${arg})" title="Re-run the installer to update">↻</button>`
      : '',
    `<button class="btn btn-xs tool-gear" onclick="harnessConfigToggle(${arg})" title="Model and parameters">⚙</button>`,
    h.url ? `<a class="tool-repo" href="${escHtml(h.url)}" target="_blank" rel="noopener" title="${escHtml(h.url)}">docs</a>` : '',
    h.kind === 'custom'
      ? `<button class="btn btn-xs btn-red" onclick="harnessRemoveCustom(${arg})" title="Remove this custom harness">🗑</button>`
      : '',
  ].filter(Boolean).join('');

  return `<div class="harness-row ${h.detected ? 'harness-ok' : 'harness-off'} ${h.isDefault ? 'harness-default' : ''}" id="harness-row-${escHtml(id)}">
      <span class="harness-dot" title="${h.isDefault ? 'Default harness' : 'Not the default'}">${h.isDefault ? '●' : '○'}</span>
      <span class="harness-label">${escHtml(h.label)}</span>
      <span class="harness-vendor">${escHtml(h.vendor || '')}</span>
      ${badge}
      <span class="harness-note">${escHtml(h.note || h.cmd || '')}</span>
      <span class="tool-actions">${actions}</span>
    </div>
    <div class="tool-config-strip harness-cfg" id="harness-cfg-${escHtml(id)}" style="display:none"></div>`;
}

async function harnessSetDefault(id) {
  const st = document.getElementById('harness-status');
  try {
    await apiFetch('/api/harness/default', { method: 'POST', body: { id } });
    setStatus(st, '✓ Default harness updated', 'ok');
    await harnessLoad();
    _harnessConsoleReset();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

function harnessInstall(id) {
  const h = _harnesses.find(x => x.id === id) || _harnessCatalogFind(id);
  if (!h) return;
  const run = pw => _harnessRunInstall(id, pw);
  if (h.needsSudo) sudoAsk(`Installing "${h.label}" requires elevated privileges.`, pw => { if (pw !== null) run(pw); });
  else run(null);
}

async function _harnessRunInstall(id, password) {
  // Output goes to whichever box is on screen: the catalog modal when it is
  // open, otherwise the Controls card.
  const inModal = document.getElementById('harness-catalog-overlay')?.style.display !== 'none';
  const out = document.getElementById(inModal ? 'harness-catalog-out' : 'harness-install-out');
  showStream(out, '');

  const body = { };
  if (password !== null && password !== undefined) body.password = password;

  await sseStream(`/api/harness/${encodeURIComponent(id)}/install`, body, {
    onStatus: text => appendStream(out, text),
    onDone:   obj => { if (obj.ok) setTimeout(() => { harnessLoad().then(harnessCatalogRender); }, 1200); },
    onError:  e => appendStream(out, `\nError: ${e.message}`),
  });
}

async function harnessAddCustom() {
  const st    = document.getElementById('harness-status');
  const label = document.getElementById('harness-new-label');
  const cmd   = document.getElementById('harness-new-cmd');
  const inst  = document.getElementById('harness-new-install');
  if (!label.value.trim() || !cmd.value.trim()) {
    setStatus(st, 'A name and a command are required.', 'err');
    return;
  }
  try {
    await apiFetch('/api/harness/custom', { method: 'POST', body: {
      label: label.value.trim(), cmd: cmd.value.trim(), installCmd: inst.value.trim() || null,
    } });
    label.value = cmd.value = inst.value = '';
    setStatus(st, '✓ Harness added', 'ok');
    harnessLoad();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

function harnessRemoveCustom(id) {
  const h = _harnesses.find(x => x.id === id);
  appConfirm(`Remove the custom harness "${h?.label || id}"?`, async () => {
    try {
      await apiFetch(`/api/harness/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });
      harnessLoad();
    } catch (e) { setStatus(document.getElementById('harness-status'), `✗ ${e.message}`, 'err'); }
  });
}

function harnessOpen(id) {
  if (id !== _harnessDflt) { harnessSetDefault(id).then(() => nav('harness')); return; }
  nav('harness');
}

/* ── ⚙ Parameters strip ──────────────────────────────── */

async function harnessConfigToggle(id, keepOpen) {
  const strip = document.getElementById(`harness-cfg-${id}`);
  if (!strip) return;

  if (!keepOpen && strip.style.display !== 'none') {
    strip.style.display = 'none';
    _harnessOpenCfg = null;
    return;
  }

  _harnessOpenCfg = id;
  strip.style.display = 'flex';
  strip.innerHTML = '<div class="placeholder pulse" style="padding:4px">Loading…</div>';

  const h = _harnesses.find(x => x.id === id);
  if (!h) return;

  if (h.kind !== 'builtin') { strip.innerHTML = _harnessExternalCfgHtml(h); return; }

  const meta = await _harnessLoadMeta(true);
  strip.innerHTML = _harnessParamsHtml(h, meta);
  _harnessLoadModels(id, h.config.provider, h.config.model);
  _harnessFallbacksMount(id, h.config.fallbackChain);
}

/** External harnesses: how to launch them and where their own config lives. */
function _harnessExternalCfgHtml(h) {
  const c = h.config || {};
  return `
    <div class="harness-cfg-grid">
      <label>Launch command</label>
      <input class="input" id="hcfg-launch-${h.id}" value="${escHtml(c.launchCmd || h.cmd || '')}" placeholder="${escHtml(h.cmd || 'command')}">
      <label>Model</label>
      <input class="input" id="hcfg-model-${h.id}" value="${escHtml(c.model || '')}" placeholder="passed as --model when set">
      <label>Config file</label>
      <div style="display:flex;gap:6px">
        <input class="input flex1" id="hcfg-path-${h.id}" value="${escHtml(c.configPath || '')}" placeholder="${escHtml(h.configPathHint || '/path/to/config')}">
        <button class="btn btn-xs" title="Browse" onclick="fpOpen('hcfg-path-${h.id}','file')">📁</button>
        <button class="btn btn-xs btn-blue" title="Edit in the file manager" onclick="harnessEditConfigFile(${jsArg(h.id)})">✏</button>
      </div>
      <label>Environment</label>
      <textarea class="input" id="hcfg-env-${h.id}" rows="2" placeholder="KEY=VALUE (one per line) — exported before launch">${escHtml(c.env || '')}</textarea>
    </div>
    <div class="harness-cfg-actions">
      <button class="btn btn-xs btn-blue" onclick="harnessConfigSave(${jsArg(h.id)})">Save</button>
      <span class="status-line" id="hcfg-status-${h.id}"></span>
    </div>`;
}

/**
 * The provider dropdown, shared by the primary model and every fallback rung.
 *
 * The rungs are built after this panel is drawn, so they read `_harnessMeta`
 * rather than the `meta` the caller was handed — the two are the same object,
 * because `harnessConfigToggle` awaits `_harnessLoadMeta(true)` first.
 */
function _harnessProviderOpts(selected) {
  const list = _harnessMeta?.providers || [];
  const opts = list.map(p =>
    `<option value="${escHtml(p.id)}" ${p.id === selected ? 'selected' : ''}>` +
    `${escHtml(p.label)}${p.hasKey ? '' : ' — no key'}</option>`).join('');

  // A provider that has since been deleted from Settings → API Keys is still
  // what this box says. Without this the dropdown would fall back to the first
  // entry, and the next Save would quietly rewrite the chain to a provider the
  // user never chose — the same silent edit the text box was replaced to stop.
  // The engine already treats a rung naming a missing provider as a skip.
  if (selected && !list.some(p => p.id === selected))
    return `<option value="${escHtml(selected)}" selected>${escHtml(selected)} — not configured</option>${opts}`;

  return opts;
}

/** The built-in harness: model choice and the generation parameters. */
function _harnessParamsHtml(h, meta) {
  const c = h.config || {};
  const providerOpts = _harnessProviderOpts(c.provider);

/**
 * Every parameter of the built-in harness, in one place: what it is called, what
 * it does in plain words, and a range that is actually sensible.
 *
 * The descriptions used to be `title` attributes — present, correct, and
 * invisible unless you had a mouse and knew to hover. This panel is meant to be
 * usable by somebody who did not build it, so they are on screen.
 *
 * The ranges were written for an 8k-context model and had not moved since: 40
 * tool steps, 200 messages of history, 100 memory entries. Against a model with
 * a million-token window those are not limits, they are typos waiting to clamp
 * somebody's saved value back down to the maximum.
 *
 * When you add a parameter to `defaultParams()` in modules/harness/providers.js,
 * add it here too — otherwise it exists, does something, and has no way to be
 * set. That is exactly how `contextWindow` shipped without a box to type it in.
 */
const HARNESS_PARAMS = [
  { key: 'temperature', label: 'Temperature', attrs: 'min="0" max="2" step="0.05"',
    hint: 'How varied the answers are. Around 0.2 for work that should come out the same way twice; '
        + '0.7–1.0 for drafting, naming and ideas.' },

  { key: 'topP', label: 'Top P', attrs: 'min="0" max="1" step="0.05"',
    hint: 'A second, blunter variety control. Leave it at 1 and use Temperature — changing both at once '
        + 'makes the effect of either hard to judge.' },

  { key: 'contextWindow', label: 'Context window', unit: 'tokens', attrs: 'min="0" step="1000"',
    hint: 'How much the model can hold at once: these instructions, the conversation so far and everything '
        + 'its tools returned, tool descriptions and room for the reply. Use the served model\'s actual limit; '
        + 'local servers may be configured below the model\'s maximum. Requests estimated to exceed this '
        + 'are skipped before sending. 0 means unknown and disables this check and the percentages below.' },

  { key: 'maxTokens', label: 'Longest reply', unit: 'tokens', attrs: 'min="0" step="128"',
    hint: 'The most the model may write in one answer. 0 leaves it to the provider. This is a cap on the '
        + 'reply only; this much room is reserved when checking whether a request fits the context window.' },

  { key: 'firstTokenTimeoutMs', label: 'Give up waiting after', unit: 'ms', attrs: 'min="0" step="5000"',
    hint: 'How long to wait for the first word of a reply. This is not a limit on the answer — once the model '
        + 'starts talking it can take as long as it needs. It exists because a provider can accept the request, '
        + 'return OK and then never send anything, which otherwise looks exactly like a frozen panel. '
        + '0 waits forever.' },

  { key: 'failoverAfterMs', label: 'Try the next one after', unit: 'ms', attrs: 'min="0" step="1000"',
    hint: 'Only used when a fallback chain is set below. How long to wait on one entry before moving to the '
        + 'next. Much shorter than the setting above on purpose: waiting the full give-up time on every entry '
        + 'would make a chain slower than having none. The last entry always gets the full give-up time, so '
        + 'how long you wait in total is unchanged.' },

  { key: 'maxSteps', label: 'Max tool steps', attrs: 'min="1" max="1000" step="1"',
    hint: 'How many times the agent may use a tool and think again before it has to answer. Each step '
        + 're-sends the whole conversation, so this is the setting that decides what one answer can cost.' },

  { key: 'historyTurns', label: 'History window', unit: 'messages', attrs: 'min="2" max="5000" step="2"',
    hint: 'How many recent messages are sent word for word. Anything older is represented by the running '
        + 'summary instead — it is not lost, the full transcript is always kept on disk. The turn in progress '
        + 'is always sent whole, even past this number, so a long job never loses the request that started it.' },

  { key: 'summarizeAfter', label: 'Summarise after', unit: 'messages', attrs: 'min="0" max="5000" step="5"',
    hint: 'Once a conversation passes this many messages, the older half is replaced by a short summary. '
        + '0 never summarises, which is fine until a long conversation stops fitting.' },

  { key: 'compactTokens', label: 'Summarise at size', unit: 'tokens', attrs: 'min="0" step="1000"',
    hint: 'Summarise earlier turns once one step\'s prompt reaches this many tokens. It works with no context '
        + 'window set, and it applies even when one is: this and the percentage below are both live, and '
        + 'whichever is reached first wins. With a 1000000 window, 40000 fires at 4% — set this to 0 to let '
        + 'the percentage decide, or raise it. The turn in progress is never summarised, only earlier ones.' },

  { key: 'compactAt', label: 'Summarise at share', unit: '% of window', attrs: 'min="0" max="99" step="5"',
    hint: 'The same summarising, as a share of the context window above — whichever of this and the size '
        + 'above is reached first. Every step re-sends the whole prompt, so a high share of a large window '
        + 'is also a large bill per step. Needs a context window set above.' },

  { key: 'warnAt', label: 'Warn at', unit: '% of window', attrs: 'min="0" max="99" step="5"',
    hint: 'Where a "context is filling up" warning appears, for you and for the agent. Advisory only — it '
        + 'never stops an answer. Needs a context window set above.' },

  { key: 'memoryLimit', label: 'Memory entries', attrs: 'min="0" max="2000" step="1"',
    hint: 'How many remembered facts are put in front of the agent each turn. Pinned ones always come '
        + 'first, then whichever others match what you just asked.' },
];

  // MCP tools carry a readable label ("GitHub: create_issue"); the built-in ones
  // are named plainly enough to show as they are.
  const toolRows = (meta.tools || []).map(t => `
    <label class="harness-tool-toggle ${t.mcp ? 'harness-tool-mcp' : ''}" title="${escHtml(t.description)}">
      <input type="checkbox" id="hcfg-tool-${h.id}-${escHtml(t.name)}"
             ${(c.disabledTools || []).includes(t.name) ? '' : 'checked'}>
      <span>${escHtml(t.label || t.name)}</span>${t.danger ? '<em title="Can change the system">!</em>' : ''}
    </label>`).join('');

  const num = key => {
    const f = HARNESS_PARAMS.find(x => x.key === key);
    return `
      <label for="hcfg-${key}-${h.id}">${f.label}${f.unit ? ` <em style="opacity:.55;font-style:normal">(${f.unit})</em>` : ''}</label>
      <div>
        <input class="input" type="number" id="hcfg-${key}-${h.id}" value="${escHtml(c[key])}" ${f.attrs}
               style="width:100%">
        <small class="harness-hint">${escHtml(f.hint)}</small>
      </div>`;
  };

  return `
    <div class="harness-cfg-grid">
      <label>Provider</label>
      <div style="display:flex;gap:6px">
        <select class="input flex1" id="hcfg-provider-${h.id}" onchange="_harnessLoadModels(${jsArg(h.id)}, this.value)">${providerOpts}</select>
        <button class="btn btn-xs" onclick="nav('settings'); settingsSubNav('keys')" title="Add an API key">+ key</button>
      </div>
      <label>Model</label>
      <div style="display:flex;gap:6px">
        <select class="input flex1" id="hcfg-model-select-${h.id}" onchange="document.getElementById('hcfg-model-${h.id}').value=this.value">
          <option value="">loading…</option>
        </select>
        <input class="input flex1" id="hcfg-model-${h.id}" value="${escHtml(c.model || '')}" placeholder="model id">
      </div>
      ${HARNESS_PARAMS.map(f => num(f.key)).join('')}
      <label for="hcfg-systemPrompt-${h.id}">System prompt</label>
      <div>
        <textarea class="input harness-prompt" id="hcfg-systemPrompt-${h.id}" rows="5"
                  style="width:100%">${escHtml(c.systemPrompt || '')}</textarea>
        <small class="harness-hint">Standing instructions, read at the start of every conversation. The panel's
          own safety rules are added ahead of this and cannot be edited here.</small>
      </div>
      <label>Tools</label>
      <div>
        <div class="harness-tools">${toolRows}</div>
        <small class="harness-hint">What the agent is allowed to use. Unticking one hides it — it is a way to keep
          the agent focused, not a security boundary.</small>
      </div>
      <label>Fallback chain</label>
      <div>
        <div class="hcfg-fallbacks" id="hcfg-fallbacks-${h.id}"></div>
        <button class="btn btn-xs" id="hcfg-fallback-add-${h.id}"
                onclick="harnessFallbackAdd(${jsArg(h.id)})">+ Add another fallback</button>
        <small class="harness-hint">
          Who answers when the model above stops answering. Each entry is a provider and a model, the same
          way the model above is set; leaving the model blank means "the same model, at that provider".
          <strong>None is the default and means nothing changes.</strong> Order matters — each is tried in
          turn, and every switch is announced in the chat, because an answer that quietly came from a
          different model is worse than the outage it hides. A model that was quiet is given a short rest
          rather than being written off, so one that recovers starts being used again on its own. The line
          under each entry is whether that model will call tools: a fallback that only answers in prose
          cannot run the agent, it can only talk about it.
        </small>
      </div>
    </div>
    <div class="harness-cfg-actions">
      <button class="btn btn-xs btn-blue" onclick="harnessConfigSave(${jsArg(h.id)})">Save</button>
      <button class="btn btn-xs" onclick="harnessResetParams(${jsArg(h.id)})"
              title="Throw away these parameters and go back to the shipped ones">Reset</button>
      <span class="status-line" id="hcfg-status-${h.id}"></span>
    </div>`;
}

/**
 * Fill the model dropdown for the selected provider.
 *
 * `scope` is one fallback rung; without it this is the primary block above,
 * found by id exactly as before. The two are the same widget — a rung that
 * picked its models differently from the model it is a fallback for would be
 * a second thing to keep correct.
 */
async function _harnessLoadModels(id, provider, selected, scope) {
  const sel = scope ? scope.querySelector('[data-role=model-select]')
                    : document.getElementById(`hcfg-model-select-${id}`);
  const box = scope ? scope.querySelector('[data-role=model]')
                    : document.getElementById(`hcfg-model-${id}`);
  if (!sel) return;
  sel.innerHTML = '<option value="">loading…</option>';
  try {
    const data = await apiFetch(`/api/harness/models?provider=${encodeURIComponent(provider)}`);
    const cur  = selected ?? box?.value ?? '';
    const opts = (data.models || []).map(m =>
      `<option value="${escHtml(m)}" ${m === cur ? 'selected' : ''}>${escHtml(m)}</option>`);
    if (!sel.isConnected) return;            // the rung was removed while we waited
    sel.innerHTML = `<option value="">${data.models?.length ? '— pick a model —' : (data.error ? 'unreachable' : 'none found')}</option>${opts.join('')}`;
    if (data.error) sel.title = data.error;
  } catch (e) {
    if (sel.isConnected) sel.innerHTML = `<option value="">${escHtml(e.message)}</option>`;
  }
}

/**
 * Which tools are switched off, starting from what was already saved.
 *
 * Only tools with a checkbox on screen are decided here. An MCP server that has
 * stopped since the panel was drawn has no checkbox, and reading a missing one
 * as "unchecked" would quietly switch off every tool it offers — so that its
 * own switches come back as they were when it starts again.
 */
function _harnessDisabledTools(id, h) {
  const off = new Set(h?.config?.disabledTools || []);
  for (const t of _harnessMeta?.tools || []) {
    const box = document.getElementById(`hcfg-tool-${id}-${t.name}`);
    if (!box) continue;
    if (box.checked) off.delete(t.name); else off.add(t.name);
  }
  return [...off];
}

/* ── The fallback chain ───────────────────────────────── */

/**
 * A chain longer than this is a denial of service on yourself: every entry is
 * a wait the user pays before being told nothing answered.
 */
const HARNESS_MAX_FALLBACKS = 5;

/**
 * One rung: the same two pickers the primary model above uses.
 *
 * It was a textarea reading `provider/model`, one per line, which is fine for
 * whoever wrote the parser and wrong for everyone else — the provider has to
 * already exist in Settings → API Keys, and a typo silently dropped the entry
 * rather than saying so. Configured like the model above it, a wrong provider
 * is not expressible: the dropdown only offers ones that are really there.
 *
 * Roles instead of ids, because this widget repeats: `[data-role=provider]`,
 * `[data-role=model-select]`, `[data-role=model]`, `[data-role=verdict]`,
 * all scoped by `closest('[data-rung]')`.
 */
function _harnessRungHtml(id, preset = {}) {
  return `
    <div class="hcfg-rung" data-rung>
      <div class="hcfg-rung-head">
        <span class="hcfg-rung-n"></span>
        <button class="btn btn-xs" onclick="harnessFallbackRemove(this, ${jsArg(id)})"
                title="Remove this fallback">✕</button>
      </div>
      <div class="hcfg-rung-row">
        <select class="input flex1" data-role="provider"
                onchange="_harnessLoadModels(${jsArg(id)}, this.value, null, this.closest('[data-rung]'))">
          ${_harnessProviderOpts(preset.provider || '')}
        </select>
        <button class="btn btn-xs" onclick="nav('settings'); settingsSubNav('keys')"
                title="Add an API key">+ key</button>
      </div>
      <div class="hcfg-rung-row">
        <select class="input flex1" data-role="model-select"
                onchange="harnessRungPickModel(this)">
          <option value="">…</option>
        </select>
        <input class="input flex1" data-role="model" value="${escHtml(preset.model || '')}"
               placeholder="model id — blank uses the one above" oninput="harnessRungProbe(this)">
      </div>
      <label class="harness-hint">Context window (tokens)
        <input class="input" type="number" min="0" step="1000" data-role="context-window"
               value="${escHtml(String(Number(preset.contextWindow) > 0 ? preset.contextWindow : 0))}">
      </label>
      <div class="harness-hint">This fallback's served limit. 0 means unknown; it never inherits the primary model's window.
        The check estimates text and tool tokens plus the reply cap; it does not measure image tokens.</div>
      <div class="harness-hint hcfg-rung-verdict" data-role="verdict"></div>
    </div>`;
}

/** Append a rung. Called by the "+ Add another fallback" button, and on open. */
function harnessFallbackAdd(id, preset) {
  const box = document.getElementById(`hcfg-fallbacks-${id}`);
  if (!box || box.querySelectorAll('[data-rung]').length >= HARNESS_MAX_FALLBACKS) return null;

  const t = document.createElement('template');
  t.innerHTML = _harnessRungHtml(id, preset || {}).trim();
  const rung = t.content.firstElementChild;
  box.appendChild(rung);

  const provider = rung.querySelector('[data-role=provider]').value;
  if (provider) _harnessLoadModels(id, provider, preset?.model || '', rung);
  harnessFallbackRenumber(id);
  return rung;
}

/** The ✕ on a rung. Nothing is saved until Save, so this only edits the form. */
function harnessFallbackRemove(btn, id) {
  const rung = btn.closest('[data-rung]');
  if (!rung) return;
  // A check already in flight would otherwise paint its verdict into a detached
  // node, and — worse — be counted as this page-load's answer for that pair.
  clearTimeout(rung._probeTimer);
  rung.remove();
  harnessFallbackRenumber(id);
}

/** Renumber the rungs and hide the add button once the cap is reached. */
function harnessFallbackRenumber(id) {
  const box = document.getElementById(`hcfg-fallbacks-${id}`);
  if (!box) return;
  const rungs = [...box.querySelectorAll('[data-rung]')];

  rungs.forEach((r, i) => {
    const n = r.querySelector('.hcfg-rung-n');
    if (n) n.textContent = `Fallback ${i + 1}`;
  });

  const add = document.getElementById(`hcfg-fallback-add-${id}`);
  if (add) add.style.display = rungs.length >= HARNESS_MAX_FALLBACKS ? 'none' : '';
}

/** The dropdown picked a model: put it in the text box and check it. */
function harnessRungPickModel(sel) {
  const rung = sel.closest('[data-rung]');
  if (!rung) return;
  rung.querySelector('[data-role=model]').value = sel.value;
  harnessRungProbe(sel);
}

/** Draw the rungs a saved config already had, and check each one. */
function _harnessFallbacksMount(id, chain) {
  const box = document.getElementById(`hcfg-fallbacks-${id}`);
  if (!box) return;
  box.textContent = '';

  // All three fields travel, not just the pair: the rung renders `contextWindow`
  // and `_fallbacksRead` writes it back, so leaving it off here showed an empty
  // window on open and then saved that emptiness — deleting, silently, the served
  // limit of every rung in the chain on the next Save. It is carried the way the
  // reader carries it, so opening ⚙ and pressing Save is a fixed point on the
  // stored chain rather than a rewrite of it.
  const saved = Array.isArray(chain) ? chain.slice(0, HARNESS_MAX_FALLBACKS) : [];
  for (const e of saved) harnessFallbackAdd(id, { provider: e?.provider || '', model: e?.model || '',
    ...(Number(e?.contextWindow) > 0 ? { contextWindow: e.contextWindow } : {}) });

  // A configured rung is checked as the panel opens, and the cache means that
  // costs one call per pair per page-load rather than one per look at ⚙.
  for (const rung of box.querySelectorAll('[data-rung]')) {
    harnessRungProbe(rung.querySelector('[data-role=model]'));
  }
}

/**
 * The chain as the engine stores it: `[{ provider, model, contextWindow? }]`, in order.
 *
 * Same guarantees the text parser had — a rung nobody filled in is skipped
 * rather than rejected, a duplicate is dropped because a chain that lists the
 * same model twice waits for itself, and the cap holds. A rung with a provider
 * and no model is still valid: the engine reads that as "the same model, at
 * that provider".
 */
function _fallbacksRead(id) {
  const box = document.getElementById(`hcfg-fallbacks-${id}`);
  const out = [];

  for (const rung of box ? box.querySelectorAll('[data-rung]') : []) {
    const provider = (rung.querySelector('[data-role=provider]')?.value || '').trim();
    const model    = (rung.querySelector('[data-role=model]')?.value || '').trim();
    if (!provider) continue;
    if (out.some(e => e.provider === provider && e.model === model)) continue;
    const contextWindow = Number(rung.querySelector('[data-role=context-window]')?.value);
    out.push({ provider, model, ...(Number.isFinite(contextWindow) && contextWindow > 0
      ? { contextWindow: Math.floor(contextWindow) } : {}) });
    if (out.length >= HARNESS_MAX_FALLBACKS) break;
  }

  return out;
}

/* ── Will it call tools? ──────────────────────────────── */

/** Verdicts from this page-load, keyed `provider/model`. */
const _toolVerdicts = new Map();

const HARNESS_PROBE_DEBOUNCE_MS = 600;

/**
 * Ask whether a rung's model calls tools, and say so under the rung.
 *
 * Not a button: the answer is a property of the pair on screen, and a control
 * to fetch it is a control the user has to know to press. Debounced because a
 * model id is typed a character at a time, and cached because the answer does
 * not change within a page-load and each look at it is a real API call.
 */
function harnessRungProbe(el) {
  const rung = el?.closest('[data-rung]');
  if (!rung) return;
  clearTimeout(rung._probeTimer);

  const out      = rung.querySelector('[data-role=verdict]');
  const provider = (rung.querySelector('[data-role=provider]')?.value || '').trim();
  const model    = (rung.querySelector('[data-role=model]')?.value || '').trim();

  const say = v => {
    if (!out) return;
    out.className = 'harness-hint hcfg-rung-verdict';
    if (v.supported === true) {
      out.classList.add('ok');
      out.textContent = `✓ this model calls tools — ${v.detail}`;
    } else if (v.supported === false) {
      out.classList.add('warn');
      out.textContent = `✗ this model does not call tools — ${v.detail}`;
    } else {
      out.textContent = `? could not check — ${v.detail}`;
    }
  };

  // Half a rung is not a question yet, and asking about the provider's default
  // model would be answering about something the user has not chosen.
  if (!provider || !model) {
    if (out) { out.className = 'harness-hint hcfg-rung-verdict'; out.textContent = ''; }
    return;
  }

  const key = `${provider}/${model}`;
  if (_toolVerdicts.has(key)) return say(_toolVerdicts.get(key));

  if (out) { out.className = 'harness-hint hcfg-rung-verdict'; out.textContent = 'checking whether it can call tools…'; }

  rung._probeTimer = setTimeout(async () => {
    try {
      const v = await apiFetch(`/api/harness/tool-check?provider=${encodeURIComponent(provider)}`
        + `&model=${encodeURIComponent(model)}`);
      _toolVerdicts.set(key, v);
      // The rung may have been removed or the model changed while this was in
      // flight; a verdict about a model that is no longer on screen is worse
      // than none, and the cache above still holds it for when it comes back.
      if (rung.isConnected && (rung.querySelector('[data-role=model]')?.value || '').trim() === model) say(v);
    } catch (e) {
      if (rung.isConnected) say({ supported: null, detail: e.message });
    }
  }, HARNESS_PROBE_DEBOUNCE_MS);
}

async function harnessConfigSave(id) {
  const h  = _harnesses.find(x => x.id === id);
  const st = document.getElementById(`hcfg-status-${id}`);
  const val = key => document.getElementById(`hcfg-${key}-${id}`)?.value;

  const body = h?.kind === 'builtin'
    ? {
        provider:       val('provider'),
        model:          (val('model') || '').trim(),
        temperature:    parseFloat(val('temperature')),
        topP:           parseFloat(val('topP')),
        maxTokens:      parseInt(val('maxTokens'), 10) || 0,
        maxSteps:       parseInt(val('maxSteps'), 10) || 1,
        historyTurns:   parseInt(val('historyTurns'), 10) || 0,
        summarizeAfter: parseInt(val('summarizeAfter'), 10) || 0,
        memoryLimit:    parseInt(val('memoryLimit'), 10) || 0,
        contextWindow:  parseInt(val('contextWindow'), 10) || 0,
        compactTokens:  parseInt(val('compactTokens'), 10) || 0,
        firstTokenTimeoutMs: parseInt(val('firstTokenTimeoutMs'), 10) || 0,
        failoverAfterMs: parseInt(val('failoverAfterMs'), 10) || 0,
        fallbackChain:  _fallbacksRead(id),
        compactAt:      parseInt(val('compactAt'), 10) || 0,
        warnAt:         parseInt(val('warnAt'), 10) || 0,
        systemPrompt:   val('systemPrompt') || '',
        disabledTools:  _harnessDisabledTools(id, h),
      }
    : {
        launchCmd:  (val('launch') || '').trim(),
        model:      (val('model')  || '').trim(),
        configPath: (val('path')   || '').trim(),
        env:        val('env') || '',
      };

  try {
    const data = await apiFetch(`/api/harness/${encodeURIComponent(id)}/config`, { method: 'POST', body });
    if (h) h.config = data.config;
    setStatus(st, '✓ Saved', 'ok');
    if (id === _harnessDflt) _harnessConsoleReset();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * Back to the shipped parameters — nothing to do with which harness is the
 * *default* one, which is what "default" means everywhere else on this page.
 * It saves as soon as it is confirmed, and the provider is part of what goes,
 * so say which one you have been left on instead of redrawing in silence.
 */
function harnessResetParams(id) {
  _harnessLoadMeta().then(meta => {
    const provider = (meta.providers || []).find(p => p.id === meta.defaults.provider);
    const label    = provider?.label || meta.defaults.provider;
    appConfirm(
      `Reset this harness to the shipped parameters? The provider goes back to ${label} and the chosen model is cleared.`,
      async () => {
        try {
          const data = await apiFetch(`/api/harness/${encodeURIComponent(id)}/config`, { method: 'POST', body: meta.defaults });
          const h = _harnesses.find(x => x.id === id);
          if (h) h.config = data.config;
          await harnessConfigToggle(id, true);
          setStatus(document.getElementById(`hcfg-status-${id}`), `↺ Reset — provider is ${label}, no model chosen`, 'warn');
        } catch (e) { setStatus(document.getElementById(`hcfg-status-${id}`), `✗ ${e.message}`, 'err'); }
      });
  });
}

function harnessEditConfigFile(id) {
  const p = document.getElementById(`hcfg-path-${id}`)?.value?.trim();
  if (!p) { appAlert('Enter a config file path first.'); return; }
  nav('files');
  setTimeout(() => {
    const dir = p.lastIndexOf('/') > 0 ? p.substring(0, p.lastIndexOf('/')) : '/';
    fmNavigate(dir);
    setTimeout(() => fmOpenEditor(p), 400);
  }, 200);
}

/* ── Catalog modal: install anything DOCA knows ───────── */

function _harnessCatalogFind(id) { return _harnesses.find(h => h.id === id); }

function harnessCatalogOpen() {
  document.getElementById('harness-catalog-overlay').style.display = 'flex';
  document.getElementById('harness-catalog-out').style.display = 'none';
  harnessCatalogRender();
  if (!_harnesses.length) harnessLoad();
}

function harnessCatalogClose(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('harness-catalog-overlay').style.display = 'none';
}

function harnessCatalogRender() {
  const list = document.getElementById('harness-catalog-list');
  if (!list) return;
  const q = (document.getElementById('harness-catalog-filter')?.value || '').toLowerCase();
  const rows = _harnesses.filter(h =>
    !q || `${h.label} ${h.vendor} ${h.id}`.toLowerCase().includes(q));

  list.innerHTML = rows.map(h => `
    <div class="harness-cat-row">
      <span class="harness-cat-status" style="color:${h.detected ? 'var(--green)' : 'var(--muted)'}">${h.detected ? '✓' : '○'}</span>
      <span class="harness-label">${escHtml(h.label)}</span>
      <span class="harness-vendor">${escHtml(h.vendor || '')}</span>
      <span class="harness-note">${escHtml(h.detected ? (h.version || 'installed') : (h.note || h.cmd || ''))}</span>
      <span class="tool-actions">
        ${h.canInstall
          ? `<button class="btn btn-xs ${h.detected ? '' : 'btn-teal'}" onclick="harnessInstall(${jsArg(h.id)})">${h.detected ? '↻ Update' : '⬇ Install'}</button>`
          : '<span class="tool-manual">manual install</span>'}
        ${h.isDefault ? '' : `<button class="btn btn-xs" onclick="harnessSetDefault(${jsArg(h.id)})">Use</button>`}
        ${h.url ? `<a class="tool-repo" href="${escHtml(h.url)}" target="_blank" rel="noopener">docs</a>` : ''}
      </span>
    </div>`).join('') || '<div class="placeholder">Nothing matches that filter.</div>';
}

/* ═══════════════════════════════════════════════════════
   HARNESS TAB — the default harness's workspace
   ═══════════════════════════════════════════════════════ */

/* The turn in flight in the Harness tab. Stop hangs up on the stream and the
   server ties the response closing to the turn's AbortController. */
let _hcTurn = null;

function hcStop() {
  if (!_hcTurn) return;
  _hcTurn.abort();
  const btn = document.getElementById('hc-send');
  const stopBtn = document.getElementById('hc-stop');
  if (btn) btn.style.display = '';
  if (stopBtn) stopBtn.style.display = 'none';
}

let _hcSession  = null;
let _hcMainSession = null;
let _hcArchived = false;
let _hcOrgPoll = null;
let _hcSelected = null;
let _hcBusy     = false;
let _hcRendered = null;   // harness id the shell is currently built for

function harnessTabInit() {
  if (!_harnesses.length) harnessLoad().then(_harnessConsoleBuild);
  else _harnessConsoleBuild();
}

function _harnessConsoleReset() {
  _hcRendered = null;
  _harnessTermClose();
  if (currentTab === 'harness') _harnessConsoleBuild();
}

function _harnessConsoleBuild() {
  const shell = document.getElementById('harness-console-shell');
  if (!shell) return;
  const h = _harnesses.find(x => x.isDefault);
  if (!h) { shell.innerHTML = '<div class="placeholder">No harness selected — pick one on the Controls page.</div>'; return; }
  if (_hcRendered === h.id) { if (h.kind === 'builtin') _hcLoadSessions(true); return; }
  _hcRendered = h.id;

  shell.innerHTML = h.kind === 'builtin' ? _hcBuiltinHtml(h) : _hcExternalHtml(h);
  if (h.kind === 'builtin') { _hcLoadSessions(); _hcLoadMemory(); _hcLoadProposals(); _hcLoadAgents(); _hcStatus(); _hcLoadApproval(); }
  else requestAnimationFrame(() => _harnessTermOpen(h));
}

/* ── Specialists and their missions ───────────────────── */

/* A mission runs in its own conversation, so nothing here ever blocks the one
   the user is typing in. That is also why this polls rather than streams: the
   bar is a status light, not a transcript, and the transcript it would be
   showing belongs to a conversation nobody has open. */
let _hcMissionPoll = null;

async function _hcLoadAgents() {
  const box = document.getElementById('hc-agents');
  const sw  = document.getElementById('hc-agents-on');
  if (!box) return;
  try {
    const data = await apiFetch('/api/harness/agents');
    if (sw) sw.checked = !!data.enabled;
    box.innerHTML = (data.agents || []).map(a => _hcAgentHtml(a, data.enabled)).join('')
      || '<div class="placeholder">No specialists defined</div>';
    _hcLoadMissions();
  } catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; }
}

function _hcAgentHtml(a, enabled) {
  if (a.broken) return `
    <div class="hc-agent bad" title="${escHtml(a.broken)}">
      <span class="hc-agent-id">${escHtml(a.id)}</span>
      <span class="hc-agent-note" style="color:var(--red)">unreadable definition</span>
    </div>`;
  const tools = (a.tools || []).length ? `${a.tools.length} tool${a.tools.length === 1 ? '' : 's'}` : 'no tools';
  return `
    <div class="hc-agent ${enabled ? '' : 'off'}" title="${escHtml(a.note || '')}">
      <span class="hc-agent-id">${escHtml(a.label || a.id)}</span>
      <span class="hc-agent-note">${escHtml(tools)}${a.builtin ? ' · shipped' : ''}</span>
      <button class="btn btn-xs" onclick="hcAgentEdit(${jsArg(a.id)})" title="Edit this definition">✎</button>
      <button class="btn btn-xs btn-red" onclick="hcAgentDelete(${jsArg(a.id)})"
              title="${a.builtin ? 'Revert to the shipped definition' : 'Delete'}">✕</button>
    </div>`;
}

async function hcAgentsEnable(on) {
  try {
    await apiFetch('/api/harness/agents/enable', { method: 'POST', body: { enabled: !!on } });
    _hcLoadAgents();
  } catch (e) { appAlert(e.message); }
}

async function _hcLoadMissions() {
  const bar = document.getElementById('hc-missions');
  if (!bar) return;
  let rows = [];
  try { rows = (await apiFetch('/api/harness/missions?limit=8')).missions || []; } catch { /* leave the bar as it was */ }

  if (!rows.length) { bar.style.display = 'none'; bar.innerHTML = ''; }
  else {
    bar.style.display = '';
    bar.innerHTML = rows.map(m => `
      <span class="hc-mission ${escHtml(m.state)}" title="${escHtml(m.task || '')}"
            onmouseenter="hcMissionPeek(${jsArg(m.id)}, this)" onmouseleave="hcMissionPeekHide()">
        <span class="hc-mission-dot"></span>
        ${escHtml(m.label || m.agentId)}
        <em>${m.state === 'running' ? `step ${m.steps || 0}` : escHtml(m.state)}</em>
        ${m.sessionId ? `<button class="btn btn-xs" onclick="hcOpenSession(${jsArg(m.sessionId)})">Chat</button>` : ''}
        <button class="btn btn-xs" onclick="hcMissionLog(${jsArg(m.id)})"
                title="Its whole log, which stays open and can be copied">log</button>
        ${m.state === 'running' ? '' : `
        <button class="btn btn-xs" onclick="hcMissionArchive(${jsArg(m.id)})"
                title="Put it away. The mission and its log are kept — this list is what is live, not everything that ever ran.">✕</button>`}
      </span>`).join('');
  }

  // Poll only while something is actually running, and stop when it is not:
  // a timer that outlives the thing it was watching is how a quiet panel ends
  // up making a request a second for the rest of the day.
  const busy = rows.some(m => m.state === 'running');
  if (busy && !_hcMissionPoll) _hcMissionPoll = setInterval(_hcLoadMissions, 3000);
  if (!busy && _hcMissionPoll) { clearInterval(_hcMissionPoll); _hcMissionPoll = null; }
}

/**
 * Put a finished mission away.
 *
 * Archived rather than deleted: the row and its log stay on disk, so the reason
 * a mission failed is still there to be read after the list has been tidied,
 * which is when that question is usually asked. `?all=1` brings them back.
 */
async function hcMissionArchive(id) {
  try {
    await apiFetch(`/api/harness/missions/${encodeURIComponent(id)}/archive`, { method: 'POST', body: {} });
    hcMissionPeekHide();
    _hcLoadMissions();
  } catch (e) { appAlert(e.message); }
}

/* ── Watching a specialist work ────────────────────────
   A mission runs with nobody watching it — that is the point of dispatching one
   — but "nobody watching" turned into "nowhere to look": the bar said `failed`
   and the reason was only in `agents/mission-*.jsonl` on the host. The log was
   always there (`GET /api/harness/missions/:id` returns the mission and its
   events); nothing drew it. Hovering peeks, the button opens it properly. */

/** One event as a line: what ran, and what came back. */
function _hcEventLine(e) {
  const at = String(e.at || '').slice(11, 19);
  if (e.type === 'tool_call')   return `${at}  → ${e.name}(${_hcPrettyArgs(e.args || {}).replace(/\s+/g, ' ').slice(0, 120)})`;
  if (e.type === 'tool_result') return `${at}  ← ${e.name}: ${String(e.result ?? '').replace(/\s+/g, ' ').slice(0, 200)}`;
  if (e.type === 'usage')       return `${at}  · step ${e.step}, ${e.totalTokens || 0} tokens`;
  if (e.type === 'error')       return `${at}  ✗ ${e.text || e.message || ''}`;
  return `${at}  ${e.type}${e.text ? `: ${String(e.text).slice(0, 200)}` : ''}`;
}

/** The mission, its outcome and its log, as the text a person would paste. */
function _hcMissionText(mission, events) {
  const m = mission || {};
  return [
    `${m.id} — ${m.label || m.agentId} — ${m.state}`,
    `task: ${m.task || ''}`,
    `steps: ${m.steps || 0}   tokens: ${m.tokens || 0}   started: ${m.startedAt || '?'}   ended: ${m.endedAt || '—'}`,
    m.error  ? `\nerror:\n${m.error}` : '',
    m.result ? `\nresult:\n${m.result}` : '',
    '', '— log —',
    ...(events || []).map(_hcEventLine),
  ].filter(l => l !== '').join('\n');
}

/* The peek: the last few lines, while the pointer is on the row. Fetched on
   hover rather than polled for every mission, because a bar of six missions
   polling their logs every three seconds is six requests a second for
   something nobody is looking at. */
let _hcPeekFor = null;

async function hcMissionPeek(id, anchor) {
  _hcPeekFor = id;
  let data;
  try { data = await apiFetch(`/api/harness/missions/${encodeURIComponent(id)}`); } catch { return; }
  if (_hcPeekFor !== id) return;                 // the pointer moved on while we asked

  const pop = document.getElementById('hc-mission-peek') || (() => {
    const el = document.createElement('div');
    el.id = 'hc-mission-peek';
    el.className = 'hc-mission-peek';
    document.body.appendChild(el);
    return el;
  })();

  const lines = (data.events || []).slice(-6).map(_hcEventLine);
  const head  = data.mission?.error ? `✗ ${data.mission.error}` : (data.mission?.result || data.mission?.task || '');
  // A failed mission usually logged the same error it ended with; saying it
  // twice in six lines wastes the half of them worth reading. With no error
  // there is nothing to look for, and it cannot be spelled as a default:
  // `includes('')` is true of every string.
  const logged = data.mission?.error && lines.some(l => l.includes(data.mission.error));
  const body   = head && logged ? lines : [head, ...lines];
  pop.textContent = body.filter(Boolean).join('\n') || 'nothing logged yet';

  const r = anchor.getBoundingClientRect();
  pop.style.display = 'block';
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top  = `${r.bottom + 6}px`;
}

function hcMissionPeekHide() {
  _hcPeekFor = null;
  const pop = document.getElementById('hc-mission-peek');
  if (pop) pop.style.display = 'none';
}

/* The log: stays open, refreshes itself while the mission is still running, and
   can be selected and copied — which is the whole reason it is a modal and not
   a bigger tooltip. */
let _hcLogFor = null;
let _hcLogPoll = null;

async function hcMissionLog(id) {
  _hcLogFor = id;
  hcMissionPeekHide();
  const overlay = document.getElementById('hc-mission-overlay');
  if (overlay) overlay.style.display = 'flex';
  await _hcMissionLogLoad();
  if (!_hcLogPoll) _hcLogPoll = setInterval(_hcMissionLogLoad, 3000);
}

async function _hcMissionLogLoad() {
  if (!_hcLogFor) return;
  const body  = document.getElementById('hc-mission-log');
  const title = document.getElementById('hc-mission-title');
  try {
    const data = await apiFetch(`/api/harness/missions/${encodeURIComponent(_hcLogFor)}`);
    const m = data.mission || {};
    if (title) title.textContent = `${m.label || m.agentId || 'Mission'} — ${m.state || '?'}`;
    if (body) {
      const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 20;
      body.textContent = _hcMissionText(m, data.events);
      if (atEnd) body.scrollTop = body.scrollHeight;   // follow a running one, leave a scrolled reader alone
    }
    // A finished mission has nothing more to say; stop asking.
    if (m.state !== 'running' && _hcLogPoll) { clearInterval(_hcLogPoll); _hcLogPoll = null; }
  } catch (e) {
    if (body) body.textContent = `Could not read the mission: ${e.message}`;
  }
}

function hcMissionLogClose(event) {
  if (event && event.target !== event.currentTarget) return;
  _hcLogFor = null;
  if (_hcLogPoll) { clearInterval(_hcLogPoll); _hcLogPoll = null; }
  const overlay = document.getElementById('hc-mission-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function hcMissionLogCopy(btn) {
  const body = document.getElementById('hc-mission-log');
  if (!body) return;
  try {
    await navigator.clipboard.writeText(body.textContent);
    if (btn) { const was = btn.textContent; btn.textContent = 'copied'; setTimeout(() => { btn.textContent = was; }, 1200); }
  } catch {
    // Clipboard permission is not guaranteed; selecting it is always allowed.
    const range = document.createRange();
    range.selectNodeContents(body);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }
}

/* A definition is a JSON file, and this edits it as one rather than as a form.
   The fields are few, they are documented in modules/agents/registry.js, and a
   form would have to be rewritten every time one is added — while the agent
   itself writes these files with no form at all. */
function hcAgentNew() {
  _hcAgentModal({
    id: '', label: '', note: '', role: '', tools: ['memory_search'],
    memory: false, environment: 'minimal', maxSteps: 12,
  }, true);
}

async function hcAgentEdit(id) {
  try {
    const { agents } = await apiFetch('/api/harness/agents');
    const a = agents.find(x => x.id === id);
    if (!a) return appAlert(`No specialist called "${id}".`);
    const { builtin, refusedTools, broken, ...def } = a;
    _hcAgentModal(def, false);
  } catch (e) { appAlert(e.message); }
}

function _hcAgentModal(def, isNew) {
  const overlay = document.getElementById('hc-agent-overlay');
  const box     = document.getElementById('hc-agent-json');
  const title   = document.getElementById('hc-agent-title');
  if (!overlay || !box) return;
  title.textContent = isNew ? 'New specialist' : `Editing ${def.id}`;
  box.value = JSON.stringify(def, null, 2);
  setStatus(document.getElementById('hc-agent-status'), '', '');
  overlay.style.display = 'flex';
  setTimeout(() => box.focus(), 50);
}

function hcAgentClose(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('hc-agent-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function hcAgentSave() {
  const st = document.getElementById('hc-agent-status');
  let def;
  try { def = JSON.parse(document.getElementById('hc-agent-json').value); }
  catch (e) { return setStatus(st, `Not valid JSON: ${e.message}`, 'err'); }
  try {
    const url = def.id ? `/api/harness/agents/${encodeURIComponent(def.id)}` : '/api/harness/agents';
    const { agent } = await apiFetch(url, { method: 'POST', body: def });
    // The panel says what it refused rather than saving a definition quietly
    // different from the one that was typed.
    if (agent.refusedTools?.length)
      setStatus(st, `Saved. Removed tools a specialist may never have: ${agent.refusedTools.join(', ')}.`, 'warn');
    else setStatus(st, '✓ Saved', 'ok');
    _hcLoadAgents();
    if (!agent.refusedTools?.length) setTimeout(hcAgentClose, 700);
  } catch (e) { setStatus(st, e.message, 'err'); }
}

function hcAgentDelete(id) {
  appConfirm(`Delete the definition for "${id}"? A shipped one reverts rather than disappearing.`, async () => {
    try { await apiFetch(`/api/harness/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }); _hcLoadAgents(); }
    catch (e) { appAlert(e.message); }
  });
}

/* ── Built-in harness console ─────────────────────────── */

function _hcBuiltinHtml(h) {
  return `
    <div class="hc-org-guide"><strong>Orchestrator → Work leaders → Specialists</strong>
      <span>Your main chat reaches the Orchestrator. Work chats hold detailed execution and planning;
      specialists handle focused errands. Open any level here. Direct messages and results are reported upward.</span></div>
    <div class="hc-layout">
      <div class="hc-side">
        <div class="hc-side-head">
          Workspace
          <button class="btn btn-xs btn-blue" onclick="hcNewSession()">+ Work</button>
          <button class="btn btn-xs" onclick="hcNewSession(true)">+ Plan</button>
        </div>
        <label class="hc-archive-switch"><input type="checkbox" onchange="_hcArchived=this.checked;_hcLoadSessions()"> Show archived chats</label>
        <div id="hc-sessions" class="hc-sessions"><div class="placeholder">Loading…</div></div>
        <div class="hc-side-head" style="margin-top:10px">
          Memory
          <button class="btn btn-xs" onclick="hcRulesOpen()" title="The categories and rules it keeps memory by">Rules</button>
          <button class="btn btn-xs" onclick="_hcLoadMemory()" title="Refresh">↺</button>
        </div>
        <div class="hc-memory-add">
          <input class="input" id="hc-mem-key" placeholder="key" onkeydown="if(event.key==='Enter') hcMemWrite()">
          <input class="input" id="hc-mem-value" placeholder="what to remember" onkeydown="if(event.key==='Enter') hcMemWrite()">
          <button class="btn btn-xs btn-blue" onclick="hcMemWrite()">+</button>
        </div>
        <div id="hc-memory" class="hc-memory"><div class="placeholder">Loading…</div></div>

        <div class="hc-side-head" style="margin-top:10px">
          Specialists
          <label class="hc-agents-switch" title="Enable specialist missions for work leaders. Existing work chats remain available.">
            <input type="checkbox" id="hc-agents-on" onchange="hcAgentsEnable(this.checked)">
            <span>on</span>
          </label>
          <button class="btn btn-xs btn-blue" onclick="hcAgentNew()" title="Define a new specialist">+</button>
        </div>
        <div id="hc-agents" class="hc-agents"><div class="placeholder">Loading…</div></div>
      </div>

      <div class="hc-main">
        <div class="hc-head">
          <span class="hc-title" id="hc-session-title">${escHtml(h.label)}</span>
          <span class="badge badge-blue" id="hc-model-badge" style="font-size:9px">…</span>
          <span class="ctx-slot" id="hc-context"></span>
          <span class="hc-usage" id="hc-usage" title="Tokens today (UTC), every model call: steps, summaries and one-off asks. GET /api/harness/usage for the breakdown."></span>
          <span class="status-line" id="hc-status"></span>
          <div class="toolbar-right">
            <span id="hc-approval"></span>
            <button class="btn btn-xs" onclick="hcApprovalOpen()" title="What may run without asking">Approvals</button>
            <button class="btn btn-xs" onclick="hcEnvOpen()" title="Everything this agent is told about your machine">Context</button>
            <button class="btn btn-xs tool-gear" onclick="nav('controls'); harnessConfigToggle(${jsArg(h.id)}, true)" title="Model and parameters">⚙</button>
          </div>
        </div>
        <div id="hc-session-info" class="hc-session-info"></div>
        <div class="hc-missions" id="hc-missions" style="display:none"></div>
        <div class="hc-messages" id="hc-messages"><div class="placeholder">Ask it anything about this machine.</div></div>
        <div class="hc-proposals" id="hc-proposals"></div>
        <div class="hc-input-row">
          <span class="hc-caret">❯</span>
          <textarea class="input flex1 hc-input" id="hc-input" rows="1" placeholder="Message the harness…"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();hcSend();}"></textarea>
          <button class="btn btn-sm btn-amber" id="hc-send" onclick="hcSend()">Send</button>
          <button class="btn btn-sm btn-red" id="hc-stop" style="display:none" onclick="hcStop()"
                  title="Stop this turn. The step already running finishes; nothing after it starts.">■ Stop</button>
        </div>
      </div>
    </div>`;
}

/**
 * Draw, or settle, one approval request.
 *
 * Three states arrive on the same event: `asked` puts the card up, `answered`
 * settles it (which is how a card answered in the floating chat stops offering
 * a choice here), and `refused` is a mission that had nobody to ask.
 */
function _hcApproval(evt, box, scroll) {
  if (!box) return;
  box.querySelector('.placeholder')?.remove();
  // Out of the working fold and into the transcript: a collapsing run would
  // hide the question the turn is blocked on.
  agentWorkingGiveBack(box);

  if (evt.state === 'refused') {
    _hcAppend('error', `Not run — ${evt.tool} needs approval and a mission has nobody to ask.`, 'approval');
    scroll?.();
    return;
  }
  if (evt.state === 'answered') {
    box.querySelector(`[data-approval-id="${CSS.escape(evt.id)}"]`)?.settleFrom?.(evt.decision);
    // Answered elsewhere — the watch that started the turn, the floating chat,
    // another tab. The popup must not keep asking something already decided.
    approvalPopupClose(evt.id);
    scroll?.();
    return;
  }
  const card = approvalCardEl(evt, () => _hcLoadApproval());
  box.appendChild(card);
  // The card is the record; the popup is what gets answered. A blocked turn
  // whose question is three screens up reads as a hang.
  approvalPopup(evt, d => { card.settleFrom?.(d); _hcLoadApproval(); });
  scroll?.();
}

/** The Auto / Manual pill and the standing allowlist behind it. */
async function _hcLoadApproval() {
  const slot = document.getElementById('hc-approval');
  if (!slot) return;
  try {
    const a = await apiFetch('/api/harness/approval');
    _hcApprovalState = a;
    if (!slot.firstChild) slot.appendChild(approvalModeEl(s => { _hcApprovalState = s; _hcLoadApproval(); }));
    slot.firstChild.render(a.mode);
    const list = document.getElementById('hc-approval-list');
    if (list) _hcApprovalFill(list, a);
  } catch { /* the pill simply does not appear */ }
}

let _hcApprovalState = null;

function _hcApprovalFill(list, a) {
  list.innerHTML = '';

  // Questions raised elsewhere — a turn a phone started, or one in a chat that
  // is not open. Without this they block until they time out with nothing on
  // screen anywhere, because the card only ever appears in the transcript that
  // was being watched when it was asked.
  if (a.pending?.length) {
    const head = document.createElement('div');
    head.className = 'hc-side-head';
    head.textContent = `Waiting for an answer (${a.pending.length})`;
    list.appendChild(head);
    for (const p of a.pending) list.appendChild(approvalCardEl(p, () => _hcLoadApproval()));
  }

  const head = document.createElement('div');
  head.className = 'hc-side-head';
  head.textContent = 'Allowed without asking';
  list.appendChild(head);

  if (!a.always.length) {
    const none = document.createElement('div');
    none.className = 'placeholder';
    none.textContent = 'Nothing yet — every tool call that does something is asked about.';
    list.appendChild(none);
    return;
  }
  for (const k of a.always) {
    const row = document.createElement('div');
    row.className = 'approval-key';
    const name = document.createElement('span');
    name.className = 'flex1';
    name.textContent = k;
    const drop = document.createElement('button');
    drop.className = 'btn btn-xs btn-red';
    drop.textContent = '✕';
    drop.title = 'Ask again next time';
    drop.addEventListener('click', () => hcApprovalForget(k));
    row.append(name, drop);
    list.appendChild(row);
  }
}

function hcApprovalOpen() {
  const overlay = document.getElementById('hc-approval-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _hcLoadApproval();
}

function hcApprovalClose() {
  const overlay = document.getElementById('hc-approval-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function hcApprovalForget(key) {
  try {
    await apiFetch(`/api/harness/approval/always/${encodeURIComponent(key)}`, { method: 'DELETE' });
    _hcLoadApproval();
  } catch (e) { appAlert(e.message); }
}

/** How full this session's context window is, next to the model badge. */
function _hcContext(u) {
  const el = document.getElementById('hc-context');
  if (el) el.innerHTML = contextRingHtml(u);
}

/** Today's tokens, next to the model badge. */
async function _hcLoadUsage() {
  const el = document.getElementById('hc-usage');
  if (!el) return;
  try {
    const { total } = await apiFetch('/api/harness/usage?days=1&by=kind');
    const tok = total.prompt + total.completion;
    const fmt = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
    el.textContent = total.calls
      ? `24h ${fmt(tok)} tok · ${total.calls} calls${total.cached ? ` · ${Math.round(total.cached / total.prompt * 100)}% cached` : ''}${total.estimated ? ' · ~est' : ''}`
      : '';
  } catch { el.textContent = ''; }
}

async function _hcStatus() {
  const sessionId = _hcSession;
  _hcLoadUsage();
  const badge = document.getElementById('hc-model-badge');
  const st    = document.getElementById('hc-status');
  try {
    const s = await apiFetch(`/api/harness/status${sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : ''}`);
    if (sessionId !== _hcSession) return;
    // This session's window, as it stands before anything is sent. Each chat
    // has its own, so it is redrawn on every session switch rather than left
    // showing the last one's.
    _hcContext(s.context);
    if (badge) {
      badge.textContent = s.model ? `${s.provider} / ${s.model}` : `${s.provider} / no model`;
      badge.className = `badge ${s.ready && s.reachable ? 'badge-green' : s.ready ? 'badge-amber' : 'badge-red'}`;
    }
    // Standing conditions, not events. "Pick a model" is true until you pick
    // one, and a warning that fades on its own reads as though the problem
    // went away. The third branch deliberately clears, because "nothing is
    // wrong" is the absence of the message rather than a message.
    if (!s.ready)          setStatus(st, 'Pick a model with ⚙ before sending.', 'warn', { clear: 0 });
    else if (!s.reachable) setStatus(st, `Provider unreachable — ${s.error || 'no response'}`, 'warn', { clear: 0 });
    else                   setStatus(st, '', '');
  } catch (e) {
    if (badge) { badge.textContent = 'error'; badge.className = 'badge badge-red'; }
    setStatus(st, e.message, 'err');
  }
}

async function _hcLoadSessions(refreshOnly = false) {
  const el = document.getElementById('hc-sessions');
  if (!el) return;
  try {
    const data = await apiFetch('/api/harness/sessions');
    _hcMainSession = data.main;
    const rows = data.sessions.filter(s => _hcArchived || !s.archivedAt);
    if (!rows.some(s => s.id === _hcSession)) _hcSession = rows.find(s => s.id === data.active)?.id || data.main;
    const drawn = new Set();
    const draw = (s, depth = 0) => {
      if (drawn.has(s.id)) return '';
      drawn.add(s.id);
      const role = s.kind === 'orchestrator' ? '1 · Orchestrator' : s.kind === 'specialist' ? '3 · Specialist' : '2 · Work leader';
      return `<div class="hc-session ${s.id === _hcSession ? 'active' : ''}" data-session="${escHtml(s.id)}"
        style="margin-left:${Math.min(2, depth) * 12}px" onclick="hcOpenSession(${jsArg(s.id)})">
        <span class="hc-session-title"><small>${role}${s.archivedAt ? ' · archived' : ''}</small>${escHtml(s.title)}</span>
        <span class="hc-session-meta">${escHtml(s.state)}${s.unread ? ` · ${s.unread} new` : ''}${s.plan?.state === 'proposed' ? ' · plan?' : ''}</span>
      </div>` + rows.filter(child => child.parentId === s.id).map(child => draw(child, depth + 1)).join('');
    };
    const main = rows.find(s => s.id === data.main);
    el.innerHTML = (main ? draw(main) : '') + rows.filter(s => !drawn.has(s.id)).map(s => draw(s)).join('');
    const selected = rows.find(s => s.id === _hcSession);
    const editing = document.activeElement?.closest('#hc-session-info');
    if (_hcSession && !_hcBusy && (!refreshOnly || !editing && selected?.updatedAt !== _hcSelected?.updatedAt)) await hcOpenSession(_hcSession, true);
    clearTimeout(_hcOrgPoll);
    _hcOrgPoll = setTimeout(() => {
      if (document.body.classList.contains('harness-tab')) _hcLoadSessions(true);
    }, 5000);
  } catch (e) {
    el.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

function hcNewSession(planning = false) {
  appPrompt(planning ? 'Name this planning chat' : 'Name this work chat', async title => {
    try {
      const { session } = await apiFetch('/api/harness/sessions', { method: 'POST', body: { title, planning } });
      _hcSession = session.id;
      await _hcLoadSessions();
    } catch (e) { appAlert(e.message); }
  }, planning ? 'Planning work' : 'Work chat');
}

async function hcOpenSession(id, skipReload) {
  if (_hcBusy && id !== _hcSession) return appAlert('Stop or finish this direct turn before switching conversations.');
  _hcSession = id;
  const box = document.getElementById('hc-messages');
  if (!box) return;
  try {
    if (!skipReload) await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    const data = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}`);
    if (_hcSession !== id) return;
    const changed = _hcSelected?.id !== id;
    _hcSelected = data.session;
    if (data.session.archivedAt && !_hcArchived) {
      _hcArchived = true;
      const toggle = document.querySelector('.hc-archive-switch input');
      if (toggle) toggle.checked = true;
    }
    _hcSessionInfo(data.session);
    if (changed) _hcStatus();
    box.innerHTML = '';
    if (data.session.summary) _hcAppend('summary', data.session.summary, 'Earlier in this conversation');
    data.messages.forEach(m => {
      if (m.role === 'tool') {
        (m.images || []).forEach(_hcAppendImage);
        _hcAppend('tool-result', m.content, m.name);
      }
      else if (m.role === 'assistant') {
        if (m.reasoning?.text) _hcAppend('thinking', m.reasoning.text);
        if (m.content) _hcAppendContent('assistant', m.content);
        (m.tool_calls || []).forEach(tc =>
          _hcAppend('tool-call', tc.function?.arguments || '', tc.function?.name));
      } else if (m.content) _hcAppend(m.role, m.content, m.from?.name);
      // The transcript stores when each row was written, and a rebuilt turn has
      // no other way to know how long it took — so the newest row carries it and
      // the summary reads the same as it did when the turn was watched. One
      // stamp per message is enough: the summary wants the span, not each row.
      if (m.at && box.lastElementChild) box.lastElementChild.dataset.at = m.at;
    });
    if (!box.children.length) box.innerHTML = '<div class="placeholder">Ask it anything about this machine.</div>';
    // A reopened conversation reads the way it looked when its last turn ended,
    // rather than as every step of every turn laid out again.
    collapseFoldRuns(box);
    document.querySelectorAll('#hc-sessions .hc-session').forEach(el =>
      el.classList.toggle('active', el.dataset.session === id));
  } catch (e) { box.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; }
}

function _hcSessionInfo(s) {
  const el = document.getElementById('hc-session-info');
  const title = document.getElementById('hc-session-title');
  if (!el) return;
  if (title) title.textContent = s.title;
  const isMain = s.id === _hcMainSession;
  const readonly = s.archivedAt || s.state === 'running';
  const input = document.getElementById('hc-input');
  if (input) {
    input.disabled = !!readonly;
    input.placeholder = s.archivedAt ? 'Recall this chat to continue' : s.state === 'running' ? 'Working — stop it before intervening' : isMain ? 'Message your Orchestrator…' : 'Message directly — superiors will be informed…';
  }
  document.getElementById('hc-send').disabled = !!readonly;
  const p = s.plan;
  el.innerHTML = `<div class="hc-session-toolbar">
    <span>${escHtml(s.kind)} · ${escHtml(s.state)} · ${escHtml(s.provider)} / ${escHtml(s.model || 'no model')} · ${Number(s.tokens || 0).toLocaleString()} tokens</span>
    ${!isMain ? `<button class="btn btn-xs" onclick="hcOpenSession(${jsArg(s.parentId || _hcMainSession)})">↑ Superior</button>` : ''}
    ${s.state === 'running' ? `<button class="btn btn-xs btn-red" onclick="hcSessionStop(${jsArg(s.id)})">Stop turn</button>` : ''}
    ${!isMain ? `<button class="btn btn-xs" onclick="hcSessionArchive(${jsArg(s.id)},${!s.archivedAt})">${s.archivedAt ? 'Recall' : 'Archive'}</button>` : ''}
  </div>
  <p class="hc-session-hint">${isMain ? 'Your main contact. Short decisions and reports here; detailed work stays with its leaders.' : 'Direct interaction: your message, the answer and any failure are flagged to the superior and Orchestrator.'}</p>
  ${s.brief ? `<details><summary>Latest brief</summary><p>${escHtml(s.brief)}</p></details>` : ''}
  ${s.lastError ? `<p class="hc-prop-note">${escHtml(s.lastError)}</p>` : ''}
  <details class="hc-plan" ${p?.state === 'proposed' ? 'open' : ''}>
    <summary>Plan${p ? ` · ${escHtml(p.state)} · revision ${p.revision}` : ' · none yet'}</summary>
    ${p ? `<strong>${escHtml(p.title)}</strong><ol>${p.steps.map((x, i) => `<li>${escHtml(x)} <small>· ${escHtml(p.progress?.[i + 1] || 'queued')}</small></li>`).join('')}</ol><p>${escHtml(p.note || '')}</p>` : '<p>Draft here, or ask this agent to plan the work.</p>'}
    ${p?.state === 'proposed' && !s.archivedAt ? `<div class="hc-plan-actions"><button class="btn btn-xs btn-green" onclick="hcPlanAction('approve',${p.revision})">Approve revision ${p.revision}</button><button class="btn btn-xs" onclick="hcPlanAction('reject',${p.revision})">Reject</button></div><small>Approval records your decision. Ask the responsible chat to execute when ready.</small>` : ''}
    ${!s.archivedAt ? `<details><summary>${p ? 'Edit as a new draft' : 'Create draft'}</summary>
      <input class="input" id="hc-plan-title" aria-label="Plan title" placeholder="Plan title" value="${escHtml(p?.title || '')}">
      <textarea class="input" id="hc-plan-steps" aria-label="Plan steps" rows="4" placeholder="One step per line">${escHtml((p?.steps || []).join('\n'))}</textarea>
      <textarea class="input" id="hc-plan-note" aria-label="Plan notes" rows="2" placeholder="Scope, decisions or acceptance criteria">${escHtml(p?.note || '')}</textarea>
      <button class="btn btn-xs" onclick="hcPlanDraft()">Save draft</button></details>
      ${p && p.state !== 'proposed' ? '<button class="btn btn-xs" onclick="hcPlanAction(\'propose\')">Propose for review</button>' : ''}` : ''}
  </details>
  <details><summary>Reports from below · ${(s.reports || []).filter(n => !n.readAt).length} unread by this agent</summary>
    <small>Reports enter its next turn. Opening this panel does not spend tokens or mark them read.</small>
    ${(s.reports || []).slice(-50).reverse().map(n => `<p class="hc-report"><button class="btn btn-xs" onclick="hcOpenSession(${jsArg(n.from)})">Open source</button> <strong>${escHtml(n.type)}</strong> · ${escHtml(n.by)} · ${escHtml(n.at)}${n.readAt ? ' · seen' : ' · unread'}<br>${escHtml(n.text)}</p>`).join('') || '<p>No reports yet.</p>'}
  </details>`;
}

async function hcSessionArchive(id, on) {
  try {
    await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST', body: { on } });
    await _hcLoadSessions();
  } catch (e) { appAlert(e.message); }
}

async function hcSessionStop(id) {
  try {
    await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} });
    await _hcLoadSessions();
  } catch (e) { appAlert(e.message); }
}

async function hcPlanAction(action, revision) {
  try {
    await apiFetch(`/api/harness/sessions/${encodeURIComponent(_hcSession)}/plan`, { method: 'POST', body: { action, revision } });
    await hcOpenSession(_hcSession, true);
  } catch (e) { appAlert(e.message); }
}

async function hcPlanDraft() {
  try {
    await apiFetch(`/api/harness/sessions/${encodeURIComponent(_hcSession)}/plan`, { method: 'POST', body: {
      action: 'draft', title: document.getElementById('hc-plan-title').value,
      steps: document.getElementById('hc-plan-steps').value.split('\n').map(s => s.trim()).filter(Boolean),
      note: document.getElementById('hc-plan-note').value,
    } });
    await hcOpenSession(_hcSession, true);
  } catch (e) { appAlert(e.message); }
}

function hcDeleteSession(id) {
  appConfirm('Delete this conversation and its transcript?', async () => {
    try {
      await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (_hcSession === id) _hcSession = null;
      _hcLoadSessions();
    } catch (e) { appAlert(e.message); }
  });
}

/**
 * One bubble in the transcript. `kind` is a message role or one of the
 * harness-specific kinds (tool-call, tool-result, summary, error, thinking).
 * Tool activity and thinking use collapsible folds (see agentFold).
 */
function _hcAppend(kind, text, label, opts = {}) {
  const box = document.getElementById('hc-messages');
  if (!box) return null;
  box.querySelector('.placeholder')?.remove();

  if (kind === 'tool-call' || kind === 'tool-result' || kind === 'thinking') {
    const fold = agentFold({
      kind,
      label: kind === 'thinking' ? (label || 'Thinking')
        : kind === 'tool-call'   ? `Command · ${label || 'tool'}`
        : `Result · ${label || 'tool'}`,
      body: kind === 'tool-call' ? _hcPrettyArgs(text) : (text == null ? '' : String(text)),
      active: !!opts.active,
      open: !!opts.open,
    });
    agentFoldMount(box, fold.el);
    box.scrollTop = box.scrollHeight;
    return fold;
  }

  const el = document.createElement('div');
  el.className = `hc-msg hc-${kind}`;
  if (label) {
    const tag = document.createElement('span');
    tag.className = 'hc-msg-tag';
    tag.textContent = label;
    el.appendChild(tag);
  }
  // A div, not a span: the assistant's prose is rendered as markdown, and
  // headings, lists and tables are block elements that cannot live in one.
  const body = document.createElement('div');
  body.className = 'hc-msg-body';
  // What the agent said is markdown and is rendered as markdown. Everything
  // else here is the literal text it is — a tool result, an error, a step
  // count — and re-typesetting those would be inventing structure.
  if (kind === 'assistant' && !opts.plain) mdInto(body, text);
  else body.textContent = text;
  el.appendChild(body);
  // What the agent says mid-turn is part of the working and joins the block;
  // the user's own message is what starts a turn, so it never does.
  if (kind === 'user') box.appendChild(el);
  else agentWorkingMount(box, el);
  box.scrollTop = box.scrollHeight;
  return body;
}

/** A picture the agent showed, between its Command and Result folds. */
function _hcAppendImage(image) {
  const box = document.getElementById('hc-messages');
  if (!box || !image?.name) return;
  box.querySelector('.placeholder')?.remove();
  const scroll = () => { box.scrollTop = box.scrollHeight; };
  // The sentence the picture is shown under comes out of the turn's account
  // first, so the picture lands below it rather than below the whole turn.
  // A no-op on a reload, which has no open block. See `agentWorkingGiveBack`.
  agentWorkingGiveBack(box);
  box.appendChild(agentImageEl(image, scroll));
  scroll();
}

/** Pretty-print tool args JSON when it is valid; otherwise leave as-is. */
function _hcPrettyArgs(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object') return JSON.stringify(raw, null, 2);
  const s = String(raw);
  try { return JSON.stringify(JSON.parse(s), null, 2); }
  catch { return s; }
}

/** Reload an assistant/user message that may contain `<think>` blocks. */
function _hcAppendContent(role, content) {
  if (role !== 'assistant') {
    _hcAppend(role, content);
    return;
  }
  const box = document.getElementById('hc-messages');
  if (!box) return;
  renderThoughtfulContent(content, {
    mount: node => { box.querySelector('.placeholder')?.remove(); agentFoldMount(box, node); },
    makeText: text => { if (text) _hcAppend('assistant', text); },
  });
  box.scrollTop = box.scrollHeight;
}

async function hcSend() {
  const input = document.getElementById('hc-input');
  const btn   = document.getElementById('hc-send');
  const text  = input?.value.trim();
  if (!text || _hcBusy) return;

  _hcBusy = true;
  input.value = '';
  if (btn) btn.style.display = 'none';
  const stopBtn = document.getElementById('hc-stop');
  if (stopBtn) stopBtn.style.display = '';
  _hcTurn = new AbortController();
  _hcAppend('user', text);

  const box = document.getElementById('hc-messages');
  const scroll = () => { if (box) box.scrollTop = box.scrollHeight; };
  let pendingCall = null;
  let waitingRow  = null;
  // The last step's account of the turn: the ring follows it while the turn
  // runs, and the rate under the answer is read off it once the turn ends.
  let spend = null;

  // Everything this turn does goes in one block that shows its current row and
  // becomes one line when the turn ends.
  agentWorkingOpen(box);
  const stream = createThinkStream({
    mount: node => { box?.querySelector('.placeholder')?.remove(); if (box) agentFoldMount(box, node); scroll(); },
    makeText: () => _hcAppend('assistant', ''),
    scroll,
  });
  stream.startWaiting();

  await sseStream('/api/harness/chat', { message: text, sessionId: _hcSession }, {
    signal: _hcTurn.signal,
    onEvent: evt => {
      if (evt.type === 'session') _hcSession = evt.sessionId;
      if (evt.type === 'thinking') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        stream.feedThinking(evt.text);
      }
      if (evt.type === 'text') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        stream.feed(evt.text);
      }
      if (evt.type === 'tool_call') {
        stream.finish();
        stream.resetText();
        if (pendingCall) pendingCall.setActive(false);
        pendingCall = _hcAppend('tool-call', JSON.stringify(evt.args ?? {}), evt.name, { active: true });
      }
      if (evt.type === 'usage') { spend = evt; _hcContext(evt); }
      // A blocked tool call. The turn is waiting on the other side of this
      // card, so it goes in as its own row rather than into the working fold,
      // which collapses and would hide the thing being asked.
      if (evt.type === 'approval') _hcApproval(evt, box, scroll);
      if (evt.type === 'image') _hcAppendImage(evt.image);
      if (evt.type === 'tool_result') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        _hcAppend('tool-result', evt.result, evt.name);
        stream.startWaiting();
      }
      if (evt.type === 'error') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        stream.finish();
        _hcAppend('error', evt.text, 'error');
      }
      // The provider has the request and has not started answering. One row,
      // rewritten in place, because the alternative is a console that shows
      // nothing for ninety seconds and reads as broken.
      if (evt.type === 'waiting') {
        const note = `${evt.provider} has not sent a token yet — ${evt.seconds}s`
          + (evt.frames ? `, ${evt.frames} keep-alive frames` : '')
          + (evt.timeoutMs ? ` of ${Math.round(evt.timeoutMs / 1000)}s` : '');
        if (waitingRow) waitingRow.textContent = note;
        else waitingRow = _hcAppend('waiting', note, 'waiting');
      }
      // A hop down the fallback chain. It gets a row of its own and is never
      // quiet, because the answer that follows is not from the model the user
      // chose: read without this line, a smaller model's reply is taken for the
      // big one's, and the next investigation starts from a false premise.
      if (evt.type === 'failover') {
        if (waitingRow) { waitingRow.parentElement?.remove(); waitingRow = null; }
        _hcAppend('failover', evt.text, 'fallback');
        stream.startWaiting();   // the next rung has its own wait, and may be slow too
      }
      // Anything real from the model means the wait is over. `_hcAppend`
      // returns the body span, so the row is its parent.
      if (waitingRow && (evt.type === 'thinking' || evt.type === 'text' || evt.type === 'tool_call' || evt.type === 'usage')) {
        waitingRow.parentElement?.remove();
        waitingRow = null;
      }
      // Mid-turn, so the card is there to accept the moment the agent explains
      // it rather than after the whole answer has finished streaming.
      if (evt.type === 'proposal')    _hcLoadProposals();
    },
    onError: e => {
      if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
      stream.finish();
      _hcAppend('error', e.message, 'error');
    },
  });

  if (pendingCall) pendingCall.setActive(false);
  stream.finish();
  // The turn is over, so the rows it left open close: the account of a finished
  // run is a few short lines, each one a click away from the detail.
  closeFolds(box);
  agentWorkingClose(box);
  // After the fold closes, so the rate is the last thing under the answer
  // rather than a line the collapsing run swallows.
  const rate = tokenRateEl(spend);
  if (rate && box) { box.appendChild(rate); scroll(); }
  if (_hcTurn?.signal.aborted)
    _hcAppend('error', 'Stopped. The step already running finishes on its own; nothing after it starts.', 'stopped');

  _hcBusy = false;
  _hcTurn = null;
  if (btn) btn.style.display = '';
  if (stopBtn) stopBtn.style.display = 'none';
  _hcLoadSessions();
  _hcLoadMemory();
  _hcLoadProposals();
  _hcLoadUsage();
  input?.focus();
}

async function _hcLoadMemory() {
  const el = document.getElementById('hc-memory');
  if (!el) return;
  try {
    const { entries } = await apiFetch('/api/harness/memory');
    el.innerHTML = entries.map(e => `
      <div class="hc-mem ${e.pinned ? 'pinned' : ''}" title="${escHtml(e.value)}">
        <span class="hc-mem-key">${e.pinned ? '📌 ' : ''}${escHtml(e.key)}</span>
        <span class="hc-mem-val">${escHtml(e.value)}</span>
        <button class="btn btn-xs btn-red" onclick="hcMemForget(${jsArg(e.key)})" title="Forget">✕</button>
      </div>`).join('') || '<div class="placeholder">Nothing remembered yet</div>';
  } catch (e) {
    el.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`;
  }
}

async function hcMemWrite() {
  const key = document.getElementById('hc-mem-key');
  const val = document.getElementById('hc-mem-value');
  if (!key?.value.trim() || !val?.value.trim()) return;
  try {
    await apiFetch('/api/harness/memory', { method: 'POST', body: { key: key.value.trim(), value: val.value.trim() } });
    key.value = val.value = '';
    _hcLoadMemory();
  } catch (e) { appAlert(e.message); }
}

function hcMemForget(key) {
  appConfirm(`Forget "${key}"?`, async () => {
    try {
      await apiFetch(`/api/harness/memory/${encodeURIComponent(key)}`, { method: 'DELETE' });
      _hcLoadMemory();
    } catch (e) { appAlert(e.message); }
  });
}

/* ── The rules memory is kept by ──────────────────────── */

function hcRulesOpen() {
  const overlay = document.getElementById('hc-rules-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  _hcRulesFill();
}

async function _hcRulesFill(source) {
  const cats  = document.getElementById('hc-rules-cats');
  const rules = document.getElementById('hc-rules-list');
  // A review describes the text it was given, so it stops being true the
  // moment the editor is refilled with another version of the rules.
  _hcRulesReview(null);
  try {
    const doc = source || (await apiFetch('/api/harness/memory/rules')).rules;
    if (cats)  cats.value  = doc.categories.map(c => `${c.id}: ${c.description || ''}`.trim()).join('\n');
    if (rules) rules.value = doc.rules.join('\n');
    setStatus(document.getElementById('hc-rules-status'),
      doc.source === 'default' ? 'The rules DOCA ships with.'
        : `Last changed by the ${doc.source === 'agent' ? 'agent' : 'user'}.`, '');
  } catch (e) { setStatus(document.getElementById('hc-rules-status'), e.message, 'err'); }
}

function hcRulesClose(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('hc-rules-overlay');
  if (overlay) overlay.style.display = 'none';
}

/** `id: description` per line — the same shape the modal shows. */
function _hcParseCategories(text) {
  return text.split('\n').map(line => {
    const [id, ...rest] = line.split(':');
    return { id: (id || '').trim(), description: rest.join(':').trim() };
  }).filter(c => c.id);
}

/** What the two textareas currently say, in the shape both endpoints take. */
function _hcRulesDraft() {
  return {
    categories: _hcParseCategories(document.getElementById('hc-rules-cats').value),
    rules:      document.getElementById('hc-rules-list').value.split('\n').map(r => r.trim()).filter(Boolean),
  };
}

/**
 * Fill the review panel, or hide it with `null`.
 *
 * `head` and `text` are set as text and never as markup: `text` is prose a
 * model wrote, and the model is the one thing here nobody vouches for.
 */
function _hcRulesReview(text, head) {
  const box = document.getElementById('hc-rules-review');
  if (!box) return;
  box.textContent = '';
  if (text == null) { box.style.display = 'none'; return; }
  if (head) {
    const line = document.createElement('div');
    line.className = 'hc-rules-review-head';
    line.textContent = head;
    box.appendChild(line);
  }
  const body = document.createElement('div');
  body.className = 'hc-rules-review-text';
  body.textContent = text;
  box.appendChild(body);
  box.style.display = 'block';
}

async function hcRulesSave() {
  const st = document.getElementById('hc-rules-status');
  try {
    const { rules } = await apiFetch('/api/harness/memory/rules', {
      method: 'POST',
      body: _hcRulesDraft(),
    });
    _hcRulesFill(rules);
    setStatus(st, '✓ Saved — in force from the next message', 'ok');
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * Have the rules read back for conflicts, vague wording and gaps.
 *
 * The editor's own text is sent rather than what is stored, so a draft can be
 * checked before it is saved — and because the review writes nothing either
 * way, reading one is never a step towards a change nobody asked for. It goes
 * through a model, so it takes seconds: the button says so while it waits.
 */
async function hcRulesVerify() {
  const btn = document.getElementById('hc-rules-verify');
  const was = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Reading…'; }
  _hcRulesReview('Reading the rules — this goes through the model, so give it a few seconds.');
  try {
    const data = await apiFetch('/api/harness/memory/rules/verify', { method: 'POST', body: _hcRulesDraft() });
    const { categories, rules } = data.checked;
    _hcRulesReview(data.review || 'The model answered with nothing.',
      `${data.saved ? 'The saved rules' : 'The draft above, unsaved'} — `
      + `${categories} categor${categories === 1 ? 'y' : 'ies'}, ${rules} rule${rules === 1 ? '' : 's'} read. `
      + 'Nothing was changed.');
  } catch (e) {
    _hcRulesReview(null);
    appAlert(`Error: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = was; }
  }
}

function hcRulesReset() {
  appConfirm('Go back to the memory rules DOCA ships with? Anything you or the agent changed here is lost.',
    async () => {
      try {
        const { rules } = await apiFetch('/api/harness/memory/rules', { method: 'DELETE' });
        _hcRulesFill(rules);
        setStatus(document.getElementById('hc-rules-status'), '↺ Back to the shipped rules', 'warn');
      } catch (e) { setStatus(document.getElementById('hc-rules-status'), `✗ ${e.message}`, 'err'); }
    });
}

/* ── What the agent is told ───────────────────────────── */

async function hcEnvOpen() {
  const overlay = document.getElementById('hc-env-overlay');
  const out     = document.getElementById('hc-env-out');
  if (!overlay || !out) return;
  overlay.style.display = 'flex';
  out.textContent = 'Loading…';
  try {
    const data = await apiFetch(`/api/harness/environment?sessionId=${encodeURIComponent(_hcSession)}`);
    out.textContent = `${data.prompt || data.charter + '\n\n' + data.block}\n\n${data.readings || ''}\n\n${data.context ? `Estimated context: ${data.context.total} tokens; ${data.context.tools.count} tools; recent history cap ${data.context.transcript.kept} rows (current turn kept whole).` : ''}`;
  } catch (e) { out.textContent = e.message; }
}

function hcEnvClose(event) {
  if (event && event.target !== event.currentTarget) return;
  const overlay = document.getElementById('hc-env-overlay');
  if (overlay) overlay.style.display = 'none';
}

/* ── Settings the agent wants changed ─────────────────── */

async function _hcLoadProposals() {
  const box = document.getElementById('hc-proposals');
  if (!box) return;
  // Settings changes and installs share one tray on purpose: they are the same
  // question — the agent wants something done that only the user may do — and
  // two lists would mean two places to look for an unanswered one.
  const [props, inst] = await Promise.all([
    apiFetch('/api/harness/proposals').catch(() => ({ pending: [] })),
    apiFetch('/api/harness/installs').catch(() => ({ pending: [] })),
  ]);
  box.innerHTML = (props.pending || []).map(_hcProposalHtml).join('')
    + (inst.pending || []).map(_hcInstallHtml).join('');
}

/**
 * One thing the agent wants installed.
 *
 * It names the installer rather than a command, because that is the actual
 * safety property here: the agent chose from a catalog, and Accept runs the
 * same code the Models or Services tab runs when you click their buttons.
 * There is nothing in this card the user could not already have clicked, which
 * is what makes it a fair thing to be asked.
 */
function _hcInstallHtml(i) {
  return `
    <div class="hc-prop" id="hc-inst-${escHtml(i.id)}">
      <div class="hc-prop-head">
        <span class="badge badge-blue" style="font-size:9px">INSTALL</span>
        <span class="hc-prop-why">${escHtml(i.reason || 'The agent needs this to continue.')}</span>
      </div>
      <div class="hc-prop-row">
        <code class="hc-prop-key">${escHtml(i.kind)}</code>
        <span class="hc-prop-to">${escHtml(i.target)}</span>
      </div>
      <div class="hc-prop-note">${escHtml(i.what)}</div>
      ${i.needsPassword
        ? '<div class="hc-prop-note">Its installer needs sudo — you will be asked for your password, not the agent.</div>'
        : ''}
      <div class="hc-prop-actions">
        <span class="status-line" id="hc-inst-status-${escHtml(i.id)}"></span>
        <button class="btn btn-xs" onclick="hcInstallReject(${jsArg(i.id)})">Decline</button>
        <button class="btn btn-xs btn-green" onclick="hcInstallApply(${jsArg(i.id)})">${escHtml(i.verb || 'Install')}</button>
      </div>
    </div>`;
}

async function hcInstallApply(id) {
  const st = document.getElementById(`hc-inst-status-${id}`);
  setStatus(st, 'installing…', '');
  try {
    const { install } = await apiFetch(`/api/harness/installs/${encodeURIComponent(id)}/apply`,
      { method: 'POST', body: {} });
    if (install.status === 'installed') {
      setStatus(st, '✓ installed', 'ok');
      // Tools are rebuilt per step server-side, but the ⚙ panel's copy is not.
      _harnessLoadMeta(true);
    } else {
      setStatus(st, `✗ ${install.error || 'failed'}`, 'err');
    }
    setTimeout(_hcLoadProposals, 1500);
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

async function hcInstallReject(id) {
  const st = document.getElementById(`hc-inst-status-${id}`);
  try {
    await apiFetch(`/api/harness/installs/${encodeURIComponent(id)}/reject`, { method: 'POST', body: {} });
    _hcLoadProposals();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * One pending change, with the values it would replace.
 *
 * The old value is shown next to the new one for every key, because "accept"
 * has to be a decision about something visible: the agent proposing a path is
 * also the agent that would use it, and nobody should have to open Settings in
 * another tab to see what it is asking to overwrite.
 */
function _hcProposalHtml(p) {
  const rows = p.changes.map(c => `
    <div class="hc-prop-row">
      <code class="hc-prop-key">${escHtml(c.path)}</code>
      <span class="hc-prop-from">${escHtml(JSON.stringify(c.from))}</span>
      <span class="hc-prop-arrow">→</span>
      <span class="hc-prop-to">${escHtml(JSON.stringify(c.to))}</span>
    </div>`).join('');

  const notes = [...new Set(p.changes.map(c => c.note).filter(Boolean))];

  return `
    <div class="hc-prop" id="hc-prop-${escHtml(p.id)}">
      <div class="hc-prop-head">
        <span class="badge badge-amber" style="font-size:9px">SETTINGS CHANGE</span>
        <span class="hc-prop-why">${escHtml(p.reason || 'The agent suggests this change.')}</span>
      </div>
      ${rows}
      ${notes.map(n => `<div class="hc-prop-note">${escHtml(n)}</div>`).join('')}
      <div class="hc-prop-actions">
        <span class="status-line" id="hc-prop-status-${escHtml(p.id)}"></span>
        <button class="btn btn-xs" onclick="hcProposalReject(${jsArg(p.id)})">Decline</button>
        <button class="btn btn-xs btn-green" onclick="hcProposalApply(${jsArg(p.id)})">Accept</button>
      </div>
    </div>`;
}

async function hcProposalApply(id) {
  const st = document.getElementById(`hc-prop-status-${id}`);
  try {
    const data = await apiFetch(`/api/harness/proposals/${encodeURIComponent(id)}/apply`, { method: 'POST' });
    _hcAppend('summary', data.proposal.changes.map(c => `${c.path} = ${JSON.stringify(c.to)}`).join('\n'),
      data.restartNeeded ? 'Applied — restart the panel for it to take effect' : 'Applied');
    await _hcLoadProposals();
    // Paths and stats are drawn from prefs elsewhere in the panel; the pages
    // that show them read on open, so only this one needs telling.
    if (typeof settingsLoad === 'function' && currentTab === 'settings') settingsLoad();
  } catch (e) { setStatus(st, `✗ ${e.message}`, 'err'); }
}

/**
 * Decline, with the chance to say why.
 *
 * The reason is not politeness: it goes into the agent's context, which is what
 * stops it proposing the same thing again next turn. Declining without one is
 * still allowed — leaving the box empty should not cost anyone a click.
 */
function hcProposalReject(id) {
  appPrompt('Why not? The agent sees this, so it will not suggest it again. Leave it empty to just decline.',
    async reason => {
      try {
        await apiFetch(`/api/harness/proposals/${encodeURIComponent(id)}/reject`, {
          method: 'POST', body: { reason: reason || '' },
        });
        await _hcLoadProposals();
      } catch (e) { appAlert(e.message); }
    }, '', { allowEmpty: true });
}

/* ── External harness: an embedded terminal ───────────── */

function _hcExternalHtml(h) {
  const cmd = h.config?.launchCmd || h.cmd || '';
  return `
    <div class="card" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <div class="hc-head">
        <span class="hc-title">${escHtml(h.label)}</span>
        <span class="badge ${h.detected ? 'badge-green' : 'badge-red'}" style="font-size:9px">${escHtml(h.detected ? (h.version || 'installed') : 'not installed')}</span>
        <div class="toolbar-right">
          <button class="btn btn-xs btn-green" onclick="harnessTermLaunch()" ${h.detected ? '' : 'disabled'}>▶ Launch</button>
          <span class="hc-term-status" id="harness-term-status">○ ready</span>
          <button class="btn btn-xs tool-gear" onclick="nav('controls'); harnessConfigToggle(${jsArg(h.id)}, true)" title="Launch command and config">⚙</button>
        </div>
      </div>
      <p class="hc-term-hint">Runs <code>${escHtml(cmd || '(no launch command set)')}</code> in a shell on the host.
        ${h.kind === 'stack' ? 'Start and stop the stack itself from the Controls page.' : ''}</p>
      <div class="hc-term" id="harness-term"></div>
    </div>`;
}

function _harnessTermOpen(h) {
  const container = document.getElementById('harness-term');
  if (!container || _harnessTerm) return;

  if (typeof Terminal === 'undefined') {
    container.innerHTML = '<div style="padding:8px;font-size:11px;color:var(--muted)">xterm.js not loaded</div>';
    return;
  }

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: '"IBM Plex Mono", "Cascadia Code", "Fira Code", monospace',
    scrollback: 4000,
    theme: typeof getTerminalTheme === 'function' ? getTerminalTheme()
      : { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(container);
  requestAnimationFrame(() => { try { fit.fit(); } catch {} });

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws/harness?id=${encodeURIComponent(h.id)}`);
  _harnessTerm = { id: h.id, term, fit, ws };

  const statusEl = document.getElementById('harness-term-status');
  const setSt = (txt, color) => { if (statusEl) { statusEl.textContent = txt; statusEl.style.color = color; } };
  setSt('○ connecting…', 'var(--muted)');

  let opened = false;
  ws.onopen = () => {
    opened = true;
    setSt('● connected', 'var(--green)');
    try { fit.fit(); } catch {}
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };
  ws.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'output') term.write(msg.data);
      if (msg.type === 'exit') {
        term.writeln('\r\n\x1b[33m[session ended]\x1b[0m');
        setSt('○ disconnected', 'var(--red)');
      }
    } catch {}
  };
  ws.onclose = () => setSt('○ disconnected', 'var(--red)');
  ws.onerror = () => {
    if (!opened) { setSt('✗ node-pty missing', 'var(--red)'); ptyErrorBanner(container); }
    else term.writeln('\r\n\x1b[31m[connection error]\x1b[0m\r\n');
  };
  term.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d })); });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      if (!_harnessTerm) return;
      try {
        _harnessTerm.fit.fit();
        if (_harnessTerm.ws?.readyState === WebSocket.OPEN)
          _harnessTerm.ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      } catch {}
    });
    ro.observe(container);
    _harnessTerm.ro = ro;
  }
}

/** Type the harness's launch command (with its env and model) into the shell. */
function harnessTermLaunch() {
  const h = _harnesses.find(x => x.isDefault);
  if (!h) return;
  if (!_harnessTerm || _harnessTerm.ws?.readyState !== WebSocket.OPEN) {
    _harnessTermClose();
    _harnessTermOpen(h);
    setTimeout(harnessTermLaunch, 600);
    return;
  }
  const cfg = h.config || {};
  const env = (cfg.env || '').split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => `export ${l}`);
  const cmd = [cfg.launchCmd || h.cmd, cfg.model ? `--model ${cfg.model}` : ''].filter(Boolean).join(' ');
  _harnessTerm.ws.send(JSON.stringify({ type: 'input', data: [...env, cmd].join('\n') + '\n' }));
}

function _harnessTermClose() {
  if (!_harnessTerm) return;
  const t = _harnessTerm;
  _harnessTerm = null;
  if (t.ro)   { try { t.ro.disconnect(); } catch {} }
  if (t.ws)   { try { t.ws.close(); } catch {} }
  if (t.term) { try { t.term.dispose(); } catch {} }
}
