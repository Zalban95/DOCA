'use strict';

/**
 * What an important or safety switch asks before it changes (CONSTITUTION S14; the owner's decision of 2026-10-14).
 *
 * Signed in, a person is that person: most switches ask nothing more than a short notice — what the setting does and
 * why it matters — with Continue / Cancel and "Don't show this again" (remembered per person per switch on the hub,
 * auth/notices.js). The password is asked only where it protects what a stolen or borrowed signed-in session must not
 * do: restarting the hub or changing the version it runs, changing who may do what, Unattended, turning the guards off,
 * sending settings or backups that carry secrets somewhere else or writing them back, secrets for devices, the licence.
 * The panel sends the password with the request (`X-Doca-Password`, over the panel's own HTTPS, never stored or
 * logged; the unlock window, auth/unlock.js, covers several in a row), a notice's answer as `X-Doca-Notice: continue`
 * or `hide`; without them the gate answers 401 `password_required` or 428 `notice_required` naming the switch, and the
 * panel asks and sends the request again (public/js/lib/api.js). A device never meets either (its token is its
 * credential, /api/v1), and an agent never passes one: a guarded setting it proposes stays a proposal.
 *
 * What is guarded is this file:
 *   SWITCHES  each switch: what it is, and either `password` (why it asks, one line) or `notice` (what the person reads)
 *   ROUTES    a route that is a switch, with a `when` for routes that are one only for some bodies
 *   PREFS     settings paths that are switches, wherever a write of them comes from: POST /api/prefs, applying a
 *             proposal, restoring a checkpoint — and never applied by an agent alone (settings_propose's `asked` and
 *             Unattended leave them a proposal: toolbox/settings.js)
 */
const W = ['POST', 'PUT', 'PATCH', 'DELETE'];

const SWITCHES = {
  // ── The password: what a borrowed session must not do ──
  restart:        { what: 'restarting the hub', password: 'it stops every running turn, call and device job for everyone' },
  version:        { what: 'which version of DOCA runs', password: 'a version is every guard at once: an older one may have none of today\'s' },
  people:         { what: 'who has an account, and at what level', password: 'who may do what is the one thing a borrowed session could hand itself' },
  levels:         { what: 'levels, reach and grants', password: 'a level or a grant is what the agents and people may do: widening it is who may do what' },
  otherPassword:  { what: 'another person\'s password', password: 'it hands that person\'s account to whoever types the new one' },
  releasing:      { what: 'who may release unasked', password: 'it lets a model merge, tag and push without a person: a grant of who may do what' },
  packIn:         { what: 'bringing a pack in (it can carry a level, specialists and rules)', password: 'an edition can create or replace a level; an upload cannot be read before the gate' },
  unattended:     { what: 'Unattended (nothing is asked, proposals apply themselves)', password: 'it removes every question a person would otherwise answer' },
  outsideFree:    { what: 'an outside harness starting on its own ("On its own")', password: 'it lets the Orchestrator start another vendor\'s agent, which runs every command unasked in an agents\' computer, without asking you' },
  guardsOff:      { what: 'turning a guard off, loosening or removing it', password: 'the guards are what stands between outside text and the agents' },
  restoreSettings:{ what: 'restoring settings', password: 'it writes back every setting, the password-guarded ones included' },
  restoreBackup:  { what: 'restoring a backup', password: 'it replaces the settings and the keys with what the backup holds' },
  backupOut:      { what: 'where backups are copied to', password: 'a backup carries the hive\'s keys: pointing it somewhere else sends them there' },
  machineBackup:  { what: 'this machine\'s backup: its password, or restoring files', password: 'it hands the backup\'s password to the page, or writes over files on disk' },
  exportChats:    { what: 'exporting every hive-chat conversation', password: 'the one way anyone reads conversations they are not in' },
  sealed:         { what: 'secrets for devices', password: 'a secret kept or replaced is one the agents will type on a device' },
  licence:        { what: 'the licence', password: 'the licence decides which features exist here; a wrong one turns them read-only' },
  door:           { what: 'unlocking a door or disarming an alarm', password: 'it opens a house: a borrowed session must not' },
  peopleModels:   { what: 'which models people run on', password: 'it decides what every person\'s agents run on and spend: a borrowed session must not hand itself a model (2026-10-16)' },

  // ── A notice: what it does and why it matters, then Continue ──
  approval:       { what: 'the approval mode', notice: 'The approval mode decides which of the agents\' actions wait for your click. On Auto they act without asking; on Manual they ask first.' },
  always:         { what: 'the always-allowed list', notice: 'A command on this list runs without asking. Taking one off means the agents ask before running it again.' },
  convApproval:   { what: 'a conversation\'s approval switch', notice: 'This conversation\'s own switch overrides the panel\'s approval mode: on Auto its agent acts without asking you.' },
  specialists:    { what: 'the specialists switch', notice: 'Specialists are agents the Orchestrator sends off to work on their own, with their own tools, several at once.' },
  developer:      { what: 'developer mode and releasing', notice: 'Developer mode shows the experiments — features still being measured, which may change or misbehave. It is meant for the project\'s owners and testers.' },
  experiment:     { what: 'an experiment', notice: 'An experiment is a feature still being measured: it may change what the agents do, cost more, or misbehave. Its write-up says what to expect.' },
  sharing:        { what: 'sharing with the project', notice: 'Sharing lets you offer what the agents learned — skills, recipes, specialists — to the project. Nothing leaves without your click on each pack.' },
  network:        { what: 'how the hub listens', password: 'opening the hub to more networks is exposure a borrowed session must not hand out (2026-10-14)' },
  castDoor:       { what: 'the cast door (a plain-HTTP way in for devices on this network)', notice: 'The cast door lets a screen on this network show a page without the hub\'s certificate. What goes through it is not encrypted.' },
  tracing:        { what: 'what is kept of each turn', notice: 'Traces keep what each turn did — models, tools, timings, never the words. Keeping less leaves less to look back on when something goes wrong.' },
  logs:           { what: 'what is kept of what happened', notice: 'These bounds decide how long the record of what happened is kept. Shorter keeps less to look back on when something goes wrong.' },
  prices:         { what: 'the prices money budgets are counted in', notice: 'Money budgets are counted in these prices. A wrong price lets a turn spend more — or less — than its budget meant.' },
  spending:       { what: 'spending: budgets and permissions', notice: 'Budgets and spending permissions decide how much the agents may spend, and on what, for each person.' },
  cert:           { what: 'trusting a server\'s own certificate', notice: 'The hub will believe whoever shows this certificate is that server. Trust it only for a server you know.' },
  relayDevice:    { what: 'the model relay for a device that can send text', password: 'a device that types its own requests spends the hub\'s models as the person who paired it' },
  testComputer:   { what: 'a test computer (sign-ins without asking)', notice: 'A test computer\'s browser types passwords and clicks sign-ins without asking you. Use it only with test accounts.' },
  guards:         { what: 'the guards', notice: 'The guards screen text from outside for instructions aimed at the agents. A change here changes what gets through.' },
};

