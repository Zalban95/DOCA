/* ═══════════════════════════════════════════════════════
   Harness settings on the Controls page: the stronger model a stuck job gets
   one try on before it is called blocked (modules/harness/escalate.js).
   ═══════════════════════════════════════════════════════ */

/**
 * One rung, the same widget a fallback entry is (fallbacks.js), so the provider
 * can only be one that exists and the tool-calling check runs on it too. Zero
 * or one: an escalation is one model, not a chain.
 */
function harnessEscalateAdd(id, preset) {
  const box = document.getElementById(`hcfg-escalate-${id}`);
  if (!box || box.querySelector('[data-rung]')) return null;
  const t = document.createElement('template');
  t.innerHTML = _harnessRungHtml(id, preset || {}).trim();
  const rung = t.content.firstElementChild;
  rung.querySelector('.hcfg-rung-n').textContent = 'Stronger model';
  // The rung's ✕ is the fallback chain's; here it only has to take the rung away.
  const remove = rung.querySelector('.hcfg-rung-head button');
  remove.removeAttribute('onclick');
  remove.title = 'Switch escalation off';
  remove.addEventListener('click', () => { rung.remove(); _harnessEscalateButton(id); });
  box.appendChild(rung);
  const provider = rung.querySelector('[data-role=provider]').value;
  if (provider) _harnessLoadModels(id, provider, preset?.model || '', rung);
  _harnessEscalateButton(id);
  return rung;
}

function _harnessEscalateButton(id) {
  const add = document.getElementById(`hcfg-escalate-add-${id}`);
  const box = document.getElementById(`hcfg-escalate-${id}`);
  if (add && box) add.style.display = box.querySelector('[data-rung]') ? 'none' : '';
}

/** Draw the saved choice, if any, and check it. */
function _harnessEscalateMount(id, pick) {
  const box = document.getElementById(`hcfg-escalate-${id}`);
  if (!box) return;
  box.textContent = '';
  if (pick?.provider) {
    const rung = harnessEscalateAdd(id, { provider: pick.provider, model: pick.model || '',
      ...(Number(pick.contextWindow) > 0 ? { contextWindow: pick.contextWindow } : {}) });
    if (rung) harnessRungProbe(rung.querySelector('[data-role=model]'));
  }
  _harnessEscalateButton(id);
}

/** `{ provider, model, contextWindow? }`, or null when it is off. */
function _harnessEscalateRead(id) {
  const rung = document.getElementById(`hcfg-escalate-${id}`)?.querySelector('[data-rung]');
  const provider = (rung?.querySelector('[data-role=provider]')?.value || '').trim();
  if (!provider) return null;
  const model = (rung.querySelector('[data-role=model]')?.value || '').trim();
  const contextWindow = Number(rung.querySelector('[data-role=context-window]')?.value);
  return { provider, model, ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow: Math.floor(contextWindow) } : {}) };
}
