'use strict';

/**
 * The guided set-up: a few plain questions, and what their answers set up — through what already exists only
 * (CONSTITUTION §1, TODO P1.5). A local model or service becomes an install proposal (harness/installs.js: a kind
 * and an id from the panel's own catalogues, installed on the person's click); a role the machine cannot bear
 * becomes a key to paste, for a provider the person picks. Nothing here runs a command or writes a key.
 *
 * The answers are this install's own data (`guided/answers` in the store), so the set-up can be opened again from
 * Settings → Set-up, or by the agent ("set me up for …"), and start from what was said. Which shape the hub is —
 * `local` or `preset` — and whether the owner chose the guided or the advanced set-up are settings (`setup.*`).
 */
const store = require('../store');

const DOC = 'guided/answers';

/** What DOCA is for, in broad strokes, and the roles each needs. */
const USES = {
  talk:  { label: 'Talk to it and get everyday help', roles: ['chat'] },
  code:  { label: 'Write and fix code', roles: ['chat', 'coding'] },
  voice: { label: 'Talk to it out loud, and hear it answer', roles: ['chat', 'stt', 'tts'] },
  see:   { label: 'Look at pictures and screens', roles: ['chat', 'vision'] },
  find:  { label: 'Find things by meaning in what it keeps', roles: ['chat', 'embeddings'] },
  home:  { label: 'Look after my home and devices', roles: ['chat'] },
};

/** The devices a person may use it from, and how each joins. */
const DEVICES = {
  browser: { label: 'This browser, on any computer', how: 'Nothing to do: sign in at this address.' },
  phone:   { label: 'An Android phone', how: 'Field → API keys → DOCA apps: install DocaMobile, then pair it with the QR code (📱 in the header).' },
  watch:   { label: 'A Wear OS watch', how: 'Pair the phone first; the watch is paired from the phone app.' },
  desktop: { label: 'Another computer (files, screen, apps)', how: 'Field → API keys: pair the desktop client (doca-client, or DocaDesk on Windows).' },
};

const ROUTES = ['local', 'providers'];

function clean(answers = {}) {
  const uses = (Array.isArray(answers.uses) ? answers.uses : []).filter(u => USES[u]);
  const devices = (Array.isArray(answers.devices) ? answers.devices : []).filter(d => DEVICES[d]);
  return {
    uses: uses.length ? [...new Set(uses)] : ['talk'],
    free: String(answers.free || '').trim().slice(0, 1000),
    route: ROUTES.includes(answers.route) ? answers.route : 'local',
    devices: [...new Set(devices)],
  };
}

function get() { return store.readJson(DOC, null); }

/** The roles the answers need, in the order they are set up (the agent's own model first). */
function rolesFor(a) {
  const want = new Set(a.uses.flatMap(u => USES[u].roles));
  return ['chat', 'coding', 'vision', 'embeddings', 'stt', 'tts'].filter(r => want.has(r));
}

/**
 * What the answers set up on this machine. `askRoute` is true only when it is a real choice: something fits here.
 * Steps, in order: the runtimes a local pick needs (a System tools row), the picks themselves, then the keys.
 * `have.chat` is the agent's model when one is configured and answers — any provider, a hosted one or a server the
 * person runs (self-test 2026-10-08: Set-up said "no model" with one connected): then the agent's role is done.
 */
function plan(answers, assessment, doc, { have = {} } = {}) {
  const { pickAll, shapeOf } = require('./pick');
  const a = clean(answers);
  const shape = shapeOf(assessment, doc);
  const picks = pickAll(assessment, doc, rolesFor(a)).filter(p => !(p.role === 'chat' && have.chat));
  const askRoute = picks.some(p => p.local);
  const useLocal = askRoute && a.route === 'local';
  const steps = have.chat ? [{ type: 'have', role: 'chat', label: 'The agent\'s model', provider: have.chat.provider, model: have.chat.model }] : [];
  const local = useLocal ? picks.filter(p => p.local) : [];
  // Speech has no hosted route yet, so it stays local even when the person prefers providers for the rest.
  if (!useLocal) for (const p of picks) if (p.local && !p.providers.length) local.push(p);
  const needs = new Set(local.map(p => p.local.runtime));
  if (needs.has('ollama') && !assessment.runtimes.ollama) steps.push({ type: 'install', kind: 'tool', id: 'ollama', label: 'Ollama', why: 'runs the models on this machine' });
  if (needs.has('docker') && !assessment.runtimes.docker) steps.push({ type: 'install', kind: 'tool', id: 'docker', label: 'Docker', why: 'runs the speech services' });
  for (const p of local) {
    steps.push({ type: 'install', kind: p.local.install.kind, id: p.local.install.id, role: p.role, label: p.local.label,
      why: `${p.label} — fits here (${p.local.where === 'gpu' ? 'on the graphics card' : 'on the processor'})` });
  }
  for (const p of picks.filter(x => !local.includes(x))) {
    steps.push({ type: 'key', role: p.role, label: p.label, providers: p.providers, note: p.providersNote,
      why: p.local ? 'you chose providers' : p.tooBig ? `too heavy for this machine: ${p.tooBig.label} ${p.tooBig.why}` : 'nothing suggested runs here' });
  }
  return { answers: a, shape, askRoute, picks, steps, have, devices: a.devices.map(d => ({ id: d, ...DEVICES[d] })) };
}

/**
 * Keep the answers and put each install in front of the person as a proposal (one click each, from this page or
 * the Harness tray). Re-running proposes nothing twice: installs.propose returns a pending one it already has.
 */
function apply(answers, assessment, doc, { by = null, have = {} } = {}) {
  const out = plan(answers, assessment, doc, { have });
  const installs = require('../harness/installs');
  const at = new Date().toISOString(), prev = get();
  let fresh = 0;
  for (const s of out.steps.filter(x => x.type === 'install')) {
    try { s.proposal = installs.propose({ kind: s.kind, id: s.id, reason: `Guided set-up: ${s.why}` }); if (s.proposal.createdAt >= at) fresh++; }
    catch (e) { s.error = e.message; }
  }
  // The same answers again, and nothing new to propose: nothing changed, and the page says so (self-test 2026-10-08).
  const same = !!prev && JSON.stringify(clean(prev)) === JSON.stringify(out.answers);
  out.changed = !same || fresh > 0;
  store.writeJson(DOC, { ...out.answers, at, by });
  setSetup({ mode: 'guided', shape: out.shape });
  return out;
}

/** setup.mode (guided | advanced) and setup.shape (local | preset): the owner's, never proposable. */
function setSetup(patch) {
  const { loadPrefs, savePrefs } = require('../utils');
  const prefs = loadPrefs();
  const cur = prefs.setup || {};
  const next = { ...cur };
  if (['guided', 'advanced'].includes(patch.mode)) next.mode = patch.mode;
  if (['local', 'preset'].includes(patch.shape)) next.shape = patch.shape;
  if (JSON.stringify(next) !== JSON.stringify(cur)) savePrefs({ ...prefs, setup: next });
  return next;
}

function setup() {
  const s = require('../utils').loadPrefs().setup || {};
  return { mode: s.mode || '', shape: s.shape || '' };
}

module.exports = { USES, DEVICES, ROUTES, clean, get, rolesFor, plan, apply, setSetup, setup };
