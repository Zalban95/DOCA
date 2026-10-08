/* ═══════════════════════════════════════════════════════
   Projects → the project's conversations, beside its files, as tabs (asked
   2026-10-04: "manage tabs like in a browser or Cursor … sub agents open in
   parallel tabs"). Each tab is a conversation bound to the project — the work
   chat the Harness tab lists, working in the project's root — with its own
   mode, approval switch and model (agent-ui/conv-bar.js), its own message
   area (so a turn running in a background tab keeps drawing in its own place),
   and what is lined up for it folded above the composer (agent-ui/side-fold.js).
   Tabs, their order and the sub-agents: projects/chat-tabs.js.
   ═══════════════════════════════════════════════════════ */

const PJC = { tabs: new Map(), open: [], active: null, chats: [], seen: new Set(), poll: null, fold: null };

function pjChatToggle() {
  const pane = document.getElementById('pj-chat');
  const open = !pane.classList.contains('open');
  pane.classList.toggle('open', open);
  document.getElementById('pj-chat-toggle').classList.toggle('btn-teal', open);
  if (open) pjChatLoad(); else pjChatReset({ keepTurns: true });
}

/** Leaving the project (or closing the pane): polling stops; turns are stopped only when the project changes. */
function pjChatReset({ keepTurns = false } = {}) {
  clearInterval(PJC.poll); PJC.poll = null;
  if (keepTurns) return;
  for (const t of PJC.tabs.values()) t.turn?.abort();
  PJC.tabs.clear(); PJC.open = []; PJC.active = null; PJC.chats = []; PJC.seen = new Set();
}

async function pjChatLoad() {
  const pane = document.getElementById('pj-chat');
  pane.innerHTML = '<div class="placeholder pulse">Opening the project\'s conversations…</div>';
  let first;
  try { first = (await apiFetch(`/api/projects/${encodeURIComponent(PJ.project.project.id)}/chat`, { method: 'POST' })).sessionId; }
  catch (e) { pane.innerHTML = `<div class="placeholder" style="color:var(--red)">${escHtml(e.message)}</div>`; return; }
  pane.innerHTML = `
    <div class="pj-chat-tabs" id="pj-chat-tabs" role="tablist"></div>
    <div class="pj-chat-bar conv-bar" id="pj-chat-bar"></div>
    <div class="pj-chat-stack" id="pj-chat-stack"></div>
    <div class="agent-fold" id="pj-chat-fold" hidden></div>
    <div class="pj-chat-input">
      <textarea class="input" id="pj-chat-in" rows="2" placeholder="Ask about this project, or give it a job…"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();pjChatSend()}"></textarea>
      ${typeof thinkToggleHtml === 'function' ? thinkToggleHtml('pj-chat-think') : ''}
      <button class="btn btn-sm btn-teal" id="pj-chat-send" onclick="pjChatSend()">Send</button>
      <button class="btn btn-sm btn-red" id="pj-chat-stop" onclick="pjChatStop()" style="display:none" title="Stop this tab's turn">■</button>
    </div>`;
  PJC.fold = agentSideFold(document.getElementById('pj-chat-fold'), null);
  await pjTabsRestore(first);
  clearInterval(PJC.poll);
  PJC.poll = setInterval(() => pjTabsSync(), 4000);
}

/** A tab's state: its own message area, turn and busy flag. */
function _pjTab(id) {
  if (PJC.tabs.has(id)) return PJC.tabs.get(id);
  const box = document.createElement('div');
  box.className = 'pj-chat-msgs';
  box.hidden = true;
  document.getElementById('pj-chat-stack')?.appendChild(box);
  const t = { id, box, busy: false, turn: null, loaded: false };
  PJC.tabs.set(id, t);
  return t;
}

