'use strict';

/**
 * How long an agent's computer lives (TODO H13.2): agents make one whenever the work needs a real
 * environment, so nobody is expected to tidy up after them.
 *
 * - When the mission it was lent to ends, it stops `idleStopMinutes` later — unless it was lent again,
 *   a person pinned it, or a turn still uses it (`inUse`). Stopped, it keeps its files.
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

/**
 * Why a computer is still in use although its mission ended, or null (deep test A, #8): a message to the finished
 * mission's conversation started a turn there that used the computer, and the sweep stopped it under that turn, 2 s
 * after its last call. In use: a turn running in a conversation that holds it (the mission's, the one that made it,
 * the one that last used it), or any turn that called its tools within `idleStopMinutes` (machines/index.js actOf).
 */
function inUse(c, missionId) {
  const running = id => !!id && require('../harness/turn/lifecycle').isRunning(id);
  const act = require('../machines/index').actOf(c.id);
  const holders = [require('../agents/missions').get(missionId)?.sessionId, c.by, act?.sessionId];
  if (holders.some(running)) return 'a turn is running in a conversation that holds it';
  if (act && Date.now() - act.at < Math.max(1, limit('idleStopMinutes')) * 60000)
    return `an agent used it ${Math.round((Date.now() - act.at) / 1000)} s ago (${act.what})`;
  return null;
}

/** A mission ended (agents/missions announce): its computer stops a little later, if nothing took it over or uses it. */
function missionEnded(missionId) {
  for (const c of require('./index').all().filter(x => x.missionId === missionId && !x.pinned)) arm(c, missionId, limit('idleStopMinutes') * 60000);
}

function arm(c, missionId, ms) {
  const computers = require('./index');
  clearTimeout(_timers.get(c.id));
  const t = setTimeout(() => {
    _timers.delete(c.id);
    const now = computers.get(c.id);
    if (!now || now.pinned || now.missionId !== missionId) return;   // pinned, removed, or lent again
    if (require('../agents/missions').get(missionId)?.state === 'running') return;   // resumed
    // Never under a live turn: looked at again a period later (at least a minute, so a 0 does not spin).
    if (inUse(now, missionId)) return arm(now, missionId, Math.max(1, limit('idleStopMinutes')) * 60000);
    computers.stop(c.id).catch(() => {});
    require('../activity').note({ from: 'computers', what: `stopped ${c.name || c.id}`, why: `idle ${limit('idleStopMinutes')} min after its mission ${missionId} ended`, machine: { kind: 'computer', id: c.id, name: c.name }, act: 'stop', ok: true });
  }, ms);
  t.unref?.();
  _timers.set(c.id, t);
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

module.exports = { limit, roomForOne, missionEnded, inUse, sweep, start };
