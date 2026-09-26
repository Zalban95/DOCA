/* ═══════════════════════════════════════════════════════
   Projects → the project's conversation, beside its files: the same work chat
   the Harness tab lists (bound to this project, so it works in its root and is
   told how it builds), drawn compactly — its words in full, its tool calls as
   one line each. "Open in Harness" shows the whole of it there.
   ═══════════════════════════════════════════════════════ */

const PJC = { sessionId: null, busy: false, turn: null };

function pjChatToggle() {
  const pane = document.getElementById('pj-chat');
  const open = !pane.classList.contains('open');
  pane.classList.toggle('open', open);
  document.getElementById('pj-chat-toggle').classList.toggle('btn-teal', open);
  if (open) pjChatLoad();
}

async function pjChatLoad() {
  const pane = document.getElementById('pj-chat');
  pane.innerHTML = '<div class="placeholder pulse">Opening the project\'s conversation…</div>';
  try { PJC.sessionId = (await apiFetch(`/api/projects/${encodeURIComponent(PJ.project.project.id)}/chat`, { method: 'POST' })).sessionId; }
  catch (e) { pane.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  pane.innerHTML = `
    <div class="pj-chat-head"><span>${escHtml(PJ.project.project.name)}</span><span class="pj-spacer"></span>
      <button class="btn btn-xs" onclick="pjChatOpenInHarness()" title="The whole conversation, in the Harness tab">↗ Harness</button></div>
    <div class="pj-chat-msgs" id="pj-chat-msgs"></div>
    <div class="pj-chat-input">
      <textarea class="input" id="pj-chat-in" rows="2" placeholder="Ask about this project, or give it a job…"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();pjChatSend()}"></textarea>
      <button class="btn btn-sm btn-teal" id="pj-chat-send" onclick="pjChatSend()">Send</button>
    </div>`;
  let data;
  try { data = await apiFetch(`/api/harness/sessions/${encodeURIComponent(PJC.sessionId)}`); } catch { return; }
  const box = document.getElementById('pj-chat-msgs');
  for (const m of (data.messages || []).slice(-60)) {
    if (m.role === 'user' || (m.role === 'assistant' && m.content)) _pjChatRow(m.role, m.content);
    for (const t of m.tool_calls || []) _pjChatRow('tool', t.function?.name || t.name || 'tool');
    for (const img of m.images || []) box.appendChild(agentImageEl(img));
  }
  if (!box.children.length) box.innerHTML = '<div class="placeholder">This project\'s work chat. It works in the project folder and knows how the project builds and tests.</div>';
  box.scrollTop = box.scrollHeight;
}

function _pjChatRow(role, text) {
  const box = document.getElementById('pj-chat-msgs');
  box?.querySelector('.placeholder')?.remove();
  const row = document.createElement('div');
  row.className = `pj-msg pj-msg-${role}`;
  if (role === 'assistant') mdInto(row, text || '');
  else row.textContent = role === 'tool' ? `⚙ ${text}` : text;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  return row;
}

async function pjChatSend() {
  const input = document.getElementById('pj-chat-in');
  const text = input.value.trim();
  if (!text || PJC.busy) return;
  PJC.busy = true;
  input.value = '';
  const send = document.getElementById('pj-chat-send');
  send.textContent = '■'; send.onclick = pjChatStop;
  _pjChatRow('user', text);
  let row = null, acc = '';
  PJC.turn = new AbortController();
  await sseStream('/api/harness/chat', { message: text, sessionId: PJC.sessionId }, {
    signal: PJC.turn.signal,
    onEvent: evt => {
      if (evt.type === 'text') { acc += evt.text; if (!row) row = _pjChatRow('assistant', ''); row.textContent = acc; }
      if (evt.type === 'tool_call') { if (row) { mdInto(row, acc); row = null; acc = ''; } _pjChatRow('tool', evt.name); }
      if (evt.type === 'image') document.getElementById('pj-chat-msgs').appendChild(agentImageEl(evt.image));
      if (evt.type === 'approval') {
        const box = document.getElementById('pj-chat-msgs');
        box.appendChild(approvalCardEl(evt, () => {}));
        box.scrollTop = box.scrollHeight;
      }
      if (evt.type === 'error') _pjChatRow('error', evt.text);
      if (evt.type === 'warning' || evt.type === 'failover') _pjChatRow('warning', evt.text);
    },
    onError: e => _pjChatRow('error', e.message),
  });
  if (row) { row.innerHTML = ''; mdInto(row, acc); }
  PJC.busy = false; PJC.turn = null;
  send.textContent = 'Send'; send.onclick = pjChatSend;
  // The agent may have changed files: refresh what the side shows, reload clean editors.
  pjRefresh();
  if (PJ.view === 'git' || PJ.view === 'files') pjView(PJ.view);
  for (const t of PJE.tabs) {
    if (!t.path || t.model.getAlternativeVersionId() !== t.saved) continue;
    try {
      const { content } = await apiFetch(`/api/files/read?path=${encodeURIComponent(t.path)}`);
      if (content !== t.model.getValue()) { t.model.setValue(content); t.saved = t.model.getAlternativeVersionId(); }
    } catch { /* deleted: the tab stays until closed */ }
  }
}

function pjChatStop() {
  PJC.turn?.abort();
  if (PJC.sessionId) apiFetch(`/api/harness/sessions/${encodeURIComponent(PJC.sessionId)}/stop`, { method: 'POST' }).catch(() => {});
}

function pjChatOpenInHarness() {
  nav('harness');
  setTimeout(() => { if (typeof hcOpenSession === 'function') hcOpenSession(PJC.sessionId); }, 300);
}
