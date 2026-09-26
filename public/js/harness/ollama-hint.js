/* ═══════════════════════════════════════════════════════
   Harness ⚙ → Context window, for an Ollama model: the context Ollama really
   serves it with (modules/harness/ollama-context.js, ISSUES.md H-20), said
   under the field when the number typed is larger — the /v1 shim cannot be
   told a context size, so a larger declaration is cut silently.
   ═══════════════════════════════════════════════════════ */

async function harnessOllamaHint(id) {
  const field = document.getElementById(`hcfg-contextWindow-${id}`);
  if (!field) return;
  let hint = document.getElementById(`hcfg-ctxhint-${id}`);
  if (!hint) {
    hint = Object.assign(document.createElement('small'), { id: `hcfg-ctxhint-${id}`, className: 'harness-hint' });
    hint.style.color = 'var(--amber)';
    field.parentElement.appendChild(hint);
    field.addEventListener('change', () => harnessOllamaHint(id));
  }
  hint.textContent = '';
  const provider = document.getElementById(`hcfg-provider-${id}`)?.value;
  const model = document.getElementById(`hcfg-model-${id}`)?.value;
  if (provider !== 'ollama' || !model) return;
  try {
    const r = await apiFetch(`/api/harness/ollama-context?model=${encodeURIComponent(model)}&declared=${encodeURIComponent(field.value || 0)}`);
    hint.textContent = r.mismatch ? r.advice
      : r.effective ? `Ollama serves ${model} with ${r.effective} tokens${r.max ? ` (the model supports up to ${r.max})` : ''}.` : '';
    hint.style.color = r.mismatch ? 'var(--amber)' : '';
  } catch { /* Ollama not reachable: nothing to say */ }
}