/** Show one tab: its messages (loaded once), its switches, its fold, its Send/Stop. */
async function pjChatActivate(id) {
  PJC.active = id;
  const t = _pjTab(id);
  for (const x of PJC.tabs.values()) x.box.hidden = x !== t;
  pjTabsRender();
  _pjButtons();
  const view = PJC.chats.find(c => c.id === id) || null;
  agentConvBar(document.getElementById('pj-chat-bar'), id, view, { think: document.getElementById('pj-chat-think') });
  PJC.fold?.setSession(id);
  if (!t.loaded) {
    t.loaded = true;
    let data;
    try { data = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}`); } catch { return; }
    for (const m of (data.messages || []).slice(-60)) {
      if (m.role === 'user' || (m.role === 'assistant' && m.content)) _pjChatRow(m.role, m.content, t.box);
      for (const tc of m.tool_calls || []) _pjChatRow('tool', tc.function?.name || tc.name || 'tool', t.box);
      for (const img of m.images || []) t.box.appendChild(agentImageEl(img));
    }
    if (!t.box.children.length) t.box.innerHTML = `<div class="placeholder">${view?.sub
      ? 'A sub-agent working for another tab. Writing here speaks to it directly; its parent hears about it.'
      : 'A conversation in this project: it works in the project folder and knows how the project builds and tests.'}</div>`;
  }
  t.box.scrollTop = t.box.scrollHeight;
}

function _pjButtons() {
  const t = PJC.tabs.get(PJC.active);
  const stop = document.getElementById('pj-chat-stop');
  if (stop) stop.style.display = t?.busy ? '' : 'none';
}

function _pjChatRow(role, text, box = PJC.tabs.get(PJC.active)?.box) {
  if (!box) return null;
  box.querySelector(':scope > .placeholder')?.remove();
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
  const t = PJC.tabs.get(PJC.active);
  if (!text || !t) return;
  input.value = '';
  const row = _pjChatRow('user', text, t.box);
  // Working already: it waits and is read at the next step, or starts the next turn (agent-ui/queued-send.js).
  if (t.busy) {
    await agentQueuedSend('/api/harness/chat', { message: text, sessionId: t.id }, { mark: s => { agentQueuedTag(row)(s); PJC.fold?.refresh(); },
      startTurn: async () => { while (t.busy) await new Promise(r => setTimeout(r, 50)); return _pjTurnUi(t); } });
    PJC.fold?.refresh();
    return;
  }
  const ui = _pjTurnUi(t);
  await sseStream('/api/harness/chat', { message: text, sessionId: t.id }, { signal: t.turn.signal, onEvent: ui.onEvent, onError: ui.onError });
  await ui.finish();
}

/** One turn drawn in its tab's own message area, whichever tab is showing. */
function _pjTurnUi(t) {
  t.busy = true;
  t.turn = new AbortController();
  if (PJC.active === t.id) _pjButtons();
  pjTabsRender();
  const box = t.box;
  const scroll = () => { box.scrollTop = box.scrollHeight; };
  let md = null;
  const stream = {
    feed: x => { md ||= mdStream(_pjChatRow('assistant', '', box)); md.feed(x); scroll(); },
    finish: () => { md?.end(); md = null; },
  };
  // What each event means is decided once (agent-ui/event-sink.js); this chat draws less of it.
  const sink = agentEventSink({
    stream,
    fold: (kind, _body, name) => { if (kind === 'tool-call') _pjChatRow('tool', name, box); return null; },
    note: (_kind, text) => _pjChatRow('warning', text, box),
    image: img => { box.appendChild(agentImageEl(img)); scroll(); },
    approval: evt => agentApprovalEvent(evt, box, { note: text => _pjChatRow('warning', text, box), scroll }),
    error: msg => _pjChatRow('error', msg, box),
    userAdded: evt => { _pjChatRow('user', evt.text, box); if (PJC.active === t.id) PJC.fold?.refresh(); },
  });
  return {
    onEvent: e => { sink.onEvent(e); if (['work_plan', 'agent_dispatch', 'work_chats'].includes(e.name) && e.type === 'tool_result') pjTabsSync(); },
    onError: sink.onError,
    finish: async () => {
      sink.finish();
      t.busy = false; t.turn = null;
      if (PJC.active === t.id) { _pjButtons(); PJC.fold?.refresh(); }
      pjTabsSync();
      // The agent may have changed files: refresh what the side shows, reload clean editors.
      pjRefresh();
      if (PJ.view === 'git' || PJ.view === 'files') pjView(PJ.view);
      await pjEditorsReloadClean();
    },
  };
}

function pjChatStop() {
  const t = PJC.tabs.get(PJC.active);
  if (!t) return;
  t.turn?.abort();
  apiFetch(`/api/harness/sessions/${encodeURIComponent(t.id)}/stop`, { method: 'POST' }).catch(() => {});
}

function pjChatOpenInHarness() {
  const id = PJC.active;
  nav('harness');
  setTimeout(() => { if (typeof hcOpenSession === 'function') hcOpenSession(id); }, 300);
}
