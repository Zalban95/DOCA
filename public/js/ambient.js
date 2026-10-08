/* The ambient screen (asked 2026-10-06: "the behaviour of a Google Nest"): a screen at rest shows the time, the
   weather and the days ahead, the day's plan from the calendar, what needs you, quick buttons and — in DOCA's phone
   app — the apps used most on the device; along its bottom fifth the dots turn as a galaxy seen from the side.
   Holding the galaxy (or the ◉ beside it), a quick button or saying the wake word starts a call: the background dims
   and the dots rise to where a call's face is. When nothing more is asked for `call.assistantIdleSec`, the call ends,
   the dots go back down and turn again, and the screen listens for its name (wakeWord, `ambient.listen`) — the
   microphone is given up whenever a call or a recording needs it. Best by itself: /?view=ambient. Its page is made
   here (index.html is at its line ceiling); the server's half is modules/ambient. */
const AMB = { on: false, face: null, closeFeed: null, clock: null, data: null, tick: null, s: {}, calling: false, own: false, starting: false, hold: null, refresh: null, hear: {} };

function ambientIsOpen() { return AMB.on && !document.hidden; }

/** Shown or left (nav.js). */
async function ambientTab(shown) {
  if (!shown) return _ambStop();
  if (AMB.on) return;
  AMB.on = true;
  if (!document.getElementById('amb-info')) _ambFrame();
  try { AMB.s = (await screenLoad(true)).settings?.ambient || {}; } catch { AMB.s = {}; }
  _ambLayout();
  _ambHint();
  _ambClock(); AMB.clock = setInterval(_ambClock, 1000);
  _ambLoad(); AMB.refresh = setInterval(_ambLoad, 60000);
  AMB.tick = setInterval(_ambTick, 1000);
  const spec = await faceSpec().catch(() => ({}));
  if (!AMB.on) return;
  const steady = Object.fromEntries(Object.keys(FACE_STATES).map(k => [k, { ...(spec.states?.[k] || {}), c: 1 }]));
  // As the call looks (asked 2026-10-06): the form with a sparse field of light around it — at rest the form is the galaxy.
  AMB.face = faceMount(document.getElementById('amb-canvas'), { ...spec, form: 'ambient', hud: false, vignette: false,
    clear: true, settle: false, dots: Math.max(600, Math.min(1400, spec.ambientDots || 1100)), states: steady });
  AMB.closeFeed = faceFeed(s => { if (Date.now() > _faceVoiceUntil) AMB.face?.set(s.state, s.detail); });
  _ambApps();
  if (typeof wakeWordApply === 'function') wakeWordApply();
  navigator.wakeLock?.request('screen').then(l => { AMB.lock = l; }).catch(() => {});
}

function _ambStop() {
  if (!AMB.on) return;
  AMB.on = false;
  clearInterval(AMB.clock); clearInterval(AMB.tick); clearInterval(AMB.refresh);
  AMB.face?.stop(); AMB.closeFeed?.(); AMB.face = null; AMB.closeFeed = null;
  AMB.lock?.release?.().catch(() => {});
  if (typeof wakeWordApply === 'function') wakeWordApply();
}

