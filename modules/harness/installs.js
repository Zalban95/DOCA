'use strict';

/**
 * Things the agent may ask to have installed, and the click that installs them.
 *
 * The shape is `settings.js`'s, for the same reason: the agent can never do the
 * thing, only ask. `install_propose` writes a row; only `POST
 * /api/harness/installs/:id/apply` — a click — runs anything, and it re-checks
 * the proposal on apply because the stored file could have been edited between
 * the two.
 *
 * What makes this safe is narrower than "the user approved it", though. **The
 * agent never supplies a command.** It picks a `kind` and an `id` out of a
 * catalog this file owns, and `apply()` invokes the panel's own existing
 * installer for that kind through a synthetic request — the same handler the
 * Models, Services and Harness tabs call when you click their buttons. So an
 * install proposal cannot run anything a button in this panel could not already
 * run, and there is no path from a sentence the model wrote to a shell.
 *
 * That matters more than it sounds. The agent can already install things with
 * `shell` — but a bare `docker run` gets the image, the ports, the GPU flags
 * and the HF cache mount subtly wrong, and the user ends up with a service that
 * looks installed and does not work. The services catalog knows all of that.
 * Going through it is not a restriction, it is the only version that works.
 *
 * Why it exists at all: an agent that finds nothing able to read an image
 * currently says "I have no vision model" and stops. One that can say "there is
 * no vision model — ollama is running here, shall I pull one?" turns a dead end
 * into a question, which is the whole difference between a tool and an
 * assistant.
 */
const store = require('../store');

const DOC = 'harness/installs';
const MAX_PENDING = 20;

/* ── The catalog ──────────────────────────────────────── */

/**
 * The kinds, each pointing at the installer the panel already has.
 *
 * `handler` is resolved lazily. These modules pull in docker, prefs and the
 * model managers, and this file is required from the tool layer on every step —
 * loading all of that to describe a tool would be absurd.
 */
const KINDS = {
  'ollama-model': {
    label: 'Ollama model',
    verb: 'Pull',
    /**
     * Free text, and deliberately so: nobody can enumerate every model on
     * Ollama's library, and the id goes to Ollama's own /api/pull as JSON —
     * it is never a shell word. The installer is what is fixed here, not the
     * argument.
     */
    validate: id => (/^[\w.:/-]{1,120}$/.test(id) ? null
      : 'A model name looks like "qwen2.5vl:7b" — letters, digits, and : . / _ -'),
    describe: id => `Pull "${id}" into Ollama on this machine. Ollama must be running.`,
    handler: () => require('../models-ollama').handlePull,
    request: id => ({ body: { name: id } }),
  },

  service: {
    label: 'Inference service',
    verb: 'Start',
    validate: id => (require('../services').INFERENCE_SERVICES || []).some(s => s.id === id)
      ? null
      : `No service called "${id}". The panel knows: `
        + (require('../services').INFERENCE_SERVICES || []).map(s => s.id).join(', '),
    describe: id => {
      const s = (require('../services').INFERENCE_SERVICES || []).find(x => x.id === id);
      return s ? `Start ${s.label} in Docker on port ${s.port}, with the image and GPU flags this panel uses.`
        : `Start ${id}.`;
    },
    handler: () => require('../services').handleStart,
    request: (id, params) => ({ body: { id, gpu: params?.gpu || 'all', modelId: params?.modelId || '' } }),
  },

  harness: {
    label: 'Agent harness',
    verb: 'Install',
    validate: id => require('./catalog').get(id)
      ? (require('./catalog').get(id).installCmd ? null : `${id} has no installer — it is installed by hand.`)
      : `No harness called "${id}".`,
    describe: id => {
      const h = require('./catalog').get(id);
      return h ? `Install ${h.label} with its vendor's own installer: ${h.installCmd}` : `Install ${id}.`;
    },
    // catalog.install takes (res, id, password) rather than (req, res), so it
    // is adapted here instead of bending the catalog to this file's shape.
    handler: () => (req, res) => require('./catalog').install(res, req.body.id, req.body.password),
    request: id => ({ body: { id } }),
    /** A vendor installer may need sudo, and the agent must never hold that. */
    needsPassword: id => !!require('./catalog').get(id)?.installCmd?.includes('sudo '),
  },
};

/** What the agent is told it may ask for. */
function kinds() {
  return Object.entries(KINDS).map(([kind, k]) => ({ kind, label: k.label, verb: k.verb }));
}

/* ── Store ────────────────────────────────────────────── */

function load() {
  const doc = store.readJson(DOC, { installs: [] });
  return Array.isArray(doc.installs) ? doc : { installs: [] };
}

function save(installs) {
  // Keep every pending row and the last twenty decided ones: the history is
  // what stops the agent proposing the same thing after you said no.
  const pending = installs.filter(i => i.status === 'pending');
  const decided = installs.filter(i => i.status !== 'pending').slice(-20);
  store.writeJson(DOC, { installs: [...decided, ...pending] });
}

