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
    <div class="pj-chat-model chat-model-host" id="pj-chat-model"></div>
    <div class="pj-chat-msgs" id="pj-chat-msgs"></div>
    <div class="pj-chat-input">
      <textarea class="input" id="pj-chat-in" rows="2" placeholder="Ask about this project, or give it a job…"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();pjChatSend()}"></textarea>
      <button class="btn btn-sm btn-teal" id="pj-chat-send" onclick="pjChatSend()">Send</button>
    </div>`;
  chatModelPicker(document.getElementById('pj-chat-model'), PJC.sessionId);
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

/**
 * The model a conversation runs on, and whether it may fall back — a select and
 * a toggle, used by the project's chat and the Harness console
 * (POST /api/harness/sessions/:id/model, harness/turn/choice.js). Fallback
 * follows the harness's order from the chosen model onward.
 */
async function chatModelPicker(host, sessionId) {
  if (!host || !sessionId) return;
  if (host.dataset.session === sessionId && host.contains(document.activeElement)) return;   // being used: leave it open
  host.dataset.session = sessionId;
  let v;
  try { v = await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}/model`); } catch { host.innerHTML = ''; return; }
  const key = e => `${e.provider}/${e.model}`;
  const shown = e => (e.model ? key(e) : `${e.provider} · no model`);
  const chosen = v.choice?.model ? key(v.choice) : '';
  const opts = [`<option value="">Default · ${escHtml(shown(v.order[0]))}</option>`,
    ...v.order.slice(1).map(e => `<option value="${escHtml(key(e))}">${escHtml(key(e))}</option>`),
    ...(chosen && !v.order.some(e => key(e) === chosen) ? [`<option value="${escHtml(chosen)}">${escHtml(chosen)}</option>`] : []),
    '<option value="__other">Other…</option>'];
  host.innerHTML = `<select class="input chat-model" title="The model this conversation runs on">${opts.join('')}</select>
    <label class="chat-fallback" title="${escHtml(v.effective.fallback.length ? `Then: ${v.effective.fallback.join(' → ')}` : 'No fallback: the chosen model alone')}">
      <input type="checkbox" ${v.choice?.fallback === false ? '' : 'checked'}> fallback</label>`;
  const sel = host.querySelector('select'), box = host.querySelector('input');
  sel.value = chosen;
  const save = async (provider, model) => {
    try { await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}/model`, { method: 'POST', body: { provider, model, fallback: box.checked } }); }
    catch (e) { appAlert(e.message); }
    chatModelPicker(host, sessionId);
    if (typeof _hcStatus === 'function' && typeof _hcSession !== 'undefined' && _hcSession === sessionId) _hcStatus();
  };
  const split = val => { const i = val.indexOf('/'); return [val.slice(0, i), val.slice(i + 1)]; };
  sel.onchange = () => {
    if (sel.value === '__other') {
      sel.value = chosen;
      return appPrompt('Model for this conversation, as provider/model (e.g. openai/gpt-5.1):', val => {
        const [pr, m] = split(val);
        if (!pr || !m) return appAlert('Write it as provider/model.');
        save(pr, m);
      }, chosen || `${v.order[0].provider}/`);
    }
    const [pr, m] = sel.value ? split(sel.value) : ['', ''];
    save(pr, m);
  };
  box.onchange = () => { const [pr, m] = sel.value ? split(sel.value) : ['', '']; save(pr, m); };
}
