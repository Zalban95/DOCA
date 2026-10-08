'use strict';

/**
 * Computer containers no record names (self-test 2026-10-08, #25): a `docker run` that made the container and then
 * failed to start it threw before the record was saved, so the container sat in "created" for days, in no list.
 *
 * The tidy-up removes, with a line in the activity log:
 * - a container that never started ("created") and is over an hour old, whoever made it — it never ran, so nothing
 *   is in it, and its volume goes with it;
 * - a stopped one this install made (its `doca.install` label, since this change) that no record names — its
 *   volume is kept, since an agent's files may be in it, and the line names it.
 * A running container is never touched, and neither is a stopped one with another install's label: several DOCAs
 * (a test run, a second install) may share one Docker, and theirs are theirs. A stopped one with no label at all (made
 * before the label) is left alone unless the owner chose otherwise (`computers.strays`: archive or delete; the owner's
 * answer of 2026-10-08) — and the Computers tab lists every one under "Not DOCA's records", where a person archives
 * it (adopted as a computer, stopped, its files kept) or deletes it.
 */
const crypto = require('crypto');
const { execFile } = require('child_process');

const NEVER_STARTED_AFTER_MS = 3600000;
const NAME = /^doca-computer-([\w-]+)$/;
const POLICIES = ['leave', 'archive', 'delete'];
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

/** This install, as the label its computers carry: its data folder, hashed. */
const installId = () => crypto.createHash('sha256').update(require('../store').DATA_DIR).digest('hex').slice(0, 12);

const run = args => new Promise((resolve, reject) => execFile(require('../containers').cli(), args,
  { timeout: 60000, maxBuffer: 8 << 20, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(String(out)))));
const docker = args => module.exports.docker(args);   // a test stands in for Docker here; this machine's are never touched

/** Docker's "2026-10-07 16:34:24 +0200 CEST", which Date cannot read. */
function createdAt(s) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})/.exec(String(s || ''));
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : NaN;
}

const policy = () => require('../settings-schema').value('computers.strays');
const known = () => new Set(require('./index').all().map(c => `doca-computer-${c.id}`));
const stopped = state => state === 'exited' || state === 'dead';

/** Every computer container no record names: its state, when it was made, and whose label it carries. */
async function list({ docker: d = docker } = {}) {
  let out;
  try { out = await d(['ps', '-a', '--filter', 'name=^doca-computer-', '--format', '{{.Names}}\t{{.State}}\t{{.CreatedAt}}\t{{.Label "doca.install"}}\t{{.Status}}']); }
  catch { return []; }   // no docker here
  const names = known();
  return out.split('\n').filter(Boolean).map(l => l.split('\t')).filter(([name]) => NAME.test(name) && !names.has(name))
    .map(([name, state, created, install, status]) => {
      const t = createdAt(created);
      return { name, state, status: status || state, createdAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
        install: !install ? 'none' : install === installId() ? 'this' : 'another' };
    });
}

const need = async (name, d) => {
  const s = (await list({ docker: d })).find(x => x.name === String(name || ''));
  if (!s) throw bad(`No container ${name} that no computer names.`, 404);
  return s;
};

/** Archive: adopt it as a computer record in the Archive — stopped, its files kept, lent again like any computer. */
async function adopt(name, { docker: d = docker, why = 'a person archived it from the Computers tab' } = {}) {
  const s = await need(name, d);
  let info;
  try { info = JSON.parse(await d(['inspect', s.name]))[0]; } catch { throw bad(`Docker could not describe ${s.name}.`, 502); }
  const env = Object.fromEntries((info?.Config?.Env || []).map(e => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
  if (!env.TOKEN) throw bad(`${s.name} has no control token: it is not a computer this panel can use. Delete it instead.`, 409);
  const port = p => Number(info?.HostConfig?.PortBindings?.[`${p}/tcp`]?.[0]?.HostPort) || null;
  if (s.state === 'running') await d(['stop', '-t', '5', s.name]).catch(() => {});
  const computers = require('./index');
  const id = NAME.exec(s.name)[1], now = new Date().toISOString();
  const c = { id, name: `recovered ${id}`.slice(0, 40), purpose: 'A container no record named, adopted from Computers → Not DOCA\'s records.',
    missionId: null, by: null, auto: false, pinned: false, adopted: true, token: env.TOKEN, ...(env.FILL_KEY ? { fillKey: env.FILL_KEY } : {}),
    vncPassword: env.VNC_PASSWORD || '', mcpPort: port(8765), vncPort: port(6080), ...(port(computers.SERVE) ? { servePort: port(computers.SERVE) } : {}),
    createdAt: s.createdAt || info?.Created || now, stoppedAt: now, archivedAt: now };
  computers.save([...computers.rows(), c]);
  require('../activity').note({ from: 'computers', what: `archived the container ${s.name} as the computer ${id}`, why });
  return computers.view(c, 'exited');
}

/** Delete: the container goes; its volume (the agent's files) only when asked. */
async function discard(name, { volume = false, docker: d = docker, why = 'a person deleted it from the Computers tab' } = {}) {
  const s = await need(name, d);
  try { await d(['rm', '-f', s.name]); } catch (e) { throw bad(`Docker could not remove ${s.name}: ${e.message}`, 502); }
  if (volume) await d(['volume', 'rm', '-f', s.name]).catch(() => {});
  require('../activity').note({ from: 'computers', what: `removed the container ${s.name}${volume ? ' and its volume' : ''}`,
    why: volume ? why : `${why}; its files are kept in the volume ${s.name}` });
  return { removed: s.name, volume: !!volume };
}

/** What the tidy-up does with a stopped container no record names and no install labels (the owner's, not proposable). */
function setPolicy(value) {
  if (!POLICIES.includes(value)) throw bad(`computers.strays is one of ${POLICIES.join(', ')}.`);
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs();
  savePrefs({ ...prefs, computers: { ...(prefs.computers || {}), strays: value } });
  return { strays: value };
}

async function sweep({ now = Date.now(), docker: d = docker, choice = policy() } = {}) {
  let out;
  try { out = await d(['ps', '-a', '--filter', 'label=doca.computer=1', '--format', '{{.Names}}\t{{.State}}\t{{.CreatedAt}}\t{{.Label "doca.install"}}']); }
  catch { return []; }   // no docker here
  const names = known();
  const gone = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [name, state, created, install] = line.split('\t');
    if (!NAME.test(name) || names.has(name)) continue;
    if (!install && stopped(state) && choice !== 'leave') {   // made before the label: the owner's choice (computers.strays)
      const why = `it was stopped, no record named it and no install's label was on it; computers.strays is "${choice}"`;
      try { if (choice === 'archive') await adopt(name, { docker: d, why }); else await discard(name, { docker: d, why }); gone.push(name); } catch { /* left for a person */ }
      continue;
    }
    const neverStarted = state === 'created' && now - createdAt(created) > NEVER_STARTED_AFTER_MS;
    const oursStopped = install === installId() && state !== 'running' && state !== 'created' && state !== 'restarting';
    if (!neverStarted && !oursStopped) continue;
    try { await d(['rm', '-f', name]); } catch { continue; }
    if (neverStarted) await d(['volume', 'rm', '-f', name]).catch(() => {});
    gone.push(name);
    require('../activity').note({ from: 'computers', what: `removed the container ${name}, which no computer of this panel names`,
      why: neverStarted ? 'it was made but never started (a computer that failed to start), over an hour ago'
        : `it was stopped and its record is gone; its files are kept in the volume ${name}` });
  }
  return gone;
}

module.exports = { sweep, list, adopt, discard, setPolicy, installId, createdAt, POLICIES, docker: run };
