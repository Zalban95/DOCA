/* ═══════════════════════════════════════════════════════
   Harness tab: creating, editing and deleting a specialist.
   ═══════════════════════════════════════════════════════ */

// A definition is markdown (modules/agents/markdown.js): a short front matter —
// name, description, kits, tools, model — then the role in prose. The same shape
// as a Claude Code subagent file, which can be imported as it is.
const HC_AGENT_TEMPLATE = `---
name: my-specialist
description: What it is for, in one line — the Orchestrator reads this to decide when to send it.
kits: [files]
tools: [memory_search]
memory: false
maxSteps: 12
---
You are … (its role: what it does, how, and what it hands back).
`;

let _hcAgentEditing = null;

function hcAgentNew() { _hcAgentModal(HC_AGENT_TEMPLATE, null); }

async function hcAgentEdit(id) {
  try {
    const r = await fetch(`/api/harness/agents/${encodeURIComponent(id)}/export`);
    if (!r.ok) return appAlert(`No specialist called "${id}".`);
    _hcAgentModal(await r.text(), id);
  } catch (e) { appAlert(e.message); }
}

function _hcAgentModal(text, id) {
  const overlay = document.getElementById('hc-agent-overlay');
  const box     = document.getElementById('hc-agent-json');
  const title   = document.getElementById('hc-agent-title');
  if (!overlay || !box) return;
  _hcAgentEditing = id;
  title.textContent = id ? `Editing ${id}` : 'New specialist';
  box.value = text;
  const exp = document.getElementById('hc-agent-export');
  if (exp) { exp.style.display = id ? '' : 'none'; exp.href = id ? `/api/harness/agents/${encodeURIComponent(id)}/export` : '#'; }
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
  const text = document.getElementById('hc-agent-json').value;
  // JSON still works (an older definition pasted in); markdown is the format.
  let body;
  if (text.trim().startsWith('{')) {
    try { body = JSON.parse(text); } catch (e) { return setStatus(st, `Not valid JSON: ${e.message}`, 'err'); }
  } else body = { markdown: text };
  try {
    const url = _hcAgentEditing ? `/api/harness/agents/${encodeURIComponent(_hcAgentEditing)}` : '/api/harness/agents';
    const { agent } = await apiFetch(url, { method: 'POST', body });
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

/** Import definitions: a .md file (ours or a Claude Code subagent), or every .md in a folder. */
function hcAgentImport() {
  appChoose('Import specialists from markdown — ours, or Claude Code subagents (their tools are mapped onto kits).',
    [{ label: 'Cancel', value: null }, { label: 'A folder on this machine', value: 'folder' }, { label: 'A .md file', value: 'file', cls: 'btn-blue' }], v => {
      if (v === 'folder') return appPrompt('Folder of .md definitions (e.g. ~/.claude/agents):', f => _hcAgentImportSend({ folder: f }), '~/.claude/agents');
      if (v !== 'file') return;
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.md,text/markdown' });
      input.onchange = async () => { const f = input.files[0]; if (f) _hcAgentImportSend({ markdown: await f.text(), fileName: f.name }); };
      input.click();
    });
}

async function _hcAgentImportSend(body) {
  try {
    const { imported } = await apiFetch('/api/harness/agent-import', { method: 'POST', body });
    _hcLoadAgents();
    appAlert(imported.length ? imported.map(r => r.error ? `✗ ${r.file}: ${r.error}` : r.skipped ? `– ${r.id}: ${r.skipped}`
      : `✓ ${r.id}${r.kits?.length ? ` — kits ${r.kits.join(', ')}` : ''}${r.notes?.length ? ` (${r.notes.join('; ')})` : ''}`).join('\n') : 'No .md files there.');
  } catch (e) { appAlert(e.message); }
}
