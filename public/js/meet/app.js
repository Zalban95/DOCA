/* A meeting inside one of the hive's apps: the page tells the app that holds it (window.DocaDevice, DocaMobile ≥ 1.5.0)
   when a meeting opens and closes, so the app keeps the call alive with the screen off or the app in the background
   (its foreground service, "In a meeting · Leave"), routes the sound (speaker, earpiece, headset) and offers picture in
   picture; and it hears the app back as the window event `doca-meeting` — {action: "leave"} from the notification,
   {pip: true|false} when the app shrinks into a corner. A plain browser has no DocaDevice and none of this runs.
   DocaDesk needs none of it: WebView2 has getDisplayMedia, and its window stays open in the tray. */
const _meetApp = () => (typeof window !== 'undefined' && typeof window.DocaDevice?.meeting === 'function' ? window.DocaDevice : null);

/** Tell the app the room is open (with what it carries) or closed. Never throws: the app is a help, not a need. */
function meetAppSay(open) {
  const dev = _meetApp();
  if (!dev) return;
  try {
    dev.meeting(JSON.stringify(open && MEET.id ? { open: true, id: MEET.id, title: MEET.meeting?.title || '', video: !!MEET.cam, sharing: !!MEET.screen,
      link: MEET.meeting?.link || `${location.origin}/meet/${MEET.id}` } : { open: false }));
  } catch { /* an older app */ }
}

/** Where the sound goes, on a phone: the app's answer {route, available}, or null where it cannot choose. */
function meetAudioRoute(next) {
  const dev = _meetApp();
  if (!dev || typeof dev.meetAudio !== 'function') return null;
  try { const r = JSON.parse(String(dev.meetAudio(next || ''))); MEET.audio = r; return r; } catch { return null; }
}

/** Speaker → earpiece → headset (what is plugged in), one press each. */
function meetAudioNext() {
  const now = MEET.audio || meetAudioRoute();
  if (!now?.available?.length) return;
  const list = now.available, i = list.indexOf(now.route);
  meetAudioRoute(list[(i + 1) % list.length]);
  meetDraw();
}

if (typeof window !== 'undefined') window.addEventListener('doca-meeting', e => {
  const d = e.detail || {};
  if (d.action === 'leave' && MEET.id) meetLeave();
  if (typeof d.pip === 'boolean' && MEET.id) { MEET.pip = d.pip; if (d.pip) MEET.folded = false; meetDraw(); }
  if (d.audio) { MEET.audio = d.audio; meetDraw(); }
});
