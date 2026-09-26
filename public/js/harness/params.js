/* ═══════════════════════════════════════════════════════
   Harness settings on the Controls page: the ⚙ parameters strip — what each field is,
   the models to pick from, saving, resetting.
   ═══════════════════════════════════════════════════════ */

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
  harnessOllamaHint(id);   // the context Ollama really serves (harness/ollama-hint.js)
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

  { key: 'autoTurnsPerJob', label: 'Turns a job may take on its own', attrs: 'min="0" max="500" step="1"',
    hint: 'A work chat keeps working until it reports the job done, failed, blocked or asks a question — or '
        + 'you or the Orchestrator stop it. When a turn ends short of that, the panel starts the next one; '
        + 'when its specialists finish, the panel wakes it. This is how many such turns one job may take '
        + 'before it is reported as stalled instead. 0 switches this off: work then waits to be asked.' },

  { key: 'autoWakesPerHour', label: 'Automatic turns per hour', attrs: 'min="0" max="1000" step="1"',
    hint: 'Every turn the panel starts by itself, across all work chats and the Orchestrator together. Each '
        + 'is a model call you pay for; past this many in an hour the panel waits instead, and says so.' },

  { key: 'shellTimeoutSec', label: 'Shell command limit', unit: 's', attrs: 'min="1" max="3600" step="1"',
    hint: 'How long one shell command may run before it is stopped. Longer work — a build, an install, a '
        + 'download — the agent runs in the background instead and checks on it, so this is not a cap on those.' },

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
        autoTurnsPerJob:  parseInt(val('autoTurnsPerJob'), 10) || 0,
        autoWakesPerHour: parseInt(val('autoWakesPerHour'), 10) || 0,
        shellTimeoutSec:  parseInt(val('shellTimeoutSec'), 10) || 60,
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