function _ambFrame() {
  const page = document.getElementById('tab-ambient');
  page.innerHTML = `<div class="amb" id="amb">
    <div class="amb-info" id="amb-info">
      <section class="amb-clock"><div class="amb-time" id="amb-time"></div><div class="amb-date" id="amb-date"></div></section>
      <section class="amb-weather" id="amb-weather"></section>
      <section class="amb-plan"><h3>Today</h3><div id="amb-plan"></div></section>
      <section class="amb-notices"><h3>For you</h3><div id="amb-notices"></div></section>
      <section class="amb-quick"><div class="amb-buttons" id="amb-buttons"></div><div class="amb-apps" id="amb-apps"></div></section>
    </div>
    <canvas class="amb-canvas" id="amb-canvas" aria-label="What the hive is doing"></canvas>
    <div class="amb-band" id="amb-band" title="Hold to talk"></div>
    <div class="amb-status" id="amb-status"></div><div class="amb-hint" id="amb-hint"></div>
    <button class="amb-talk" id="amb-talk" title="Talk — tap, or hold the galaxy" aria-label="Talk">◉</button>
    <button class="amb-edit" onclick="ambientArrange()" title="Arrange this screen: where it is, its buttons">✎</button>
    ${typeof SOLO_PAGE !== 'undefined' && SOLO_PAGE === 'ambient' ? '' : '<button class="amb-alone btn btn-xs" onclick="location.href=\'/?view=ambient\'" title="This screen as an ambient screen, nothing else">⛶ Use this screen</button>'}
  </div>`;
  const band = document.getElementById('amb-band');
  const cancel = () => { clearTimeout(AMB.hold); AMB.hold = null; band.classList.remove('holding'); };
  band.addEventListener('pointerdown', () => { band.classList.add('holding'); AMB.hold = setTimeout(() => { cancel(); ambientTalk(); }, 450); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(e => band.addEventListener(e, cancel));
  document.getElementById('amb-talk').onclick = () => ambientTalk();
  // Its own controls rest out of sight (U3) and come back for a moment when the screen is touched or the mouse moves.
  const amb = document.getElementById('amb');
  const wake = () => { amb.classList.add('awake'); clearTimeout(AMB.awake); AMB.awake = setTimeout(() => amb.classList.remove('awake'), 3500); };
  amb.addEventListener('pointermove', wake); amb.addEventListener('pointerdown', wake);
}

/** Talk: the call starts inside the gesture (its audio may play), the dots rise. During a call: end it. */
async function ambientTalk(first) {
  if (AMB.starting) return;
  if (_assistantInCall()) { if (!first) _callStop(); else if (typeof _callAnswer === 'function') _callAnswer(first); return; }
  const before = document.querySelectorAll('#chat-messages .chat-msg.system').length;
  // While the call opens (services checked, the microphone opened) the screen stays up and nothing else takes the
  // microphone — the once-a-second check used to read "no call yet" as "call over" and dropped it (2026-10-06).
  AMB.starting = true;
  const started = chatToggleCall({ assistant: true });
  AMB.own = true;
  _ambCalling(true);
  ambientSay('Listening…');
  let ok = false;
  try { ok = await started; } finally { AMB.starting = false; }
  if (!ok && !_assistantInCall()) {
    const why = (typeof _callNotStarted === 'string' && _callNotStarted)   // the call's own reason (chat-call-report.js), else the chat's
      || [...document.querySelectorAll('#chat-messages .chat-msg.system')].slice(before).pop()?.textContent;
    ambientSay(why ? (/did not start/.test(why) || /^No speech service/.test(why) ? why : `The call did not start: ${why}`) : 'The call did not start.');
    AMB.own = false; _ambCalling(false, true);
    return;
  }
  if (first && typeof _callAnswer === 'function') _callAnswer(first);
}

function _ambCalling(on, keepSay) {
  AMB.calling = on;
  document.getElementById('amb')?.classList.toggle('calling', on);
  AMB.face?.rise(on ? 1 : 0);
  if (!on && !keepSay) ambientSay('');
  _ambHint();
}

/** Once a second: follow the call, and end one this screen started after its quiet time — the dots go back down. */
async function _ambTick() {
  if (AMB.starting) return;   // a call opening is not a call over
  const inCall = _assistantInCall();
  if (inCall !== AMB.calling) { _ambCalling(inCall); if (!inCall) { AMB.own = false; if (typeof wakeWordApply === 'function') wakeWordApply(); } }
  if (!inCall || !AMB.own || typeof _callIdleMs !== 'function') return;
  let c = {};
  try { c = (await screenLoad()).settings?.call || {}; } catch { /* the default */ }
  if (_callIdleMs() >= (c.assistantIdleSec >= 5 ? c.assistantIdleSec : 12) * 1000) _callStop('quiet for the ambient screen\'s idle time');
}

function ambientSay(text) { const el = document.getElementById('amb-status'); if (el) el.textContent = text || ''; }

/** What the wake word is doing (wake-word.js): listening for which word, what it last understood, whether it needs a touch. */
function ambientHearing(info) {
  AMB.hear = { ...AMB.hear, ...info };
  if (info.heard !== undefined) { AMB.hear.at = Date.now(); setTimeout(_ambHint, 4200); }
  _ambHint();
}

/** The faint line under the galaxy at rest: how to talk, what was heard, or that the screen needs one touch to listen. */
function _ambHint() {
  const el = document.getElementById('amb-hint');
  if (!el) return;
  const h = AMB.hear;
  el.textContent = AMB.calling ? ''
    : h.listening && h.suspended ? 'Tap the screen once so it can listen'
    : h.at && Date.now() - h.at < 4000 && h.heard ? (h.called ? `“${h.heard}”` : `heard “${String(h.heard).slice(0, 60)}” — say “${h.word}” first`)
    : h.listening ? `Say “${h.word}”, or hold the galaxy` : 'Hold the galaxy to talk';
}

/** Margins and what is shown, from this screen's settings (ambient-settings.js). */
function _ambLayout() {
  const amb = document.getElementById('amb'), s = AMB.s;
  if (!amb) return;
  amb.style.setProperty('--amb-mx', `${s.margin ?? 7}%`);
  amb.style.setProperty('--amb-my', `${s.marginY ?? 6}%`);
  for (const k of ['clock', 'weather', 'plan', 'notices', 'buttons', 'apps']) amb.classList.toggle(`amb-no-${k}`, !ambShown(s, k));
}

function ambientVoice(state, level) { if (AMB.face && AMB.calling) { AMB.face.set(state); AMB.face.level(level); } }

function _ambClock() {
  const now = new Date(), t = document.getElementById('amb-time');
  if (!t) return;
  t.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: AMB.s.clock24 === false });
  document.getElementById('amb-date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

async function _ambLoad() {
  try {
    const place = await ambientWhere(AMB.s);
    const q = new URLSearchParams({ place, units: AMB.s.units || 'metric', ...(place && !AMB.s.place ? { here: '1' } : {}) });
    AMB.data = await apiFetch(`/api/ambient?${q}`);
    AMB.s = await ambientRemember(AMB.s, AMB.data.weather);   // a fresh position, kept as this screen's (ambient-where.js)
  } catch (e) { AMB.data = { error: e.message }; }
  _ambDraw();
}

const _ambTime = iso => (/T/.test(iso || '') ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: AMB.s.clock24 === false }) : 'all day');
const _ambDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: 'short' });

