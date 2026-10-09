'use strict';

/**
 * Agents' computer containers that no record of this hub names, shown anyway (asked 2026-10-10: a `doca-computer-*`
 * container was running — another install's, a test hub's — and the Workstream said it started while Live said
 * "Nothing to watch yet", because Live listed only the computers this hub has records of). Read through
 * computers/strays.js (its `docker ps` of every `doca-computer-*` no record names) at most every TTL_MS, only while a
 * page asks. A running one is a computer tile in Live and a row in the status column, labelled "not DOCA's record" and
 * whose label it carries (this install's, another install's, none). Its screen is pictured from inside the container —
 * the image's own ffmpeg grabbing its X display — by `docker exec` (cmd-shots.js): no token is read, nothing is driven.
 * Archiving or deleting one stays a person's, in Computers → Not DOCA's records.
 */
const TTL_MS = 5000;
let _cache = null, _pending = null;

/** The running computer containers no record names, at most TTL_MS old. */
function list() {
  if (_cache && Date.now() - _cache.at < TTL_MS) return Promise.resolve(_cache.list);
  if (!_pending) {
    _pending = require('../computers/strays').list().catch(() => [])
      .then(all => { const list = all.filter(s => s.state === 'running'); _cache = { at: Date.now(), list }; return list; })
      .finally(() => { _pending = null; });
  }
  return _pending;
}

const P = () => { try { return require('../branding').name('product'); } catch { return 'DOCA'; } };
const whose = s => (s.install === 'this' ? `made by this ${P()}` : s.install === 'another' ? `made by another ${P()} install` : 'made before installs were labelled');
/** The words under its name: "not DOCA's record · made by another DOCA install". */
const detail = s => `not ${P()}'s record · ${whose(s)}`;

const keyOf = name => `stray:${name}`;
/** The command that pictures it: its own ffmpeg, its own display, a PNG on its output. */
const source = s => ({ key: keyOf(s.name), bin: require('../containers').cli(),
  args: ['exec', s.name, 'sh', '-c', 'ffmpeg -loglevel error -f x11grab -video_size "${SCREEN:-1280x800}" -i "${DISPLAY:-:1}" -frames:v 1 -f image2 -vcodec png -'] });

module.exports = { list, detail, whose, keyOf, source, TTL_MS, _reset: () => { _cache = null; } };
