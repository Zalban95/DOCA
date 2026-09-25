/* ═══════════════════════════════════════════════════════
   Harness settings on the Controls page: the fallback chain, the models tried in order
   when the first stops answering.
   ═══════════════════════════════════════════════════════ */

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
