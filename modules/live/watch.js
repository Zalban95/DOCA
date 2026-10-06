'use strict';

/**
 * Folders a screen is looking at, watched while it looks (TODO H10.5). Whatever writes there — the agent's tools, a
 * shell, git, a person on another screen, a program of their own — the screen hears `files` for that folder and
 * re-reads it. Watching is per folder and not recursive: `fs.watch` on one directory costs one handle on Linux,
 * Windows and macOS alike and reports its entries changing (a file's contents included), where a recursive watch of a
 * project would hold one per subfolder of node_modules. A screen asks for the folders it shows; a folder two screens
 * show is watched once; the watch ends when the last screen lets go.
 */
const fs = require('fs');
const path = require('path');

const MAX_PER_SCREEN = 200;
const _watches = new Map();   // folder → { watcher, screens: Set, timer }
const _screens = new Map();   // screen → Set of folders

/** Changes in one folder, gathered for a moment so a save that writes three times is one change. */
function _fire(dir) {
  const w = _watches.get(dir);
  if (!w || w.timer) return;
  w.timer = setTimeout(() => { w.timer = null; require('./index').changed('files', dir, 'changed'); }, 150);
  w.timer.unref?.();
}

function _hold(dir, screen) {
  let w = _watches.get(dir);
  if (!w) {
    let watcher;
    try { watcher = fs.watch(dir, { persistent: false }, () => _fire(dir)); } catch { return false; }   // gone, or not a folder
    watcher.on('error', () => _drop(dir));
    w = { watcher, screens: new Set(), timer: null };
    _watches.set(dir, w);
  }
  w.screens.add(screen);
  return true;
}

function _drop(dir, screen = null) {
  const w = _watches.get(dir);
  if (!w) return;
  if (screen) w.screens.delete(screen); else w.screens.clear();
  if (w.screens.size) return;
  try { w.watcher.close(); } catch { /* closed */ }
  clearTimeout(w.timer);
  _watches.delete(dir);
}

/** The folders this screen shows now, replacing what it showed before. @returns the folders being watched */
function set(screen, folders = []) {
  const want = new Set([...new Set(folders)].filter(f => typeof f === 'string' && path.isAbsolute(f)).slice(0, MAX_PER_SCREEN));   // as the screen wrote it, so it knows its own folder in the change
  const had = _screens.get(screen) || new Set();
  for (const dir of had) if (!want.has(dir)) _drop(dir, screen);
  const held = new Set([...want].filter(dir => (had.has(dir) && _watches.get(dir)?.screens.has(screen)) || _hold(dir, screen)));
  if (held.size) _screens.set(screen, held); else _screens.delete(screen);
  return [...held];
}

/** A screen went away. */
const release = screen => set(screen, []);
/** How many folders are watched, for the tests. */
const count = () => _watches.size;

module.exports = { set, release, count, MAX_PER_SCREEN };
