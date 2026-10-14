'use strict';

/**
 * An agents' computer and the model relay (relay/index.js): its token, whose it is, and how it learns where the relay
 * is. The token is the hub's like the computer's control token — kept in its record, never in `view()` — and it reaches
 * the computer only as the four variables below: in its environment when it is made with the relay on (a container's
 * environment is fixed when it is made), else in `relay.env` in its work folder, written when its switch goes on (and
 * again each time it starts, so a changed port reaches it). It is a credential for the relay alone: no provider key,
 * nothing else of the hub's.
 *
 * Whose: the person its conversation belongs to (its `by` is a conversation when an agent made it, a person's id when
 * someone made it in the Computers tab), the person a specialist keeps it for, else the person of the mission it is
 * lent to — the rule computers/whose.js reads. Usage goes to that conversation and person (harness/usage.js), so their
 * budget and level (auth/allot.js) hold for what runs inside it as for a turn.
 */
const crypto = require('crypto');

const FILE = '/home/agent/work/relay.env';

/** The four variables a program inside reads: the OpenAI names every SDK knows, and the relay's own. */
function vars(c, url = require('./index').computerUrl()) {
  return { OPENAI_BASE_URL: url, OPENAI_API_KEY: c.relayToken, DOCA_RELAY_URL: url, DOCA_RELAY_TOKEN: c.relayToken };
}

/** `-e` arguments for `docker run` when a computer is made with the relay on: its token minted here. */
function dockerEnv(c) {
  c.relayToken = c.relayToken || mint();
  return Object.entries(vars(c)).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
}

const mint = () => `relay-${crypto.randomBytes(24).toString('hex')}`;

/** The computer whose token this is, or null — compared in constant time, over every record. */
function byToken(token) {
  const t = Buffer.from(String(token || ''));
  if (t.length < 20) return null;
  return require('../computers').rows().find(c => {
    if (!c.relayToken) return false;
    const k = Buffer.from(c.relayToken);
    return k.length === t.length && crypto.timingSafeEqual(k, t);
  }) || null;
}

const sessionExists = id => { try { return !!require('../harness/memory').getSession(id); } catch { return false; } };

/** { personId, sessionId } of the computer: who its usage is counted for. */
function ownerOf(c) {
  const access = require('../harness/session-access');
  let sessionId = c.by && sessionExists(c.by) ? c.by : null;
  if (!sessionId && c.missionId) sessionId = require('../agents/missions').get(c.missionId)?.sessionId || null;
  let personId = c.keptFor || null;
  if (!personId && sessionId) { try { personId = access.ownerOf(sessionId); } catch { /* removed meanwhile */ } }
  if (!personId && c.by && !sessionExists(c.by) && require('../auth/store').userById(c.by)) personId = c.by;   // made in the Computers tab
  return { personId, sessionId };
}

/**
 * The person as a turn sees them (role, level), or null when the computer has none (made before accounts, or by a
 * conversation nobody owns — not narrowed, as such a turn is not). Throws when its person is suspended or gone.
 */
function personOf(personId) {
  if (!personId) return null;
  const store = require('../auth/store');
  const p = require('../harness/turn/client').personById({ id: personId, orgId: store.defaultOrg()?.id });
  if (!p) throw Object.assign(new Error('The person this computer works for is suspended or no longer here, so the relay does not answer it.'), { status: 403, code: 'person_gone' });
  return p;
}

/** Copy `relay.env` into its work folder (it must be running). */
async function writeFile(c) {
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-relay-'));
  const local = path.join(tmp, 'relay.env');
  try {
    const lines = Object.entries(vars(c)).map(([k, v]) => `export ${k}=${v}`);
    fs.writeFileSync(local, `# The hub's model relay: source this file (. ~/work/relay.env), then any OpenAI-compatible client uses the hub's models.\n${lines.join('\n')}\n`, { mode: 0o600 });
    const run = require('../computers/strays').docker, name = `doca-computer-${c.id}`;
    await run(['exec', name, 'mkdir', '-p', path.posix.dirname(FILE)]);
    await run(['cp', local, `${name}:${FILE}`]);
    await run(['exec', '-u', '0', name, 'sh', '-c', `chown agent:agent ${FILE} && chmod 600 ${FILE}`]).catch(() => {});
    return FILE;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function removeFile(c) {
  await require('../computers/strays').docker(['exec', `doca-computer-${c.id}`, 'rm', '-f', FILE]).catch(() => {});
}

/**
 * A computer's relay switch (the Computers tab, or the computer tool's `relay` action). On: a new token when it was
 * off (or had none), and `relay.env` written into it (when it is running; otherwise when it next starts). Off: refused
 * from now on, the file taken out, and the token replaced by one never handed out — so a token copied out of the
 * computer stops working for good (the owner's, 2026-10-14). The environment it was made with then holds a dead token,
 * so `relayEnv` goes: the file is where a program finds the live one.
 * → { on, file, env, note }
 */
async function set(id, on) {
  const computers = require('../computers');
  const c = computers.need(String(id || ''));
  const rotate = !on || !c.relayOn || !c.relayToken;
  const fields = { relayOn: !!on, ...(rotate ? { relayToken: mint(), relayEnv: false } : {}) };
  computers.patch(c.id, fields);
  const now = { ...c, ...fields };
  let file = null;
  if (on) { await require('./index').sync(); file = await writeFile(now).catch(() => null); }
  else await removeFile(now);
  require('../activity').note({ from: 'relay', what: `the model relay ${on ? 'on' : 'off'} for ${c.name}`, why: on ? 'its programs may use the hub\'s models' : 'switched off',
    machine: { kind: 'computer', id: c.id, name: c.name }, act: on ? 'relay-on' : 'relay-off', ok: true });
  return { name: c.name, id: c.id, file, ...status(now) };
}

/** The tool's answer: what a program inside does now, or why it cannot yet. */
function said(r) {
  if (!r.on) return `The model relay is off for ${r.id} "${r.name}": programs inside it get refused from now on.`;
  const how = r.env ? 'OPENAI_BASE_URL and OPENAI_API_KEY are in its environment' : r.file ? `source ${r.file} first (. ~/work/relay.env)` : `it is not running: ${FILE} is written when it starts`;
  return `The model relay is on for ${r.id} "${r.name}": any OpenAI-compatible client inside uses the hub's models — ${how}. GET $OPENAI_BASE_URL/models lists them.`
    + (r.blocked ? ` It answers nothing yet: ${r.blocked}.` : '');
}

/** What the computer's card and the tool say about it. */
function status(c) {
  const relay = require('./index');
  const off = !relay.enabled() ? 'the model relay is off for this hub (Field → API keys → Model relay)'
    : !relay.forComputers() ? 'the model relay is not open to agents\' computers (Field → API keys → Model relay)' : null;
  return { on: !!c.relayOn, env: !!c.relayEnv, ...(off ? { blocked: off } : {}) };
}

module.exports = { FILE, vars, dockerEnv, mint, byToken, ownerOf, personOf, writeFile, removeFile, set, said, status };
