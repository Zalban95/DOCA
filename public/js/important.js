/* Important changes, where the person is looking (modules/important/; asked 2026-10-16). The hub stores the red line
   in the person's own main conversation (the floating chat) and in the conversation that proposed the change, and the
   live feed's `conversation` row redraws those. What else is open on this screen hears the live feed's `important`
   topic (the person who changed it, and a host): a console or a floating chat showing another conversation — or busy
   with a turn, which a redraw would not touch — draws the same line now, and a call open here turns the face's points
   red for a few seconds (their colour only) and says it on the call's status line. Words from the hub, never a model. */

const IMPORTANT_ALERT_MS = 5000;
let _importantUntil = 0;   // while the call's face is red and its line says the change

/** The theme's red, as the face reads a colour (#rrggbb); the face's own red otherwise. */
function importantRed() {
  const v = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue('--red').trim() : '';
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#e85050';
}

/** Whether a call is open on this screen: the panel's own (Live, Deep, Ambient's) or the realtime model's. */
function importantInCall() {
  return (typeof _callActive !== 'undefined' && !!_callActive) || (typeof _rt !== 'undefined' && !!_rt);
}

/** In a call: the points red for a moment, and the status line says it as long. Returns whether it did. */
function importantCallAlert(text) {
  if (!importantInCall()) return false;
  _importantUntil = Date.now() + IMPORTANT_ALERT_MS;
  if (typeof faceAlertAll === 'function') faceAlertAll(importantRed(), IMPORTANT_ALERT_MS);
  if (typeof _callSetStatus === 'function') _callSetStatus(text, 'listening');
  if (typeof _callNoticeUntil !== 'undefined') _callNoticeUntil = performance.now() + IMPORTANT_ALERT_MS;   // "Listening…" waits (chat-call.js)
  return true;
}

/** Whether the call's face is red now. */
const importantAlerting = () => Date.now() < _importantUntil;

function _importantDraw(box) {
  if (!box || typeof agentImportantEl !== 'function') return;
  box.querySelector(':scope > .placeholder')?.remove();
  box.appendChild(agentImportantEl(this.text));
  box.scrollTop = box.scrollHeight;
}

/** One change from the live feed: the line wherever the redraw will not draw it, and the call's alert. */
function importantOn(c) {
  if (!c || c.what === 'resync' || !c.text) return;
  const stored = new Set(c.stored || []), draw = _importantDraw.bind(c);
  const hc = typeof _hcSession !== 'undefined' ? _hcSession : null;
  if (hc && (!stored.has(hc) || (typeof _hcBusy !== 'undefined' && _hcBusy))) draw(document.getElementById('hc-messages'));
  const fc = typeof _liveChatSession !== 'undefined' ? _liveChatSession : null;
  if (!fc || !stored.has(fc) || (typeof chatTurn !== 'undefined' && chatTurn)) draw(document.getElementById('chat-messages'));
  importantCallAlert(c.text);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function')
  document.addEventListener('DOMContentLoaded', () => { if (typeof liveOn === 'function') liveOn('important', importantOn); });
