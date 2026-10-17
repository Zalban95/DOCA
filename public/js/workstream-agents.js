/* Other agents on this machine, step by step (modules/outside-agents; asked 2026-10-15). A switch in the Workstream's
   bar and a card in Settings → System: off by default, the owner's. On, the Workstream says what Claude Code, Codex and
   Gemini CLI running here do — the commands they run and the files they edit — read from their own session records
   while the page is open, and received over OpenTelemetry on 127.0.0.1 while one of them runs. The card shows what was
   found, the receiver's state, and the lines to set in each agent (the hub never edits their configuration), each with
   a copy button. Host only; licensed as the feature `outside-agents`. */
const WSA = { data: null };

const _wsaShown = () => (typeof licenceFeatureOn !== 'function' || licenceFeatureOn('outside-agents'))
  && (typeof authHasRight !== 'function' || authHasRight('host'));

/** The Workstream bar's switch (drawn by workstream.js); its state comes with workstreamAgentsLoad(). */
function workstreamAgentsButtonHtml() {
  if (!_wsaShown()) return '';
  const on = !!WSA.data?.enabled;
  return `<label class="ws-agents-sw" title="Show what other agents on this machine do — Claude Code, Codex, Gemini CLI: their commands and the files they edit. Never their conversation."><input type="checkbox" class="switch" id="ws-agents-on"${on ? ' checked' : ''} onchange="workstreamAgentsSet({ enabled: this.checked })"> Other agents</label>`;
}

async function workstreamAgentsLoad() {
  if (!_wsaShown()) return null;
  try { WSA.data = await apiFetch('/api/workstream/agents'); } catch { WSA.data = null; return null; }
  const sw = document.getElementById('ws-agents-on');
  if (sw) sw.checked = !!WSA.data.enabled;
  _wsaCardDraw();
  return WSA.data;
}

async function workstreamAgentsSet(change) {
  try {
    WSA.data = await apiFetch('/api/workstream/agents', { method: 'POST', body: change });
    if (typeof pageShown === 'function' && pageShown('workstream') && typeof _wsHold === 'function') await _wsHold(true);
  } catch (e) { appAlert(`Could not save: ${e.message}`); }
  const sw = document.getElementById('ws-agents-on');
  if (sw) sw.checked = !!WSA.data?.enabled;
  _wsaCardDraw();
}

/** Settings → System: the card. */
async function outsideAgentsCard() {
  const panel = document.querySelector('#sp-system .scroll-y') || document.getElementById('sp-system');
  if (!panel || !_wsaShown()) return;
  if (!document.getElementById('outside-agents-card')) panel.append(Object.assign(document.createElement('div'), { className: 'card form-help-skip', id: 'outside-agents-card' }));
  await workstreamAgentsLoad();
}

function _wsaReceiver(d) {
  const r = d.receiver || {};
  if (!d.enabled || !d.otel) return '<span class="pt"></span> off';
  if (r.listening) return `<span class="pt pt-run"></span> listening on ${escHtml(`${r.listening.address}:${r.listening.port}`)} — ${escHtml((r.running || []).map(x => x.label).join(', ') || 'an agent')} running; ${r.counts?.steps || 0} steps received`;
  return `<span class="pt"></span> ${escHtml(r.why || 'not listening')}`;
}

function _wsaCardDraw() {
  const card = document.getElementById('outside-agents-card'), d = WSA.data;
  if (!card || !d) return;
  const found = d.agents.map(a => `<div class="tool-row" style="grid-template-columns:minmax(120px,auto) 1fr;align-items:center"><span class="tool-label"><b>${escHtml(a.label)}</b></span>
      <span class="tool-note" style="white-space:normal">${a.found ? `${a.found} session record${a.found === 1 ? '' : 's'} changed in the last 6 hours` : 'no recent session records'} <span style="color:var(--muted)">— ${escHtml(a.records)}</span></span></div>`).join('');
  const setup = d.setup.map((s, i) => `<div class="wsa-setup"><div><b>${escHtml(s.label)}</b> <span class="desc">in ${escHtml(s.where)}</span>
      <button class="btn btn-xs" onclick="outsideAgentsCopy(${i})" title="Copy these lines">Copy</button></div><pre class="wsa-pre">${escHtml(s.text)}</pre></div>`).join('');
  card.innerHTML = `<div class="card-title">Other agents on this machine</div>
    <p class="desc">Show in the Workstream what other agents running here do — Claude Code, Codex, Gemini CLI: the commands they run and the files they edit, with secrets masked. Never their conversation, thinking or what a tool gave back. Reading other programs' records is your decision; agents cannot switch this.</p>
    <label class="acc-check"><input type="checkbox" class="switch" id="wsa-enabled" data-leaf="outsideAgents.enabled"${d.enabled ? ' checked' : ''} onchange="workstreamAgentsSet({ enabled: this.checked })"> Other agents on this machine</label>
    <div class="desc" style="margin:6px 0">Session records: ${d.enabled ? (d.reading ? `<span class="pt pt-run"></span> reading ${d.files} while the Workstream is open` : 'read while the Workstream is open') : 'not read'} · steps said: ${d.counts.record} from records, ${d.counts.otel} over OpenTelemetry${d.counts.twice ? `, ${d.counts.twice} arrived twice and were said once` : ''}</div>
    ${found}
    <label class="acc-check" style="margin-top:8px"><input type="checkbox" class="switch" id="wsa-otel" data-leaf="outsideAgents.otel"${d.otel ? ' checked' : ''} onchange="workstreamAgentsSet({ otel: this.checked })"> Also receive their OpenTelemetry</label>
    <div class="desc" style="margin:4px 0">Receiver: ${_wsaReceiver(d)}. It listens on this machine only (127.0.0.1), and only while one of these agents runs; it closes a minute after the last one ends. Set each agent to send there:</div>
    ${advancedFold(`${setup}<div class="info-row" style="margin-top:6px"><label class="desc">Port <input class="input" type="number" id="wsa-port" data-leaf="outsideAgents.otelPort" min="1024" max="65535" value="${Number(d.port)}" data-default="4318" style="width:96px"></label>
      <button class="btn btn-xs" onclick="workstreamAgentsSet({ otelPort: Number(document.getElementById('wsa-port').value) })">Save</button></div>`,
    { id: 'outside-agents-setup', label: `What to set in each agent — ${d.setup.length} agents` })}`;
  if (typeof advancedFoldRefresh === 'function') advancedFoldRefresh(card);
}

async function outsideAgentsCopy(i) {
  const s = WSA.data?.setup?.[i];
  if (!s) return;
  try { await navigator.clipboard.writeText(s.text); if (typeof undoToast === 'function') undoToast('Copied', null, { ms: 2500 }); } catch { appAlert(s.text); }
}
