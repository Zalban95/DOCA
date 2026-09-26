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
  const btn   = document.getElementById('hc-send');
  const text  = input?.value.trim();
  if (!text || _hcBusy) return;

  _hcBusy = true;
  input.value = '';
  if (btn) btn.style.display = 'none';
  const stopBtn = document.getElementById('hc-stop');
  if (stopBtn) stopBtn.style.display = '';
  _hcTurn = new AbortController();
  _hcAppend('user', text);

  const box = document.getElementById('hc-messages');
  const scroll = () => { if (box) box.scrollTop = box.scrollHeight; };
  let pendingCall = null;
  let waitingRow  = null;
  // The last step's account of the turn: the ring follows it while the turn
  // runs, and the rate under the answer is read off it once the turn ends.
  let spend = null;

  // Everything this turn does goes in one block that shows its current row and
  // becomes one line when the turn ends.
  agentWorkingOpen(box);
  const stream = createThinkStream({
    mount: node => { box?.querySelector('.placeholder')?.remove(); if (box) agentFoldMount(box, node); scroll(); },
    makeText: () => _hcAppend('assistant', ''),
    scroll,
  });
  stream.startWaiting();

  await sseStream('/api/harness/chat', { message: text, sessionId: _hcSession }, {
    signal: _hcTurn.signal,
    onEvent: evt => {
      if (evt.type === 'session') _hcSession = evt.sessionId;
      if (evt.type === 'thinking') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        stream.feedThinking(evt.text);
      }
      if (evt.type === 'text') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        stream.feed(evt.text);
      }
      if (evt.type === 'tool_call') {
        stream.finish();
        stream.resetText();
        if (pendingCall) pendingCall.setActive(false);
        pendingCall = _hcAppend('tool-call', JSON.stringify(evt.args ?? {}), evt.name, { active: true });
      }
      if (evt.type === 'usage') { spend = evt; _hcContext(evt); }
      // A blocked tool call. The turn is waiting on the other side of this
      // card, so it goes in as its own row rather than into the working fold,
      // which collapses and would hide the thing being asked.
      if (evt.type === 'approval') _hcApproval(evt, box, scroll);
      if (evt.type === 'warning') _hcAppend('failover', evt.text, 'warning');   // a cut-off reply, budget, context
      if (evt.type === 'image') _hcAppendImage(evt.image);
      if (evt.type === 'tool_result') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        _hcAppend('tool-result', evt.result, evt.name);
        stream.startWaiting();
      }
      if (evt.type === 'error') {
        if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
        stream.finish();
        _hcAppend('error', evt.text, 'error');
      }
      // The provider has the request and has not started answering. One row,
      // rewritten in place, because the alternative is a console that shows
      // nothing for ninety seconds and reads as broken.
      if (evt.type === 'waiting') {
        const note = `${evt.provider} has not sent a token yet — ${evt.seconds}s`
          + (evt.frames ? `, ${evt.frames} keep-alive frames` : '')
          + (evt.timeoutMs ? ` of ${Math.round(evt.timeoutMs / 1000)}s` : '');
        if (waitingRow) waitingRow.textContent = note;
        else waitingRow = _hcAppend('waiting', note, 'waiting');
      }
      // A hop down the fallback chain. It gets a row of its own and is never
      // quiet, because the answer that follows is not from the model the user
      // chose: read without this line, a smaller model's reply is taken for the
      // big one's, and the next investigation starts from a false premise.
      if (evt.type === 'failover') {
        if (waitingRow) { waitingRow.parentElement?.remove(); waitingRow = null; }
        _hcAppend('failover', evt.text, 'fallback');
        stream.startWaiting();   // the next rung has its own wait, and may be slow too
      }
      // Anything real from the model means the wait is over. `_hcAppend`
      // returns the body span, so the row is its parent.
      if (waitingRow && (evt.type === 'thinking' || evt.type === 'text' || evt.type === 'tool_call' || evt.type === 'usage')) {
        waitingRow.parentElement?.remove();
        waitingRow = null;
      }
      // Mid-turn, so the card is there to accept the moment the agent explains
      // it rather than after the whole answer has finished streaming.
      if (evt.type === 'proposal')    _hcLoadProposals();
    },
    onError: e => {
      if (pendingCall) { pendingCall.setActive(false); pendingCall = null; }
      stream.finish();
      _hcAppend('error', e.message, 'error');
    },
  });

  if (pendingCall) pendingCall.setActive(false);
  stream.finish();
  // The turn is over, so the rows it left open close: the account of a finished
  // run is a few short lines, each one a click away from the detail.
  closeFolds(box);
  agentWorkingClose(box);
  // After the fold closes, so the rate is the last thing under the answer
  // rather than a line the collapsing run swallows.
  const rate = tokenRateEl(spend);
  if (rate && box) { box.appendChild(rate); scroll(); }
  if (_hcTurn?.signal.aborted)
    _hcAppend('error', 'Stopped. The step already running finishes on its own; nothing after it starts.', 'stopped');

  _hcBusy = false;
  _hcTurn = null;
  if (btn) btn.style.display = '';
  if (stopBtn) stopBtn.style.display = 'none';
  _hcLoadSessions();
  _hcLoadMemory();
  _hcLoadProposals();
  _hcLoadUsage();
  input?.focus();
}
