/* A question asked while a call is open (the owner, 2026-10-08: in a Live call the approval waited behind the call
   screen, unseen, and the turn gave up). The card is drawn on top of the call (agent-ui/approval.js, inside whatever
   is full screen); the question is said in the call's voice — the hub words it (`spoken`, harness/call-answer.js) —
   and the next thing said answers it when it is plainly a yes or a no: the hub decides what the words mean (one matcher
   for the panel and a device's call), allows once or denies, and the call says so. Anything else is passed on as a
   message, and the question stays open on the card. No "always" by voice. The call log keeps that a question was asked
   (the tool's name) and how it was answered — never the words. */
let _callAskOpen = null;   // { id, tool } — the question waiting in this call

/** Whether a question waits in this call: the call then listens even while its turn works (chat-call.js). */
function callAskWaiting() { return !!_callAskOpen; }

/** An approval event from this call's own turn (the call's event sink). */
function callAskEvent(evt) {
  if (typeof _callActive === 'undefined' || !_callActive || !evt) return;
  if (evt.state === 'asked' && evt.id) {
    _callAskOpen = { id: evt.id, tool: evt.tool };
    _callReport('ask', { tool: evt.tool });
    _callSetStatus('Waiting for your yes or no…', 'listening');
    _callEnqueueSynth(evt.spoken || `Shall I use ${String(evt.tool || 'that tool').replace(/_/g, ' ')}? Say yes or no.`);
  } else if (evt.state === 'answered' && _callAskOpen?.id === evt.id) _callAskOpen = null;
}

/**
 * What was said, offered to the waiting question first. True when it answered it (the call says so and listens on);
 * false when it is something else, which the caller sends on as a message.
 */
async function callAskAnswer(text) {
  const open = _callAskOpen;
  if (!open) return false;
  let r = null;
  try { r = await apiFetch(`/api/harness/approvals/${encodeURIComponent(open.id)}`, { method: 'POST', body: { heard: text } }); }
  catch { return false; }   // the hub could not say: treat it as words, never as a yes
  if (!r?.decision) { if (r?.gone) _callAskOpen = null; return false; }
  _callAskOpen = null;
  chatAppendMsg('user', text);
  _callReport('answered', { decision: r.decision, tool: open.tool });
  if (typeof approvalPopupClose === 'function') approvalPopupClose(open.id);
  if (r.reply) _callEnqueueSynth(r.reply);
  return true;
}

/** The call ended: a question it held stays on the card, where it can still be answered. */
function callAskReset() { _callAskOpen = null; }