/** Settings that are switches. A path guards everything under it; the first row that matches a change decides. */
const PREFS = [
  ['harness.approval.mode', 'unattended', null, to => to === 'unattended'],   // only Unattended asks for the password
  ['teams.outside.use', 'outsideFree', null, (to, from) => newlyFree(to, from)],   // only moving one to "free"; tightening asks nothing (2026-10-16)
  ['harness.approval', 'approval'],
  ['agents.enabled', 'specialists'],
  ['developer.releaseUnasked', 'releasing'],
  ['developer', 'developer'],
  ['experiments', 'experiment'],
  ['sharing', 'sharing'],
  ['network', 'network'],
  ['cast.door', 'castDoor'],   // its own route asks too; this closes /api/prefs
  ['tracing', 'tracing'],
  ['logs', 'logs'],
  ['usagePrices', 'prices', () => moneyBudgets()],
  ['peopleModels', 'peopleModels'],   // which models people run on (people-models/)
];

/** Whether a change of teams.outside.use (one harness's value, or the whole map) moves any harness to "free". */
function newlyFree(to, from) {
  if (typeof to === 'string' || to == null) return to === 'free' && from !== 'free';
  const was = from && typeof from === 'object' ? from : {};
  return typeof to === 'object' && Object.entries(to).some(([k, v]) => v === 'free' && was[k] !== 'free');
}

/** Whether any money budget exists: only then do the prices decide whether a turn starts (spending/budgets.js). */
function moneyBudgets() {
  const d = require('../spending/store').load();
  return [...Object.values(d.people).flatMap(p => [p.own, p.budget]), ...Object.values(d.levels).map(l => l.budget)]
    .some(b => b && (b.moneyPerDay || b.moneyPerMonth));
}

