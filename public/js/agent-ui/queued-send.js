/* ═══════════════════════════════════════════════════════
   Writing to a conversation that is working (decided with Al 2026-10-04:
   nobody waits for the agent). The server keeps the message in the
   conversation's inbox (modules/harness/inbox.js) and this stream says what
   became of it: "queued", then "read" — the running turn took it before its
   next step, and its answer comes in that turn's stream — or "started", and
   the turn it starts arrives here, to be drawn like any other.
   ═══════════════════════════════════════════════════════ */

/**
 * @param {string} url
 * @param {object} body
 * @param {{ mark(state: 'queued'|'read'|'started'|'error', detail?: string): void,
 *           startTurn(): Promise<{ onEvent(e), onError(e), finish() }> }} ui
 *   startTurn is called when the message starts a turn of its own; it may wait
 *   for the chat to finish drawing the turn before, and events wait with it.
 */
/** Ids of the waiting messages this page sent, so a turn that reads one does not draw it twice. */
const AGENT_QUEUED_MINE = new Set();

async function agentQueuedSend(url, body, ui) {
  let sink = null, starting = null, queued = false;
  const early = [];
  // The conversation was free after all (its turn ended while this was being typed): the server started a turn at
  // once, with no "queued" first, and it is drawn like one this page started.
  const begin = () => { starting = ui.startTurn().then(s => { sink = s; early.splice(0).forEach(x => s.onEvent(x)); }); };
  const feed = e => { if (!sink && !starting && !queued) { ui.mark('started'); begin(); } return sink ? sink.onEvent(e) : early.push(e); };
  await sseStream(url, body, {
    onEvent: e => {
      if (e.type === 'queued') { queued = true; AGENT_QUEUED_MINE.add(e.id); return ui.mark('queued'); }
      if (e.type === 'queued_read') return ui.mark('read');
      if (e.type === 'queued_started') { ui.mark('started'); if (!starting) begin(); return; }
      feed(e);
    },
    onError: e => (sink ? sink.onError(e) : ui.mark('error', e.message)),
  });
  if (starting) { await starting; sink.finish(); }
}

/** The small label under a message that is waiting, and what became of it. */
function agentQueuedTag(row) {
  const tag = document.createElement('div');
  tag.className = 'agent-queued-tag';
  row?.appendChild(tag);
  const text = { queued: 'queued — it reads this at its next step', read: 'read', started: '', error: 'not sent' };
  return (state, detail) => {
    tag.textContent = detail ? `${text[state]}: ${detail}` : text[state];
    tag.dataset.state = state;
    if (state === 'started' || state === 'read') setTimeout(() => tag.remove(), state === 'read' ? 4000 : 0);
  };
}
