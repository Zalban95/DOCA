/* ═══════════════════════════════════════════════════════
   Harness tab: the transcript, and sending a turn.
   ═══════════════════════════════════════════════════════ */

/**
 * One bubble in the transcript. `kind` is a message role or one of the
 * harness-specific kinds (tool-call, tool-result, summary, error, thinking).
 * Tool activity and thinking use collapsible folds (see agentFold).
 */
function _hcAppend(kind, text, label, opts = {}) {
  const box = document.getElementById('hc-messages');
  if (!box) return null;
  box.querySelector('.placeholder')?.remove();

  if (kind === 'tool-call' || kind === 'tool-result' || kind === 'thinking') {
    const fold = agentFold({
      kind,
      label: kind === 'thinking' ? (label || 'Thinking')
        : kind === 'tool-call'   ? `Command · ${label || 'tool'}`
        : `Result · ${label || 'tool'}`,
      body: kind === 'tool-call' ? _hcPrettyArgs(text) : (text == null ? '' : String(text)),
      active: !!opts.active,
      open: !!opts.open,
    });
    agentFoldMount(box, fold.el);
    box.scrollTop = box.scrollHeight;
    return fold;
  }

  const el = document.createElement('div');
  el.className = `hc-msg hc-${kind}`;
  if (label) {
    const tag = document.createElement('span');
    tag.className = 'hc-msg-tag';
    tag.textContent = label;
    el.appendChild(tag);
  }
  // A div, not a span: the assistant's prose is rendered as markdown, and
  // headings, lists and tables are block elements that cannot live in one.
  const body = document.createElement('div');
  body.className = 'hc-msg-body';
  // What the agent said is markdown and is rendered as markdown. Everything
  // else here is the literal text it is — a tool result, an error, a step
  // count — and re-typesetting those would be inventing structure.
  if (kind === 'assistant' && !opts.plain) mdInto(body, text);
  else if (kind === 'user' && typeof formHelpTextInto === 'function') formHelpTextInto(body, text);   // a form's details, folded
  else body.textContent = text;
  el.appendChild(body);
  // What the agent says mid-turn is part of the working and joins the block;
  // the user's own message is what starts a turn, so it never does.
  if (kind === 'user') box.appendChild(el);
  else agentWorkingMount(box, el);
  box.scrollTop = box.scrollHeight;
  return body;
}

/** A picture the agent showed, between its Command and Result folds. */
function _hcAppendImage(image) {
  const box = document.getElementById('hc-messages');
  if (!box || !image?.name) return;
  box.querySelector('.placeholder')?.remove();
  const scroll = () => { box.scrollTop = box.scrollHeight; };
  // The sentence the picture is shown under comes out of the turn's account
  // first, so the picture lands below it rather than below the whole turn.
  // A no-op on a reload, which has no open block. See `agentWorkingGiveBack`.
  agentWorkingGiveBack(box);
  box.appendChild(agentImageEl(image, scroll));
  scroll();
}

/** Pretty-print tool args JSON when it is valid; otherwise leave as-is. */
function _hcPrettyArgs(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object') return JSON.stringify(raw, null, 2);
  const s = String(raw);
  try { return JSON.stringify(JSON.parse(s), null, 2); }
  catch { return s; }
}

/** Reload an assistant/user message that may contain `<think>` blocks. */
function _hcAppendContent(role, content) {
  if (role !== 'assistant') {
    _hcAppend(role, content);
    return;
  }
  const box = document.getElementById('hc-messages');
  if (!box) return;
  renderThoughtfulContent(content, {
    mount: node => { box.querySelector('.placeholder')?.remove(); agentFoldMount(box, node); },
    makeText: text => { if (text) _hcAppend('assistant', text); },
  });
  box.scrollTop = box.scrollHeight;
}

async function hcSend() {
  const input = document.getElementById('hc-input');
  const text  = input?.value.trim();
  if (!text) return;
  const to = document.getElementById('hc-to')?.value;
  if (to) { if (await hcSendMission(to, text)) input.value = ''; return; }
  input.value = '';
  const row = _hcAppend('user', text);
  // Working already: the message waits and is read at its next step, or starts the next turn (agent-ui/queued-send.js).
  if (_hcBusy) {
    const tag = agentQueuedTag(row?.parentElement || row);
    const mark = (s, d) => { tag(s, d); window._hcFold?.refresh(); };
    await agentQueuedSend('/api/harness/chat', { message: text, sessionId: _hcSession }, {
      mark, startTurn: async () => { while (_hcBusy) await new Promise(r => setTimeout(r, 50)); return _hcTurnUi(); },
    });
    return;
  }
  const ui = _hcTurnUi();
  await sseStream('/api/harness/chat', { message: text, sessionId: _hcSession }, {
    signal: _hcTurn.signal, onEvent: ui.onEvent, onError: ui.onError,
  });
  ui.finish();
}

/** One turn drawn in the console: set up when it starts, closed when it ends. */
function _hcTurnUi() {
  const input = document.getElementById('hc-input');
  const stopBtn = document.getElementById('hc-stop');
  _hcBusy = true;
  if (stopBtn) stopBtn.style.display = '';
  _hcTurn = new AbortController();

  const box = document.getElementById('hc-messages');
  const scroll = () => { if (box) box.scrollTop = box.scrollHeight; };

  // Everything this turn does goes in one block that shows its current row and
  // becomes one line when the turn ends.
  agentWorkingOpen(box);
  const stream = createThinkStream({
    mount: node => { box?.querySelector('.placeholder')?.remove(); if (box) agentFoldMount(box, node); scroll(); },
    makeText: () => _hcAppend('assistant', ''),
    scroll,
  });
  stream.startWaiting();

  // What each event means is decided once (agent-ui/event-sink.js); this is how the console draws it.
  const sink = agentEventSink({
    stream,
    fold: (kind, body, name, opts) => _hcAppend(kind, body, name, opts),
    note: (kind, text, cls) => _hcAppend(kind === 'waiting' ? 'waiting' : 'failover', text, cls),
    removeNote: el => el.parentElement?.remove(),   // _hcAppend returns the row's body
    image: img => _hcAppendImage(img),
    approval: evt => _hcApproval(evt, box, scroll),
    error: msg => _hcAppend('error', msg, 'error'),
    context: evt => _hcContext(evt),
    onSession: id => { _hcSession = id; },
    onProposal: () => _hcLoadProposals(),   // mid-turn, so the card is there when the agent explains it
    userAdded: evt => _hcAppend('user', evt.text),
  });

  return {
    onEvent: sink.onEvent,
    onError: sink.onError,
    finish: () => {
      sink.finish();
      // The turn is over, so the rows it left open close: the account of a finished
      // run is a few short lines, each one a click away from the detail.
      closeFolds(box);
      agentWorkingClose(box);
      // After the fold closes, so the rate is the last thing under the answer
      // rather than a line the collapsing run swallows.
      const rate = tokenRateEl(sink.spend);
      if (rate && box) { box.appendChild(rate); scroll(); }
      if (_hcTurn?.signal.aborted)
        _hcAppend('error', 'Stopped. The step already running finishes on its own; nothing after it starts.', 'stopped');
      _hcBusy = false;
      _hcTurn = null;
      if (stopBtn) stopBtn.style.display = 'none';
      _hcLoadSessions();
      _hcLoadMemory();
      _hcLoadProposals();
      _hcLoadUsage();
      window._hcFold?.refresh();
      input?.focus();
    },
  };
}