function list() {
  const { installs } = load();
  return {
    pending: installs.filter(i => i.status === 'pending'),
    decided: installs.filter(i => i.status !== 'pending').slice(-20).reverse(),
  };
}

/* ── Proposing ────────────────────────────────────────── */

function propose({ kind, id, reason, params, sessionId } = {}) {
  const k = KINDS[String(kind || '').trim()];
  if (!k) throw Object.assign(new Error(
    `Unknown install kind "${kind}". This panel can install: ${Object.keys(KINDS).join(', ')}`), { status: 400 });

  const target = String(id || '').trim();
  if (!target) throw Object.assign(new Error('id is required'), { status: 400 });

  const why = k.validate(target);
  if (why) throw Object.assign(new Error(why), { status: 400 });

  const doc = load();
  if (doc.installs.filter(i => i.status === 'pending').length >= MAX_PENDING)
    throw Object.assign(new Error('Too many install proposals are already waiting for an answer.'), { status: 429 });

  // Asking twice for the same thing while the first ask is unanswered is noise,
  // not emphasis.
  // `target`, not `id` — `id` is the proposal's own. Comparing the wrong one
  // means the dedupe never fires and the tray fills with the same card.
  const dup = doc.installs.find(i => i.status === 'pending' && i.kind === kind && i.target === target);
  if (dup) return dup;

  const row = {
    id: `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    kind, target,
    label: k.label,
    verb: k.verb,
    what: k.describe(target),
    needsPassword: !!(k.needsPassword && k.needsPassword(target)),
    reason: String(reason || '').trim().slice(0, 600),
    params: params && typeof params === 'object' ? params : {},
    sessionId: sessionId || null,
    status: 'pending',
  };
  doc.installs.push(row);
  save(doc.installs);
  return row;
}

function get(id) {
  return load().installs.find(i => i.id === id) || null;
}

/* ── Deciding ─────────────────────────────────────────── */

/**
 * Run it. Returns when the installer has finished, because the panel streams
 * the same output the Models and Services tabs show and the user is watching.
 */
async function apply(id, { password } = {}) {
  const doc = load();
  const row = doc.installs.find(i => i.id === id);
  if (!row) throw Object.assign(new Error('Unknown install proposal'), { status: 404 });
  if (row.status !== 'pending') throw Object.assign(new Error(`Already ${row.status}`), { status: 409 });

  const k = KINDS[row.kind];
  if (!k) throw Object.assign(new Error(`Unknown install kind "${row.kind}"`), { status: 400 });

  // Re-checked on apply, not only on propose: this request comes from a browser
  // and the stored file could have been edited in between. Same reason
  // settings.apply() re-runs refuse() on every key.
  const why = k.validate(row.target);
  if (why) throw Object.assign(new Error(why), { status: 400 });

  // Required late so the tool layer does not load the api-v1 stack on every
  // step just to describe a tool.
  const { invokeHandler } = require('../api-v1/jobs');
  const shape = k.request(row.target, row.params);
  if (password) shape.body.password = password;

  const out = await invokeHandler(k.handler(), shape);
  const ok = out.body ? (out.status < 400 && !out.body.error) : true;

  row.status = ok ? 'installed' : 'failed';
  row.decidedAt = new Date().toISOString();
  row.output = (out.stream || []).slice(-20);
  if (!ok) row.error = out.body?.error || 'the installer reported a failure';
  save(doc.installs);
  return row;
}

function reject(id, reason) {
  const doc = load();
  const row = doc.installs.find(i => i.id === id);
  if (!row) throw Object.assign(new Error('Unknown install proposal'), { status: 404 });
  row.status = 'declined';
  row.decidedAt = new Date().toISOString();
  row.declineReason = String(reason || '').trim().slice(0, 300);
  save(doc.installs);
  return row;
}

/* ── The prompt block ─────────────────────────────────── */

/**
 * What the agent reads about its own asks.
 *
 * Declined rows are in here on purpose, with the reason: an agent that cannot
 * see it was told no asks again, and being asked the same question twice is how
 * a person learns to stop reading the questions.
 */
function block() {
  const { pending, decided } = list();
  const declined = decided.filter(i => i.status === 'declined');
  if (!pending.length && !declined.length) return '';

  const out = ['# Installs you have asked for'];
  for (const i of pending)
    out.push(`- waiting for the user: ${i.verb} ${i.kind} "${i.target}" — ${i.what}`);
  for (const i of declined)
    out.push(`- DECLINED: ${i.kind} "${i.target}"${i.declineReason ? ` — "${i.declineReason}"` : ''}. `
      + 'Do not ask for this again unless the user raises it.');
  if (pending.length)
    out.push('A proposal installs nothing until the user clicks it. Carry on without it, and say what you '
      + 'cannot do until it is there rather than waiting.');
  return out.join('\n');
}

module.exports = { KINDS, kinds, list, get, propose, apply, reject, block };
