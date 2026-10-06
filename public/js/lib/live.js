/* Every page live on every screen (TODO H10.5): one stream of changes per page (/api/live/stream, modules/live), and
   each page redraws the part that changed. `liveOn(topic, fn)` hears a topic — `conversation`, `missions`, `files` —
   and returns a function that stops hearing it; `liveFolders(key, folders)` says which folders a part of the page shows
   (the Files tab, a project's tree and its open files), and a `files` change names the folder. The stream opens with the
   first subscriber and reconnects by itself; on reconnecting every subscriber hears `{what: 'resync'}`, since changes
   made while it was away were not heard. */
let _liveES = null, _liveScreen = null, _liveWasOpen = false;
const _liveSubs = new Set();
const _liveFolderSets = new Map();   // a part of the page → the folders it shows
let _liveFolderTimer = null;

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
      if (_liveFolderSets.size) _liveSendFolders();
      if (_liveWasOpen) for (const s of _liveSubs) try { s.fn({ topic: s.topic, what: 'resync' }); } catch { /* one part never breaks another */ }
      _liveWasOpen = true;
      return;
    }
    for (const s of _liveSubs) if (s.topic === c.topic) try { s.fn(c); } catch { /* one part never breaks another */ }
  };
  _liveES.onerror = () => { _liveScreen = null; };   // EventSource reconnects by itself; a new hello names the new stream
}
