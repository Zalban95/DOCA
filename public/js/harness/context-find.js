/* ═══════════════════════════════════════════════════════
   Harness ⚙ → Context window: what the model's own server reports
   (modules/harness/context-window.js), offered beside the box. Never written
   by itself — "Use it" fills the box, and Save is still the decision.
   ═══════════════════════════════════════════════════════ */

async function harnessContextFind(id, { onlyIfUnknown = false } = {}) {
  const field = document.getElementById(`hcfg-contextWindow-${id}`);
  if (!field) return;
  let line = document.getElementById(`hcfg-ctxfind-${id}`);
  if (!line) {
    line = Object.assign(document.createElement('small'), { id: `hcfg-ctxfind-${id}`, className: 'harness-hint' });
    field.parentElement.appendChild(line);
  }
  const ask = () => {
    line.textContent = '';
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-xs', textContent: 'Ask the server' });
    b.title = 'Read the window from the model\'s own server, if it reports one';
    b.addEventListener('click', () => harnessContextFind(id));
    line.appendChild(b);
  };
  const provider = document.getElementById(`hcfg-provider-${id}`)?.value;
  const model = (document.getElementById(`hcfg-model-${id}`)?.value || '').trim();
  if (!provider || !model || (onlyIfUnknown && Number(field.value) > 0)) return ask();

  line.textContent = 'Asking the server…';
  try {
    const r = await apiFetch(`/api/harness/context-window?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`);
    if (!r.tokens) {
      line.textContent = r.reached
        ? `${provider} does not report ${model}'s window; take it from the model card or the server's settings. `
        : `${provider} did not answer, so nothing could be asked. `;
      return;
    }
    line.textContent = `${r.source} reports ${r.tokens.toLocaleString()} tokens. `;
    if (Number(field.value) !== r.tokens) {
      const use = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-xs', textContent: `Use ${r.tokens}` });
      use.addEventListener('click', () => { field.value = r.tokens; field.dispatchEvent(new Event('change')); use.remove(); });
      line.appendChild(use);
    }
  } catch (e) {
    line.textContent = `Could not ask: ${e.message} `;
  }
}

/**
 * A fallback rung's window, offered the same way (2026-10-12): a rung that declares none sends a long conversation to a
 * model that cannot hold it, and a model whose server was set to a new context (Field → Models, the router's card)
 * leaves a stale number here. What the server reports is said beside the rung's box, with "Use N"; never written by
 * itself — Save is the decision.
 */
async function harnessRungWindow(rung) {
  const field = rung?.querySelector('[data-role=context-window]');
  const provider = (rung?.querySelector('[data-role=provider]')?.value || '').trim();
  const model = (rung?.querySelector('[data-role=model]')?.value || '').trim();
  if (!field || !provider || !model) return;
  let line = rung.querySelector('[data-role=ctxfind]');
  if (!line) { line = Object.assign(document.createElement('div'), { className: 'harness-hint' }); line.dataset.role = 'ctxfind'; field.closest('label').after(line); }
  try {
    const r = await apiFetch(`/api/harness/context-window?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`);
    const declared = Number(field.value) || 0;
    if (!r.tokens || declared === r.tokens) { line.textContent = ''; return; }
    line.textContent = declared
      ? `Its server now says ${r.tokens.toLocaleString()} tokens; this rung says ${declared.toLocaleString()}. `
      : `Its server says ${r.tokens.toLocaleString()} tokens; with 0 here a conversation longer than that is still sent to it. `;
    const use = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-xs', textContent: `Use ${r.tokens}` });
    use.addEventListener('click', () => { field.value = r.tokens; field.dispatchEvent(new Event('change')); line.textContent = ''; });
    line.appendChild(use);
  } catch { /* the probe says when the server cannot be reached */ }
}
