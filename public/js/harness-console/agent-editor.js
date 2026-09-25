/* ═══════════════════════════════════════════════════════
   Harness tab: creating, editing and deleting a specialist.
   ═══════════════════════════════════════════════════════ */

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
