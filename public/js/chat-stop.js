/* ═══════════════════════════════════════════════════════
   The floating chat's turn in flight, and Stop (out of chat.js, which is at its size limit).
   ═══════════════════════════════════════════════════════ */

/* The turn in flight, if any. Stop hangs up on the stream — the server drops the model request in flight with it —
   and also asks the conversation to stop, because a message that was queued behind a turn already running there
   (inbox.js) owns no turn of its own to hang up on. On a slow model Stop looked dead for half a minute (self-test
   round two, C1): it now says "Stopping…" the moment it is pressed, and "Stopped." once the hub says the turn ended. */
let chatTurn = null;

function _chatBusy(on) {
  chatTurn = on ? chatTurn : null;
  const stop = document.getElementById('chat-stop');
  if (!stop) return;
  stop.style.display = on ? '' : 'none';   // Send stays: a message mid-turn waits for the next step
  if (on) { stop.disabled = false; stop.textContent = '■ Stop'; }
}

async function chatStop() {
  const turn = chatTurn;
  if (!turn || turn.stopping) return;
  turn.stopping = true;
  const btn = document.getElementById('chat-stop');
  if (btn) { btn.disabled = true; btn.textContent = 'Stopping…'; }
  const note = _chatStopNote('Stopping…');
  turn.abort();
  let sid = typeof _liveChatSession !== 'undefined' ? _liveChatSession : null;
  if (!sid) sid = (await apiFetch('/api/chat/history').catch(() => ({}))).sessionId;
  let r = null;
  for (let i = 0; sid && i < 3 && !r?.ended; i++)   // each asks once more and waits up to 10 s for the turn to end
    r = await apiFetch(`/api/harness/sessions/${encodeURIComponent(sid)}/stop`, { method: 'POST', body: {} }).catch(() => null);
  // Held a moment longer, so the live feed's "ended" lands while this chat still owns the turn and does not redraw
  // the conversation from the hub — which would take the note with it (live-pages.js).
  await new Promise(res => setTimeout(res, 600));
  if (chatTurn === turn) _chatBusy(false);
  _chatStopNote(!sid || r?.ended !== false ? 'Stopped.'
    : 'Still stopping — the model has not let go of the step it was on. Nothing after it will run.', note);
}

/** The line saying how Stop is going: under the conversation, never inside the turn's fold, which closes when it ends. */
function _chatStopNote(text, el = null) {
  const box = document.getElementById('chat-messages');
  if (!el || !el.isConnected) {
    el = Object.assign(document.createElement('div'), { className: 'chat-msg system' });
    box?.appendChild(el);
  }
  el.textContent = text;
  if (box) box.scrollTop = box.scrollHeight;
  return el;
}
