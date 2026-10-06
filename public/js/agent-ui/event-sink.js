/* ═══════════════════════════════════════════════════════
   One turn's events, into whichever chat is showing it: the floating chat,
   the harness console, the Projects chat (decided with the owner 2026-10-04).

   The three chats each kept their own copy of this state machine — the open
   tool fold, the "waiting" row rewritten in place, failovers, warnings,
   approvals in their three states, pictures, errors — and the audit found the
   copies had drifted: one dropped approval cards, one drew a second live card
   after an answer, one showed no warnings. Each chat now hands this its own
   drawing functions; what an event *means* is decided once, here.
   ═══════════════════════════════════════════════════════ */

/**
 * @param {{
 *   stream: { feed(t), feedThinking?(t), finish(), resetText?(), startWaiting?() },
 *   fold(kind, body, name, opts?): { setActive(on) } | null,   // a tool call or result row
 *   note(kind, text, cls?): HTMLElement,                         // waiting / failover / warning / error rows
 *   removeNote?(el), image(img), approval(evt), error(text),
 *   context?(usage), onText?(text), onSession?(id), onProposal?(evt), userAdded?(evt),
 * }} ui
 */
function agentEventSink(ui) {
  let pendingCall = null, waitingRow = null, spend = null;
  const settleCall = () => { if (pendingCall) { pendingCall.setActive(false); pendingCall = null; } };
  const clearWait = () => { if (waitingRow) { (ui.removeNote || (el => el.remove()))(waitingRow); waitingRow = null; } };

  function onEvent(evt) {
    switch (evt.type) {
      case 'session': ui.onSession?.(evt.sessionId); break;
      case 'thinking': settleCall(); clearWait(); ui.stream.feedThinking?.(evt.text); break;
      case 'text': settleCall(); clearWait(); ui.onText?.(evt.text); ui.stream.feed(evt.text); break;
      // The provider has the request and has not started answering: one row, rewritten in place.
      case 'waiting': {
        const text = `${evt.provider} has not sent a token yet — ${evt.seconds}s`
          + (evt.frames ? `, ${evt.frames} keep-alive frames` : '') + (evt.timeoutMs ? ` of ${Math.round(evt.timeoutMs / 1000)}s` : '');
        if (waitingRow) waitingRow.textContent = text; else waitingRow = ui.note('waiting', text, 'waiting');
        break;
      }
      // A hop down the fallback chain is never quiet: the answer that follows is not the chosen model's.
      case 'failover': clearWait(); ui.note('failover', evt.text, 'fallback'); ui.stream.startWaiting?.(); break;
      // A reply cut off at its limit, a budget, a rate limit's wait: each changes what the answer is.
      case 'warning': clearWait(); ui.note('failover', evt.text, 'warning'); break;
      case 'tool_call':
        clearWait(); ui.stream.finish(); ui.stream.resetText?.(); settleCall();
        pendingCall = ui.fold('tool-call', JSON.stringify(evt.args ?? {}), evt.name, { active: true });
        break;
      case 'tool_result': settleCall(); ui.fold('tool-result', evt.result, evt.name); ui.stream.startWaiting?.(); break;
      case 'usage': spend = evt; clearWait(); ui.context?.(evt); break;
      case 'approval': ui.approval(evt); break;
      case 'image': ui.image(evt.image); break;
      case 'form_fill': if (typeof formHelpFill === 'function') formHelpFill(evt); break;   // a draft in a form on screen
      case 'error': settleCall(); ui.stream.finish(); ui.error(evt.text); break;
      case 'stderr': ui.stream.finish(); ui.error(evt.text); break;
      case 'proposal': ui.onProposal?.(evt); break;
      // A message written while this turn worked, read before its next step (modules/harness/inbox.js): the
      // reply so far ends, the message shows (unless this page sent it and drew it already), the reply goes on.
      case 'user_added':
        settleCall(); clearWait(); ui.stream.finish(); ui.stream.resetText?.();
        if (!(typeof AGENT_QUEUED_MINE !== 'undefined' && AGENT_QUEUED_MINE.has(evt.id))) ui.userAdded?.(evt);
        ui.stream.startWaiting?.();
        break;
      default: break;
    }
  }

  return {
    onEvent,
    onError: e => { settleCall(); clearWait(); ui.stream.finish(); ui.error(e.message); },
    finish: () => { settleCall(); clearWait(); ui.stream.finish(); },
    get spend() { return spend; },
  };
}

/**
 * An `approval` event in a transcript, in its three states — the one place it
 * is decided: a mission's refusal is a note; an answer (here or anywhere else)
 * settles its card and closes the popup; a question gets a card *and* the
 * popup, out of the working fold so a collapsing run cannot hide it.
 */
function agentApprovalEvent(evt, box, { note, onSettle, scroll } = {}) {
  if (!box) return;
  box.querySelector(':scope > .placeholder')?.remove();
  if (typeof agentWorkingGiveBack === 'function') agentWorkingGiveBack(box);
  if (evt.state === 'refused') { note?.(`Not run — ${evt.tool} needs approval and a mission has nobody to ask.`); scroll?.(); return; }
  if (evt.state === 'answered') {
    box.querySelector(`[data-approval-id="${CSS.escape(evt.id)}"]`)?.settleFrom?.(evt.decision);
    approvalPopupClose(evt.id);
    scroll?.();
    return;
  }
  const card = approvalCardEl(evt, () => onSettle?.());
  box.appendChild(card);
  approvalPopup(evt, d => { card.settleFrom?.(d); onSettle?.(); });
  scroll?.();
}