const get = (o, dotted) => dotted.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
// Absent and empty are the same setting: a panel posting back `{}` for a section never written changes nothing.
const norm = v => (v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length ? null : v ?? null);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/** A switch by its key, as the gate and the panel read it: {key, what, password: bool, notice}. */
function sw(key) {
  const s = SWITCHES[key];
  return s && { key, what: s.what, password: !!s.password, ...(s.notice ? { notice: s.notice } : {}) };
}

/** The stronger of two switches: one that asks for the password wins over a notice. */
const stronger = (a, b) => (!a ? b : !b ? a : (b.password && !a.password ? b : a));

/**
 * The switch a {path: value} list of changes touches — the password one when several do — or null. A change above a
 * row's path (all of `developer` at once) counts for that row only when the part under it changed.
 */
function prefsTouched(changes) {
  let hit = null;
  for (const { path, to, from } of changes) {
    for (const [p, key, when, valueIs] of PREFS) {
      if (!(path === p || path.startsWith(`${p}.`) || p.startsWith(`${path}.`))) continue;
      const under = v => (p.length > path.length ? get({ v }, `v${p.slice(path.length)}`) : v);
      if (same(under(to), under(from)) || (when && !when()) || (valueIs && !valueIs(under(to), under(from)))) continue;
      hit = stronger(hit, sw(key));
    }
  }
  return hit;
}

/** POST /api/prefs: a guarded path whose value the write would change — read from the same merge the write makes. */
function prefsBody(body, replace = false) {
  if (!body || typeof body !== 'object') return null;
  const stored = require('../utils').loadPrefs();
  const after = require('../prefs-merge').merged(stored, body, { replace });
  const changes = PREFS.filter(([p]) => p.split('.')[0] in body).map(([p]) => ({ path: p, from: get(stored, p), to: get(after, p) }));
  return prefsTouched(changes);
}

/**
 * Applying a proposal: each change's `to` against the LIVE setting, never the proposal's stored `from` — a stored file
 * can be edited, and a `from` written equal to its `to` would read as "no change" (security review 2026-10-07).
 */
function proposal(id) {
  const p = require('../harness/settings').find(id);
  if (!p || p.screen) return null;   // a screen's own layer is not a switch
  if (p.kind === 'people-models') return sw('peopleModels');   // an agent's people_models proposal: its Accept asks the password
  const live = require('../utils').loadPrefs();
  return prefsTouched(p.changes.map(c => ({ path: c.path, from: get(live, c.path), to: c.to })));
}

// A guard edit that only switches one on tightens; anything else on a guard (off, thresholds, removing) loosens.
const guardLoosens = req => req.method === 'DELETE' || !(req.body && Object.keys(req.body).length === 1 && req.body.enabled === true);

