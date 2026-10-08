/* ═══════════════════════════════════════════════════════
   💭 — whether the agent thinks, within a mode (asked 2026-10-08; modules/harness/turn/thinking.js).
   Beside Send in the floating chat, the Harness console and a project's chat it is the conversation's own:
   auto (the mode's setting, Settings → Harness → Thinking), off, or on — kept on the conversation
   (POST /api/harness/sessions/:id/settings {thinking}). In the Live and Deep calls it is the call's: it changes thinking
   for the rest of that call and is sent with each spoken turn. "Think harder" said or written still wins for that
   message, and the agent's `effort` tool can change the conversation's when asked.
   ═══════════════════════════════════════════════════════ */

const THINK_NEXT = { auto: 'off', off: 'on', on: 'auto' };
const THINK_SAYS = {
  auto: 'Thinking: auto — as Settings → Harness → Thinking says for this kind of conversation. Click: off.',
  off: 'Thinking: off — answers without thinking first. Click: on. Saying "think harder" still thinks for that message.',
  on: 'Thinking: on — thinks before answering. Click: back to auto.',
};

/** The button; `call` makes it the call's switch rather than the conversation's. */
function thinkToggleHtml(id, { call = false, size = 'sm' } = {}) {
  return `<button type="button" class="btn btn-${size} think-toggle" id="${id}" data-think="auto"${call ? ' data-think-call="1"' : ''}
    onclick="thinkToggleClick(this, event)" aria-label="Thinking: auto" title="${THINK_SAYS.auto}"><span class="think-ico" aria-hidden="true">💭</span><span class="think-word">auto</span></button>`;
}

/** Draw a state: auto, off, or on (with the level it means, when known). */
function thinkToggleDraw(btn, state, level) {
  if (!btn) return;
  btn.dataset.think = state;
  btn.querySelector('.think-word').textContent = state;
  const says = THINK_SAYS[state] + (state === 'on' && level ? ` (${level})` : '');
  btn.title = btn.dataset.thinkCall ? says.replace('Thinking:', 'Thinking in this call:') : says;
  btn.setAttribute('aria-label', `Thinking: ${state}`);
  btn.setAttribute('aria-pressed', state === 'auto' ? 'mixed' : String(state === 'on'));
}

/** The conversation's state from its view ({thinking: level|null}). */
const thinkStateOf = level => (!level ? 'auto' : level === 'off' ? 'off' : 'on');

/** Tie a composer's button to a conversation; `view` is its session view when already loaded. */
async function thinkToggleBind(btn, sessionId, view = null) {
  if (!btn) return;
  btn.dataset.session = sessionId || '';
  btn.hidden = !sessionId;
  if (!sessionId) return;
  const v = view && 'thinking' in view ? view
    : await apiFetch(`/api/harness/sessions/${encodeURIComponent(sessionId)}`).then(r => r.session).catch(() => null);
  if (btn.dataset.session !== sessionId) return;   // moved on to another conversation meanwhile
  thinkToggleDraw(btn, thinkStateOf(v?.thinking), v?.thinking);
}

async function thinkToggleClick(btn, e) {
  e?.stopPropagation();
  const next = THINK_NEXT[btn.dataset.think] || 'auto';
  if (btn.dataset.thinkCall) return callThinkSet(next);
  const id = btn.dataset.session;
  if (!id) return;
  try {
    const v = await apiFetch(`/api/harness/sessions/${encodeURIComponent(id)}/settings`, { method: 'POST', body: { thinking: next } });
    document.querySelectorAll('.think-toggle:not([data-think-call])').forEach(b => { if (b.dataset.session === id) thinkToggleDraw(b, thinkStateOf(v?.thinking), v?.thinking); });
  } catch (err) { appAlert(err.message); }
}

/* ── The call's own: for the rest of this call, sent with each spoken turn; a call that ends puts it back (chat-call.js) ── */
let _callThinkState = 'auto';

function callThinkSet(state) {
  _callThinkState = state;
  document.querySelectorAll('.think-toggle[data-think-call]').forEach(b => thinkToggleDraw(b, state));
}

/** What a spoken turn carries (chat-call.js): the call's 💭, and whether it is Ambient's (its own mode, no toggle). */
function callThinkBody(assistant) {
  return { ...(_callThinkState !== 'auto' ? { thinking: _callThinkState } : {}),
    ...(assistant && typeof ambientIsOpen === 'function' && ambientIsOpen() ? { ambient: true } : {}) };
}
