'use strict';

/**
 * How long an agent's computer lives (TODO H13.2): agents make one whenever the work needs a real
 * environment, so nobody is expected to tidy up after them.
 *
 * - When the mission it was lent to ends, it stops `idleStopMinutes` later — unless it was lent again,
 *   or a person pinned it. Stopped, it keeps its files.
 * - One an agent made and nobody pinned is removed, files and all, `retainHours` after it stopped.
 * - At most `maxRunning` run at once; making one more is refused with the setting's name.
 *
 * All three are under `computers` in prefs (declared in settings-schema.js, proposable), read on every use.
 */
const SWEEP_MS = 30 * 60 * 1000;

/** `maxRunning`, `idleStopMinutes`, `retainHours`: declared with their defaults in settings-schema.js. */
const limit = key => require('../settings-schema').value(`computers.${key}`);

/** Refuses a new computer past the cap, saying which setting it is and how to get under it. */
async function roomForOne() {
  const max = limit('maxRunning');
  const running = (await require('./index').list()).filter(c => c.state === 'running');
  if (running.length >= max)
    throw Object.assign(new Error(`${running.length} computers are running, and computers.maxRunning is ${max} (a DOCA setting). `
      + `Stop one you are done with (computer stop: ${running.map(c => c.id).join(', ')}), or propose raising the setting.`), { status: 409 });
}

const _timers = new Map();

/** A mission ended (agents/missions announce): its computer stops a little later, if nothing took it over. */
function missionEnded(missionId) {
  const computers = require('./index');
  for (const c of require('./index').all().filter(x => x.missionId === missionId && !x.pinned)) {
    clearTimeout(_timers.get(c.id));
    const t = setTimeout(() => {
      _timers.delete(c.id);
      const now = computers.get(c.id);
      if (!now || now.pinned || now.missionId !== missionId) return;   // pinned, removed, or lent again
      if (require('../agents/missions').get(missionId)?.state === 'running') return;   // resumed
      computers.stop(c.id).catch(() => {});
      require('../activity').note({ from: 'computers', what: `stopped ${c.name || c.id}`, why: `idle ${limit('idleStopMinutes')} min after its mission ${missionId} ended`, machine: { kind: 'computer', id: c.id, name: c.name }, act: 'stop', ok: true });
    }, limit('idleStopMinutes') * 60000);
    t.unref?.();
    _timers.set(c.id, t);
  }
}

/** Remove what agents made, nobody pinned, and has been stopped longer than `retainHours`. */
async function sweep(now = Date.now()) {
  const computers = require('./index');
  const keep = limit('retainHours') * 3600000;
  const gone = [];
  for (const c of await computers.list()) {
    const row = computers.get(c.id);
    if (!row?.auto || row.pinned || c.state === 'running') continue;
    const since = Date.parse(row.stoppedAt || row.createdAt);
    if (now - since > keep) {
      await computers.remove(c.id).catch(() => {}); gone.push(c.id);
      require('../activity').note({ from: 'computers', what: `removed ${c.name || c.id}, which an agent made`, why: `stopped more than ${limit('retainHours')} h and not pinned`, machine: { kind: 'computer', id: c.id, name: c.name }, act: 'remove', ok: true });
    }
  }
  return gone;
}

let _sweeper = null;
function start() {
  if (_sweeper) return;
  // And containers no record names (strays.js) — here, not in sweep(), so a test of the sweep never meets this machine's Docker.
  _sweeper = setInterval(() => { sweep().catch(() => {}); require('./strays').sweep().catch(() => {}); }, SWEEP_MS);
  _sweeper.unref?.();
}

module.exports = { limit, roomForOne, missionEnded, sweep, start };
