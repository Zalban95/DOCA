/* The microphone switch beside the chats (the floating chat's header, the Harness console's composer, the face's call):
   one setting per screen (lib/mic-keep.js), drawn the same everywhere. Its point says what the microphone is doing now
   — open in a call or a recording, listening for the wake word, paused for a phone call, or closed — and its title says
   what "on" means here. */

const MIC_KEEP_STATE = {
  call:      ['call', 'open in a call'],
  recording: ['call', 'open for a recording'],
  listening: ['listening', 'listening for the wake word'],
  paused:    ['paused', 'paused'],
  '':        ['off', 'closed'],
};

/** The switch's markup; `extra` is a class for where it sits. */
function micKeepHtml(extra = '') {
  return `<button type="button" class="btn btn-xs mic-keep ${extra}" data-mic-keep onclick="micKeepToggle(event)" aria-pressed="false">`
    + '<span class="mic-dot off" aria-hidden="true"></span><span class="mic-keep-label">Mic</span></button>';
}

async function micKeepToggle(e) {
  e?.stopPropagation();
  try { await micKeepSet(!micAlwaysOn()); }
  catch (err) { appAlert(`The microphone switch was not saved: ${err.message}`); }
}

/** What the switch says, from where things stand (pure, for the tests). */
function micKeepWords({ on, held, paused, app, inApp }) {
  const [dot, now] = MIC_KEEP_STATE[held] || MIC_KEEP_STATE[''];
  const pausedWhy = paused === 'phone-call' ? 'paused for a phone call' : paused === 'another-app' ? 'paused: another app is using it' : '';
  const state = held === 'paused' || (pausedWhy && !held) ? pausedWhy || now : now;
  const what = on
    ? 'On: the microphone may stay open with the app in the background — the wake word keeps listening and a call keeps going.'
      + (inApp ? ' The app shows a "DOCA is listening" notice while it may; a phone call pauses it.' : ' In a browser, whether a page in the background keeps the microphone is up to the browser.')
    : 'Off: the microphone opens only for a call or a recording, and closes as soon as the page is in the background.';
  const why = app?.why ? ` The app says: ${app.why}.` : '';
  return { dot: pausedWhy && !held ? 'paused' : dot, label: on ? 'Mic on' : 'Mic', title: `Microphone now: ${state}. ${what}${why} Click to turn it ${on ? 'off' : 'on'}.` };
}

function micKeepRefresh() {
  if (typeof document === 'undefined') return;
  const els = document.querySelectorAll('[data-mic-keep]');
  if (!els.length) return;
  const w = micKeepWords({ on: micAlwaysOn(), held: micHeldNow(), paused: micKeepPaused(), app: _micKeep.app, inApp: !!micKeepBridge() });
  els.forEach(el => {
    el.setAttribute('aria-pressed', String(micAlwaysOn()));
    el.classList.toggle('on', micAlwaysOn());
    el.title = w.title;
    const dot = el.querySelector('.mic-dot'), label = el.querySelector('.mic-keep-label');
    if (dot) dot.className = `mic-dot ${w.dot}`;
    if (label) label.textContent = w.label;
  });
}

// What holds the microphone changes in many places (a call, the wake word, a voice note): read once a second while a
// switch is on screen — the DOM only, no request.
if (typeof document !== 'undefined' && typeof setInterval === 'function') setInterval(() => { if (!document.hidden) micKeepRefresh(); }, 1000);
