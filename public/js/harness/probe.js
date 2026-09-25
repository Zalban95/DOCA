/* ═══════════════════════════════════════════════════════
   Harness settings on the Controls page: will this model call tools? One probe per
   rung, debounced and cached.
   ═══════════════════════════════════════════════════════ */

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
