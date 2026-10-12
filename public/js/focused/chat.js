/* The conversation, typed: the person's own conversation with the agent (the Orchestrator, /api/chat — the same one
   the floating chat and a call speak into), drawn calmly: the person's words in a bubble, the answer as text, and what
   was done as cards (focused/cards.js) instead of the tool rows. A message to a conversation that is working is kept
   and read at its next step (agent-ui/queued-send.js). What another screen or a call says in it arrives on the live
   feed and is drawn here too. On a desk a call shows beside it (focused/call.js). */
let _fcChat = null;   // {box, sessionId, turn: AbortController|null, stop}

function fcChatRender(el) {
  const product = fcProduct();
  el.innerHTML = `
    <div class="fc-conv">
      <section class="fc-conv-main">
        <div class="fc-conv-head">
          <button type="button" class="fc-btn fc-q fc-ib fc-phone-only" onclick="fcGo('home')" aria-label="Back to Home">${fcIcon('back')}</button>
          <span class="fc-conv-dots" id="fc-conv-dots"></span>
          <div class="fc-conv-who"><div class="fc-bright fc-strong">${escHtml(product)}</div><div class="fc-muted fc-small" id="fc-conv-state">Your conversation</div></div>
          <button type="button" class="fc-btn fc-pill" onclick="fcCallStart()">${fcIcon('mic', 18)}<span>Call</span></button>
        </div>
        <div class="fc-msgs" id="fc-msgs" aria-live="polite"></div>
        <div class="fc-strip-slot fc-strip-chat" id="fc-strip-chat"></div>
        <form class="fc-compose" onsubmit="event.preventDefault();fcChatSubmit()">
          <label for="fc-msg" class="fc-sr">Message ${escHtml(product)}</label>
          <input id="fc-msg" class="input fc-field" autocomplete="off" placeholder="Message ${escHtml(product)}">
          <button type="button" class="fc-btn fc-ib fc-talk-btn" onclick="fcCallStart()" aria-label="Talk instead">${fcIcon('mic')}</button>
          <button class="fc-btn fc-p fc-send" aria-label="Send">${fcIcon('send')}</button>
        </form>
      </section>
      <aside class="fc-call-side" id="fc-call-side" hidden></aside>
    </div>`;
  const dots = fcDots(document.getElementById('fc-conv-dots'), 34);
  fcOwn(dots.stop);
  _fcChat = { box: document.getElementById('fc-msgs'), sessionId: null, turn: null };
  fcOwn(() => { _fcChat = null; });
  _fcChatLoad();
  if (typeof liveOn === 'function') fcOwn(liveOn('conversation', _fcChatLive));
  if (typeof fcCallSideDraw === 'function') fcCallSideDraw();
}

const _fcChatReload = typeof liveDebounce === 'function' ? liveDebounce(() => _fcChatLoad(), 700) : () => _fcChatLoad();

/** Another screen, or a call, wrote in this conversation: its streamed text as it comes, the rows when written. */
function _fcChatLive(c) {
  if (!_fcChat || _fcChat.turn || (c.id && _fcChat.sessionId && c.id !== _fcChat.sessionId)) return;
  if (c.what === 'text' || c.what === 'thinking') {
    const text = typeof _liveBuf !== 'undefined' ? _liveBuf.get(c.id) || '' : '';
    let live = _fcChat.box.querySelector('.fc-it.fc-live');
    if (!live) { live = _fcMsg('it', ''); live.classList.add('fc-live'); }
    if (text) mdInto(live, text); else live.innerHTML = '<span class="fc-typing" aria-label="Thinking"><i></i><i></i><i></i></span>';
    _fcScroll();
  } else if (c.what !== 'tool') _fcChatReload();
}

