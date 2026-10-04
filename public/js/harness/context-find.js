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