function _ambDraw() {
  const d = AMB.data || {}, w = d.weather, wEl = document.getElementById('amb-weather');
  if (!wEl) return;
  wEl.innerHTML = !w ? ambientWhereChoices()
    : w.error ? `<div class="amb-muted">Weather: ${escHtml(w.error)}</div>`
      : `<div class="amb-now"><span class="amb-icon">${w.now.icon}</span><span class="amb-temp">${Math.round(w.now.temp)}${w.unit}</span>
          <span class="amb-what">${escHtml(w.now.text)}<br><small>feels ${Math.round(w.now.feels)}° · ${Math.round(w.now.windSpeed)} ${w.wind}</small></span></div>
        <div class="amb-place" title="${escHtml(d.where?.said || '')}">${w.here ? '◎ ' : ''}${escHtml(w.place)}</div>
        <div class="amb-days">${w.days.slice(1, 6).map(x => `<div class="amb-day"><b>${_ambDay(x.date)}</b><span>${x.icon}</span>
          <span>${Math.round(x.max)}° <small>${Math.round(x.min)}°</small></span>${x.rain ? `<small>${x.rain}%</small>` : ''}</div>`).join('')}</div>`;
  const cal = d.calendar || {};
  document.getElementById('amb-plan').innerHTML = cal.events?.length
    ? cal.events.map(e => `<div class="amb-event"><span class="amb-when">${_ambTime(e.start)}</span><span>${escHtml(e.title)}${e.where ? `<small> · ${escHtml(e.where)}</small>` : ''}</span></div>`).join('')
    : `<div class="amb-muted">${escHtml(cal.none || 'Nothing else today.')}</div>`;
  const icon = { ask: '?', propose: '◆', working: '⟳', done: '✓', failed: '✕' };
  document.getElementById('amb-notices').innerHTML = (d.notices || []).length
    ? d.notices.map(n => `<button class="amb-notice ${n.kind}" onclick="_ambOpen(${jsArg(n.page || 'harness')})"><span>${icon[n.kind] || '·'}</span>${escHtml(n.text)}</button>`).join('')
    : '<div class="amb-muted">Nothing needs you.</div>';
  const buttons = Array.isArray(AMB.s.buttons) ? AMB.s.buttons.filter(b => b?.label && b?.say) : [];
  document.getElementById('amb-buttons').innerHTML = buttons.map((b, i) => `<button class="amb-button" onclick="_ambButton(${i})">${escHtml(b.label)}</button>`).join('');
}

