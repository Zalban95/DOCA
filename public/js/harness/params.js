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
  _harnessEscalateMount(id, h.config.escalateTo);
  harnessOllamaHint(id);   // the context Ollama really serves (harness/ollama-hint.js)
  _harnessFoldHint(id, h.foldWarning);
}

/** Under "Summarise at size": when the saved settings mean folding never fires (harness/fold-check.js). */
function _harnessFoldHint(id, text) {
  const field = document.getElementById(`hcfg-compactTokens-${id}`);
  if (!field) return;
  let hint = document.getElementById(`hcfg-foldhint-${id}`);
  if (!hint) {
    hint = Object.assign(document.createElement('small'), { id: `hcfg-foldhint-${id}`, className: 'harness-hint' });
    hint.style.color = 'var(--amber)';
    field.parentElement.appendChild(hint);
  }
  hint.textContent = text || '';
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
      <label>When a job is stuck</label>
      <div>
        <div class="hcfg-fallbacks" id="hcfg-escalate-${h.id}"></div>
        <button class="btn btn-xs" id="hcfg-escalate-add-${h.id}"
                onclick="harnessEscalateAdd(${jsArg(h.id)})">+ Try a stronger model</button>
        <small class="harness-hint">
          A work chat is stuck when the same step keeps failing the same way, or its turns stop doing anything.
          With a model here it gets <strong>one more try on it</strong> before it is reported blocked — the chat's
          model picker shows the switch and the Orchestrator is told. <strong>None is the default:</strong> a
          stronger model usually costs more, so this only happens if you choose one.
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
        tokensPerDay:     parseInt(val('tokensPerDay'), 10) || 0,
        shellTimeoutSec:  parseInt(val('shellTimeoutSec'), 10) || 60,
        historyTurns:   parseInt(val('historyTurns'), 10) || 0,
        summarizeAfter: parseInt(val('summarizeAfter'), 10) || 0,
        memoryLimit:    parseInt(val('memoryLimit'), 10) || 0,
        contextWindow:  parseInt(val('contextWindow'), 10) || 0,
        compactTokens:  parseInt(val('compactTokens'), 10) || 0,
        firstTokenTimeoutMs: parseInt(val('firstTokenTimeoutMs'), 10) || 0,
        failoverAfterMs: parseInt(val('failoverAfterMs'), 10) || 0,
        rateLimitRetries:   parseInt(val('rateLimitRetries'), 10) || 0,
        rateLimitMaxWaitMs: parseInt(val('rateLimitMaxWaitMs'), 10) || 0,
        fallbackChain:  _fallbacksRead(id),
        escalateTo:     _harnessEscalateRead(id),
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
    if (h) { h.config = data.config; h.foldWarning = data.foldWarning || null; }
    _harnessFoldHint(id, data.foldWarning);
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
