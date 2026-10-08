'use strict';

/**
 * The inference services and llama.cpp servers DOCA started, stopped when nothing uses them, stopped with DOCA when
 * ticked, and started again when a request needs one (asked 2026-10-08). Off by default in every part: an update
 * changes nothing until the owner switches it on (Settings → System → Services).
 *   targets.js   what may be stopped and started, and how
 *   usage.js     when each was last used (every request the hub sends to one), and who started it
 *   policy.js    the settings, whose each one is (managed), what holds them all on (a page open, a call)
 *   idle.js      the sweep, and what a row says
 *   demand.js    start when needed
 *   shutdown.js  stop with DOCA
 *   routes.js    the panel's side
 */
function start() {
  require('./usage').start();
  require('./idle').start();
}

module.exports = { start, ensure: (...a) => require('./demand').ensure(...a), use: (...a) => require('./usage').around(...a) };