function _ambButton(i) { const b = AMB.s.buttons?.[i]; if (b) ambientTalk(b.say); }
function _ambOpen(page) { if (typeof SOLO_PAGE !== 'undefined' && SOLO_PAGE) location.href = `/#${encodeURIComponent(page)}`; else nav(page); }

/** The apps used most on this device, where DOCA's phone app lends them (window.DocaDevice; docs/design/ambient.md). */
function _ambApps() {
  const el = document.getElementById('amb-apps'), dev = window.DocaDevice;
  if (!el || !dev?.apps) return;
  let apps = [];
  try { apps = JSON.parse(dev.apps(8)) || []; } catch { return; }
  el.innerHTML = apps.map((a, i) => `<button class="amb-app" onclick="_ambApp(${i})" title="${escHtml(a.label || a.package)}">
    ${a.icon ? `<img src="${escHtml(a.icon)}" alt="">` : '<span>▢</span>'}<small>${escHtml(a.label || '')}</small></button>`).join('');
  AMB.apps = apps;
}
function _ambApp(i) { const a = AMB.apps?.[i]; if (a) try { window.DocaDevice.open(a.package); } catch { /* the app said no */ } }

/** ✎: this screen's settings, the same form as Settings → Ambient (ambient-settings.js). */
function ambientArrange() {
  const box = document.createElement('div');
  box.className = 'amb-arrange';
  box.innerHTML = `<div class="amb-arrange-card card"><h3>This ambient screen</h3>${ambientFormHtml(AMB.s)}
    <div class="amb-arrange-row"><button class="btn" onclick="this.closest('.amb-arrange').remove()">Cancel</button>
      <button class="btn btn-teal" onclick="ambientArrangeSave(this)">Save</button></div></div>`;
  document.getElementById('amb').append(box);
}

async function ambientArrangeSave(btn) {
  const next = ambientFormRead(btn.closest('.amb-arrange-card'), AMB.s);
  btn.disabled = true;
  try { await screenSave({ ambient: next }); AMB.s = next; AMB_WHERE.coords = null; btn.closest('.amb-arrange').remove(); _ambLayout(); _ambClock(); _ambLoad(); if (typeof wakeWordApply === 'function') wakeWordApply(); }
  catch (e) { btn.disabled = false; btn.textContent = `Not saved: ${e.message}`; }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', () => {
  const page = Object.assign(document.createElement('div'), { className: 'tab-page', id: 'tab-ambient' });
  document.getElementById('tab-settings')?.before(page);
  document.addEventListener('visibilitychange', () => { if (AMB.on && !document.hidden) { _ambLoad(); _ambApps(); } });
});
