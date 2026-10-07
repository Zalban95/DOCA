/* ═══════════════════════════════════════════════════════
   Harness ⚙: what each provider was found to accept (modules/harness/contracts.js) — the token field, usage frames,
   how it is told to think — learned from one refused request and kept, so a quirk costs one failure, not one per call.
   Forget is for a provider that changed: the next request finds out again. (Audit 2026-10-06, coh F17; TODO C5b.)
   ═══════════════════════════════════════════════════════ */

const _HC_FACT = { tokenField: 'token field', streamUsage: 'usage while streaming', effortField: 'thinking effort field' };

function _harnessContractFacts(o) {
  return Object.entries(o || {}).filter(([k]) => _HC_FACT[k]).map(([k, v]) => `${_HC_FACT[k]}: ${v === false ? 'not sent' : String(v)}`).join(' · ');
}

async function harnessContractsMount(id) {
  const strip = document.getElementById(`harness-cfg-${id}`) || document.querySelector('.harness-cfg-actions')?.parentElement;
  const actions = strip?.querySelector('.harness-cfg-actions');
  if (!actions) return;
  // Two more cells of the label | field grid the rows above use (its CSS styles direct children), replaced on a redraw.
  const grid = actions.previousElementSibling || strip;
  let learned = {};
  try { learned = (await apiFetch('/api/harness/contracts')).learned || {}; } catch { return; }
  const rows = Object.entries(learned).map(([provider, p]) => {
    const models = Object.entries(p.models || {}).map(([m, f]) => `<div class="tool-note">${escHtml(m)} — ${escHtml(_harnessContractFacts(f))}</div>`).join('');
    return `<div class="tool-row" style="grid-template-columns:auto 1fr auto;align-items:center">
      <span class="tool-label">${escHtml(provider)}</span>
      <span class="tool-note" style="white-space:normal">${escHtml(_harnessContractFacts(p) || 'per model only')}${models}</span>
      <span class="tool-actions"><button class="btn btn-xs" title="The next request finds out again" onclick="harnessContractForget(${jsArg(id)}, ${jsArg(provider)})">Forget</button></span></div>`;
  }).join('');
  grid.querySelectorAll(':scope > .hcfg-contracts').forEach(e => e.remove());
  grid.insertAdjacentHTML('beforeend', `<label class="hcfg-contracts">What providers accept</label>
    <div class="hcfg-contracts">${rows || '<div class="tool-note">Nothing learned yet: every provider has taken requests as sent.</div>'}
      <small class="harness-hint">Found out when a provider refused a request and the retry worked, and sent that way from then on.
        Forget one when the provider changed (a new server version, a different model behind the same name).</small></div>`);
}

async function harnessContractForget(id, provider) {
  try { await apiFetch(`/api/harness/contracts/${encodeURIComponent(provider)}`, { method: 'DELETE' }); }
  catch (e) { return appAlert(e.message); }
  harnessContractsMount(id);
}
