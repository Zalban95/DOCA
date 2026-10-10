/* Every page live on every screen (TODO H10.5): one stream of changes per page (/api/live/stream, modules/live), and
   each page redraws the part that changed. `liveOn(topic, fn)` hears a topic — `conversation`, `missions`, `files` —
   and returns a function that stops hearing it; `liveFolders(key, folders)` says which folders a part of the page shows
   (the Files tab, a project's tree and its open files), and a `files` change names the folder. The stream opens with the
   first subscriber and reconnects by itself; on reconnecting every subscriber hears `{what: 'resync'}`, since changes
   made while it was away were not heard. A stream the browser gave up on (a phone that slept, a hub that restarted
   and answered an error meanwhile) is opened again after a few seconds and when the page is shown again;
   `liveRestart()` opens a new one at once (a route said it no longer knows this page's stream), and `liveReady()` waits
   for the stream's hello — however long the reconnecting takes, up to the wait asked for. */
let _liveES = null, _liveScreen = null, _liveWasOpen = false;
const _liveSubs = new Set();
const _liveFolderSets = new Map();   // a part of the page → the folders it shows
let _liveFolderTimer = null;
const _liveWaiters = new Set();   // liveReady()'s promises, settled by the next hello

function liveOn(topic, fn) {
  const sub = { topic, fn };
  _liveSubs.add(sub);
  _liveStart();
  return () => _liveSubs.delete(sub);
}

/** `fn` at most once per `ms`, and once more after the last call: a burst of changes is one redraw. */
function liveDebounce(fn, ms = 400) {
  let t = null, last = 0;
  return (...a) => {
    clearTimeout(t);
    const wait = Math.max(0, ms - (Date.now() - last));
    t = setTimeout(() => { last = Date.now(); fn(...a); }, wait);
  };
}

/** The folders one part of the page shows now (an empty list lets go). */
function liveFolders(key, folders) {
  if (folders?.length) _liveFolderSets.set(key, [...new Set(folders)]); else _liveFolderSets.delete(key);
  _liveStart();
  clearTimeout(_liveFolderTimer);
  _liveFolderTimer = setTimeout(_liveSendFolders, 200);
}

function _liveSendFolders() {
  if (!_liveScreen) return;
  const folders = [...new Set([..._liveFolderSets.values()].flat())];
  apiFetch('/api/live/watch', { method: 'POST', body: { screen: _liveScreen, folders } }).catch(() => { /* not a host, or reconnecting */ });
}

function _liveStart() {
  if (_liveES || typeof EventSource === 'undefined') return;
  _liveES = new EventSource('/api/live/stream');
  _liveES.onmessage = e => {
    let c;
    try { c = JSON.parse(e.data); } catch { return; }
    if (c.hello) {
      _liveScreen = c.screen;
      for (const w of _liveWaiters) w(c.screen);
      _liveWaiters.clear();
      if (_liveFolderSets.size) _liveSendFolders();
      if (_liveWasOpen) for (const s of _liveSubs) try { s.fn({ topic: s.topic, what: 'resync' }); } catch { /* one part never breaks another */ }
      _liveWasOpen = true;
      return;
    }
    for (const s of _liveSubs) if (s.topic === c.topic) try { s.fn(c); } catch { /* one part never breaks another */ }
  };
  // EventSource reconnects by itself after a network error, and a new hello names the new stream; after an answer that
  // is not a stream (an error page while the hub restarts) it gives up for good (CLOSED), so this page opens it again.
  _liveES.onerror = () => {
    _liveScreen = null;
    if (_liveES?.readyState === 2) { _liveES = null; setTimeout(() => { if (_liveSubs.size || _liveWaiters.size) _liveStart(); }, 3000); }
  };
}

/** A new stream now: the hub no longer knows this page's (it said so), or the page came back from the background. */
function liveRestart() {
  try { _liveES?.close(); } catch { /* closed */ }
  _liveES = null; _liveScreen = null;
  _liveStart();
}

/** This page's stream's id once it has said hello (at once when it has), or null after `ms`. */
function liveReady(ms = 15000) {
  if (_liveScreen) return Promise.resolve(_liveScreen);
  _liveStart();
  return new Promise(resolve => {
    const w = s => { clearTimeout(t); resolve(s); };
    const t = setTimeout(() => { _liveWaiters.delete(w); resolve(null); }, ms);
    _liveWaiters.add(w);
  });
}

// Back from the background (a phone's screen, a tab): a stream the browser closed meanwhile is opened again.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  const back = () => { if (document.visibilityState !== 'hidden' && _liveSubs.size && (!_liveES || _liveES.readyState === 2)) liveRestart(); };
  document.addEventListener('visibilitychange', back);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('online', back);
}