const ROUTES = [
  [['POST'], /^\/api\/restart$/, 'restart', req => !req.body?.cancel],   // calling a waiting restart off stops nothing
  // A version is every guard at once: one from before 2.281.0 has no password question at all (review 2026-10-07).
  [['POST'], /^\/api\/versions\/use$/, 'version'],
  [['POST'], /^\/api\/update\/file$/, 'version'],   // the same, carried on a file (update-channel/from-file.js)
  [['POST'], /^\/api\/update$/, 'version'],   // pulling the code the next start runs
  [['POST'], /^\/api\/update\/channel\/apply$/, 'version'],
  [['POST'], /^\/api\/harness\/approval$/, null, req => (req.body?.mode === 'unattended' ? 'unattended' : 'approval')],
  [['DELETE'], /^\/api\/harness\/approval\/always\/.+$/, 'always'],
  [['POST'], /^\/api\/harness\/sessions\/[^/]+\/settings$/, 'convApproval', req => req.body?.approval !== undefined],
  [['POST'], /^\/api\/harness\/agents\/enable$/, 'specialists'],
  [['POST'], /^\/api\/experiments\/.+$/, 'experiment'],
  [['POST'], /^\/api\/developer\/releasing$/, 'releasing'],
  [['POST'], /^\/api\/sharing$/, 'sharing'],
  [['POST'], /^\/api\/network$/, 'network'],
  [['POST'], /^\/api\/cast\/door$/, 'castDoor'],
  [['POST'], /^\/api\/logs\/keep$/, 'logs'],
  [W, /^\/api\/auth\/(levels|grants)(\/.*)?$/, 'levels'],
  [['POST'], /^\/api\/auth\/users\/[^/]+\/password$/, 'otherPassword'],
  [W, /^\/api\/auth\/users(\/[^/]+)?$/, 'people'],
  [['POST'], /^\/api\/harness\/guards\/(runtime\/install|[^/]+\/download)$/, 'guards'],
  [W, /^\/api\/harness\/guards(?!\/test$)(\/[^/]+)?$/, null, req => (req.path.replace(/\/+$/, '') === '/api/harness/guards' ? 'guards' : guardLoosens(req) ? 'guardsOff' : 'guards')],
  [['POST'], /^\/api\/settings\/checkpoints\/[^/]+\/restore$/, 'restoreSettings'],
  [['POST'], /^\/api\/backups\/[^/]+\/restore$/, 'restoreBackup'],
  [['POST'], /^\/api\/backups\/(remote|mirror)$/, 'backupOut'],
  // This machine's files (machine-backup/): a restore writes over files on disk; setting up, joining and a new password
  // hand the backup's password to the page or replace it.
  [['POST'], /^\/api\/machine-backup\/(restore|setup|connect|password)$/, 'machineBackup'],
  // Bringing a pack in can create or replace a level (an edition), specialists and their tools, and the memory rules.
  // An upload cannot be read before the gate, so every import asks: the smallest rule that holds for both routes.
  [['POST'], /^\/api\/packs\/(import|library\/[^/]+\/import)$/, 'packIn'],
  // Spending (S12): budgets, permissions and their acceptance; declining a proposal never asks — saying no is free.
  [W, /^\/api\/spending\/(?!permissions\/[^/]+\/decline$).+$/, 'spending'],
  // Models for people (people-models/assign.js): an owner's or an admin's assignment, typed like the policy itself.
  [['POST'], /^\/api\/people-models\/assign$/, 'peopleModels'],
  // Secrets for devices (TODO P1.3): keeping or forgetting one — a person's own or the hub's — is the person's, typed.
  [W, /^\/api\/connectors\/sealed\/(all|mine(\/[^/]+)?|[^/]+)$/, 'sealed'],
  // Trusting a server's own certificate by name (cert-pins.js): what it would let speak as that server.
  [['POST'], /^\/api\/connectors\/certs$/, 'cert'],
  [['POST'], /^\/api\/harness\/usage\/prices$/, 'prices', () => moneyBudgets()],
  [['POST', 'DELETE'], /^\/api\/licence(\/(key|file|computers))?$/, 'licence'],
  // A test computer (computers/test-mode.js): its browser takes a typed password and a sign-in click without asking.
  // Marking one — at making it or after — is said first; unmarking tightens, so it does not ask.
  [['POST'], /^\/api\/computers$/, 'testComputer', req => req.body?.test === true],
  [['POST'], /^\/api\/computers\/[^/]+\/test$/, 'testComputer', req => req.body?.on !== false],
  // The model relay for a paired device (relay/device.js; the owner's rule of 2026-10-14): one that can send text of its
  // own asks; an extension of a phone or an output-only device does not. Switching off tightens, so it never asks.
  [['POST'], /^\/api\/computers\/relay\/devices\/[^/]+$/, 'relayDevice', req => req.body?.on !== false && require('../relay/device').asksPassword(req.path.split('/')[5])],
  // The hive chat's compliance export: the one way anyone reads conversations they are not in (people/keep.js).
  [['POST'], /^\/api\/people\/export$/, 'exportChats'],
  // Opening the house from the Home page: a lock's unlock, an alarm's disarm (home/actions.js).
  [['POST'], /^\/api\/home\/call$/, 'door', req => require('../home/actions').guardedCall(req.body)],
  [['POST'], /^\/api\/prefs$/, null, req => prefsBody(req.body, req.query?.replace === '1')],
  [['POST'], /^\/api\/harness\/proposals\/[^/]+\/apply$/, null, req => proposal(req.path.split('/')[4])],
];

/** What switch this request flips — {key, what, password, notice} — or null when it flips none. */
function switchOf(req, p = req.path.toLowerCase().replace(/\/+$/, '')) {
  for (const [methods, re, key, when] of ROUTES) {
    if (!methods.includes(req.method) || !re.test(p)) continue;
    if (!when) return sw(key);
    let hit; try { hit = when(req); } catch { hit = null; }
    if (!hit) continue;
    if (key) return sw(key);
    return typeof hit === 'string' ? sw(hit) : hit;
  }
  return null;
}

module.exports = { SWITCHES, PREFS, ROUTES, switchOf, prefsTouched, sw };