async function _fcChatLoad() {
  if (!_fcChat) return;
  const data = await fcHistory(true).catch(() => null);
  if (!_fcChat || !data) return;
  _fcChat.sessionId = data.sessionId || null;
  // Drawn aside first: a turn started while this loaded (a message from Home) keeps its rows, after these.
  const box = document.createDocumentFragment();
  const rows = (data.messages || []).slice(-40);
  if (!rows.length && !_fcChat.turn) box.append(_fcGreetEl());
  for (const m of rows) {
    if (m.role === 'user') {
      if (typeof agentRowIsAuto === 'function' && agentRowIsAuto(m)) box.append(Object.assign(document.createElement('div'), { className: 'fc-note', textContent: String(m.content).replace(/^\[panel\]\s*/, '').split('\n')[0].slice(0, 160) }));
      else _fcMsg('me', _fcPlain(m.content), box);
      continue;
    }
    const calls = [];   // a step may call several tools before their results come: each result finds its own call
    for (const step of m.working || []) {
      if (step.kind === 'tool-call') calls.push({ name: step.label, args: step.body });
      else if (step.kind === 'tool-result') {
        const i = calls.findIndex(c => c.name === step.label);
        const call = i >= 0 ? calls.splice(i, 1)[0] : null;
        const card = call && fcCardFor(call.name, call.args, step.body);
        if (card) box.append(card);
      }
    }
    for (const img of m.images || []) box.append(fcMadeCard(img) || _fcImgEl(img));
    const text = String(m.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (text) mdInto(_fcMsg('it', '', box), text);
  }
  if (_fcChat.turn) _fcChat.box.prepend(box); else _fcChat.box.replaceChildren(box);
  if (typeof fcStrip === 'function') fcStrip(document.getElementById('fc-strip-chat'), _fcChat.sessionId);
  _fcScroll();
}

/** A form's help travels after a marker line (agent-ui/form-help.js); a voice note's instructions too: shown is what was said. */
const _fcPlain = t => String(t || '').split(/\n\n\[Sent as a voice message|\n─── /)[0];

function _fcMsg(who, text, into = _fcChat?.box) {
  const el = Object.assign(document.createElement('div'), { className: `fc-${who}` });
  if (text) el.textContent = text;
  into?.append(el);
  return el;
}

function _fcImgEl(img) {
  if (typeof agentImageEl === 'function') { try { return agentImageEl(img); } catch { /* drawn as a name */ } }
  return Object.assign(document.createElement('div'), { className: 'fc-note', textContent: img?.name || '' });
}

function _fcGreetEl() {
  const el = Object.assign(document.createElement('div'), { className: 'fc-empty' });
  el.innerHTML = `<div class="fc-bright fc-h2">Ask for anything</div><div class="fc-muted">Appointments, mail, a reminder — or “make me a page for…”. Type below, or tap Call and talk.</div>`;
  return el;
}

function _fcScroll() { const b = _fcChat?.box; if (b) b.scrollTop = b.scrollHeight; }

function fcChatSubmit() {
  const i = document.getElementById('fc-msg');
  const t = i?.value.trim();
  if (!t) return;
  i.value = '';
  fcChatSend(t);
}

/** Send `text` as the person into their conversation and draw the turn. */
function fcChatSend(text) {
  if (!_fcChat) return;
  _fcChat.box.querySelector('.fc-empty')?.remove();
  const mine = _fcMsg('me', text);
  _fcScroll();
  const busy = _fcChat.turn || (typeof chatTurn !== 'undefined' && chatTurn);
  if (busy) {
    agentQueuedSend('/api/chat', { message: text }, { mark: agentQueuedTag(mine),
      startTurn: async () => { while (_fcChat?.turn) await new Promise(r => setTimeout(r, 60)); return _fcTurnUi(); } });
    return;
  }
  const ui = _fcTurnUi();
  sseStream('/api/chat', { message: text }, { signal: _fcChat.turn.signal, onEvent: ui.onEvent, onError: ui.onError }).then(ui.finish);
}

/** One turn, drawn: text as it streams, a quiet line while a tool works, a card when it did something worth one. */
function _fcTurnUi() {
  const c = _fcChat, turn = c.turn = new AbortController();
  const state = document.getElementById('fc-conv-state');
  if (state) state.textContent = 'Working…';
  let bubble = null, raw = '', work = null, typing = _fcMsg('it', '');
  typing.innerHTML = '<span class="fc-typing" aria-label="Thinking"><i></i><i></i><i></i></span>';
  const stream = {
    feed(t) { typing?.remove(); typing = null; if (!bubble) { bubble = _fcMsg('it', ''); raw = ''; } raw += t; mdInto(bubble, raw); _fcScroll(); },
    feedThinking() {}, startWaiting() {}, finish() {}, resetText() { bubble = null; },
  };
  const sink = agentEventSink({
    stream,
    fold: (kind, body, name) => {
      if (kind === 'tool-call') { work?.remove(); work = Object.assign(document.createElement('div'), { className: 'fc-note fc-work', textContent: fcToolWords(name) }); c.box.append(work); work._call = { name, args: body }; _fcScroll(); return { setActive() {} }; }
      const call = work?._call; work?.remove(); work = null;
      const card = call && fcCardFor(call.name, call.args, body);
      if (card) { c.box.append(card); _fcScroll(); }
      return null;
    },
    note: (kind, text) => { const n = Object.assign(document.createElement('div'), { className: 'fc-note', textContent: text }); c.box.append(n); return n; },
    image: img => { c.box.append(fcMadeCard(img) || _fcImgEl(img)); _fcScroll(); },
    approval: evt => agentApprovalEvent(evt, c.box, { note: t => c.box.append(Object.assign(document.createElement('div'), { className: 'fc-note', textContent: t })), scroll: _fcScroll }),
    error: msg => { typing?.remove(); typing = null; const n = Object.assign(document.createElement('div'), { className: 'fc-note fc-err', textContent: msg }); c.box.append(n); },
    userAdded: evt => _fcMsg('me', _fcPlain(evt.text)),
  });
  const end = () => { typing?.remove(); work?.remove(); if (c.turn === turn) c.turn = null; if (state) state.textContent = 'Your conversation'; fcForget('/api/chat/history'); };
  return { onEvent: sink.onEvent, onError: e => { sink.onError(e); end(); }, finish: () => { sink.finish(); end(); } };
}

/** What a tool is doing, in words a person reads — never its arguments. */
function fcToolWords(name = '') {
  if (/^connector_google/.test(name)) return 'Looking at your Google account…';
  if (/^connector_microsoft/.test(name)) return 'Looking at your Microsoft account…';
  if (/^calendar_/.test(name)) return 'Checking your calendar…';
  if (/^mail_/.test(name)) return 'Looking at your mail…';
  const words = { remind: 'Setting a reminder…', web_search: 'Searching the web…', http_fetch: 'Reading a page…', memory_search: 'Remembering…',
    memory_write: 'Keeping that in mind…', canvas: 'Making a page…', work_chats: 'Handing it on…', show_media: 'Showing you something…', today: 'Looking at your day…' };
  return words[name] || 'Working on it…';
}
