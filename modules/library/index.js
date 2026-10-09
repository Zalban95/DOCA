'use strict';

/**
 * The Library (experiment `library`, docs/experiments/library.md): the files of this machine, in the folders the owner
 * chose, indexed by meaning — documents, pictures, sound and video in one embedding space — and searched from Files,
 * by `library_search`, and as "files like this one". Nothing runs and nothing downloads until the experiment is on,
 * a model is set and a folder is chosen.
 *
 * When indexing runs is `library.when`: on demand (the section's Index), on a schedule (every `library.everyHours`,
 * checked by a ticker started after listen), or while the panel is open — the chosen folders watched only while a
 * person has a page of the panel visible (presence.js), a change starting a run a little later. The ticker does
 * nothing at all while the experiment is off.
 */
const fs = require('fs');
const path = require('path');
const I = require('./indexer');

const TICK_MS = 30 * 1000, SETTLE_MS = 60 * 1000, LAST = 'library-last-run';
let _timer = null, _watchers = [], _dirty = 0;

const sc = () => require('../settings-schema');
const on = () => I.on() && (sc().value('library.folders') || []).length > 0;

function lastRun() { return require('../store').readJson(LAST, {})?.at || null; }
function remember() { try { require('../store').writeJson(LAST, { at: new Date().toISOString() }); } catch { /* the next tick tries again */ } }

function unwatch() { for (const w of _watchers) { try { w.close(); } catch { /* gone */ } } _watchers = []; }

/** Watch the chosen folders (recursive where the OS has it); a change marks the index dirty. */
function watch() {
  if (_watchers.length) return;
  for (const f of sc().value('library.folders') || []) {
    const dir = require('./scan').allowedFolder(f);
    if (!dir) continue;
    try {
      const w = fs.watch(dir, { recursive: true, persistent: false }, (_e, name) => { if (name && !String(name).split(path.sep).some(s => s.startsWith('.'))) _dirty = _dirty || Date.now(); });
      w.on('error', () => {});
      _watchers.push(w);
    } catch { /* a folder that cannot be watched is indexed on demand */ }
  }
}

function tick() {
  if (!on()) { unwatch(); return; }
  const when = sc().value('library.when');
  if (when === 'schedule') {
    unwatch();
    const last = Date.parse(lastRun() || 0) || 0;
    if (!I.running() && Date.now() - last >= sc().value('library.everyHours') * 3600e3) { remember(); try { I.start({ why: 'schedule' }); } catch { /* said in the section */ } }
    return;
  }
  if (when !== 'watch') { unwatch(); return; }
  const seen = Date.now() - require('../presence').lastVisibleAt() < require('../presence').FRESH_MS;
  if (!seen) { unwatch(); return; }
  watch();
  if (_dirty && Date.now() - _dirty >= SETTLE_MS && !I.running()) { _dirty = 0; remember(); try { I.start({ why: 'watch' }); } catch { /* said in the section */ } }
}

function start() {
  if (_timer) return;
  _timer = setInterval(tick, TICK_MS);
  if (_timer.unref) _timer.unref();
}
function stopTicker() { if (_timer) clearInterval(_timer); _timer = null; unwatch(); }

/** Index now, asked by a person (the section's Index). */
function run(person) { remember(); return I.start({ why: 'demand', person }); }

module.exports = { on, start, stopTicker, tick, run, lastRun, watching: () => _watchers.length > 0 };
