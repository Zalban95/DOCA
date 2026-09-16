'use strict';

/**
 * The specialists the orchestrator can dispatch, and whether it may.
 *
 * The main harness becomes an orchestrator: it hands a task to a named agent
 * and carries on talking to the user while that agent works. The thing that
 * makes specialists worth having is not that they are separate — it is that
 * they are **smaller**. A sub-agent that inherits the orchestrator's prompt
 * costs the orchestrator's prompt on every one of its steps, and three missions
 * cost three times that. So a definition is mostly a list of what to leave out:
 * its own short role, its own tool allowlist, memory off unless it needs it,
 * and a trimmed environment.
 *
 * Which is also why the local-model idea needs no special case anywhere. The
 * memory agent is an ordinary definition whose `provider` points at a llama.cpp
 * instance on this machine and whose tools are memory search. Nothing in the
 * code knows it is a "sidecar".
 *
 * Three limits are structural rather than configurable, and they are here
 * rather than in a comment on the runner because they are the difference
 * between this being useful and being a way to spend money in a loop:
 *
 *   - The safety charter is prepended to every sub-agent prompt, same as the
 *     orchestrator's. A definition cannot remove it.
 *   - Sub-agents **report**; they do not propose. `settings_propose` and
 *     `install_propose` are refused in a mission, so proposals keep one owner
 *     the user can hold responsible.
 *   - **No recursion.** A sub-agent cannot dispatch another. Depth one is where
 *     the cost of a mission stays a number somebody can predict.
 *
 * Definitions are files under ATTACHMENTS-style managed path `AGENTS_DIR`, one
 * per agent, so they are editable, shippable as defaults, diffable, and — the
 * point — writable by the agent itself when the user asks it to build a new
 * specialist. Built-in definitions live in code so a fresh install has them
 * without needing the directory to exist.
 */
const fs   = require('fs');
const path = require('path');

const paths = require('../paths');
const { loadPrefs, savePrefs } = require('../utils');

/**
 * Tools no sub-agent may have, whatever its definition says.
 *
 * `ask_device` is here for the same reason as the proposal tools: a mission runs
 * with nobody watching it, and a specialist that stops to ask the user a
 * question has gone around the orchestrator that dispatched it — which then
 * reads a report that says "I asked" about a decision it never saw. Questions
 * have one owner. `tell_device` is not blocked, but nothing grants it either:
 * a profile's tool list is an allowlist, so a specialist has it only if
 * somebody wrote it down.
 */
const NEVER = ['settings_propose', 'install_propose', 'agent_dispatch', 'agent_results', 'ask_device'];

/**
 * Shipped definitions. Editable by writing a file of the same id, which wins —
 * the code version is the fallback, not the law.
 */
const BUILTIN = [
  {
    id: 'archivist',
    label: 'Archivist',
    note: 'Long-term memory. Answers the orchestrator\'s questions about what it already knows.',
    role: 'You are the Archivist: this panel\'s memory, asked a question by the agent the user is '
      + 'talking to.\n\n'
      + 'Search what is remembered and answer from it. Be short — a few lines, the entries you found, '
      + 'and nothing else. If the memory does not contain the answer, say exactly that; a guess dressed '
      + 'as a recollection is worse than nothing, because the agent that asked will act on it.\n\n'
      + 'You do not act on the machine, you do not change settings, and you do not talk to the user. '
      + 'You answer the question you were given.',
    tools: ['memory_search'],
    memory: false,          // it *searches* memory; it does not need it pasted in
    environment: 'minimal',
    maxSteps: 4,
  },
];

/* ── The switch ───────────────────────────────────────── */

/**
 * Off by default, and off is a settings change rather than a version.
 *
 * The whole point of the flag: rolling this back must not mean rolling back the
 * release. Same build, second model off, everything else as it was.
 */
function enabled() {
  try { return loadPrefs().agents?.enabled === true; } catch { return false; }
}

function setEnabled(on) {
  const prefs = loadPrefs();
  prefs.agents = { ...(prefs.agents || {}), enabled: !!on };
  savePrefs(prefs);
  return enabled();
}

/* ── Definitions ──────────────────────────────────────── */

function dir() {
  const row = paths.describe().find(p => p.key === 'AGENTS_DIR');
  return (row && row.value) || paths.AGENTS_DIR;
}

function fileFor(id) { return path.join(dir(), `${id}.json`); }

/** An id that is safe in a filename, a URL and a tool argument. */
function validId(id) {
  return /^[a-z][a-z0-9_-]{1,39}$/.test(String(id || ''))
    ? null
    : 'An agent id is lower-case letters, digits, _ and -, starting with a letter (2–40 chars).';
}

/**
 * Normalise and enforce the structural limits.
 *
 * `NEVER` is subtracted here rather than checked at dispatch time, so a
 * definition that asks for a forbidden tool is corrected once, visibly, instead
 * of failing later in a mission where nobody is reading.
 */
function normalize(def) {
  const id = String(def?.id || '').trim();
  const why = validId(id);
  if (why) throw Object.assign(new Error(why), { status: 400 });
  if (!String(def?.role || '').trim())
    throw Object.assign(new Error('An agent needs a role — the system prompt it works under.'), { status: 400 });

  const asked = Array.isArray(def.tools) ? def.tools.map(String) : [];
  return {
    id,
    label: String(def.label || id).slice(0, 60),
    note:  String(def.note || '').slice(0, 300),
    role:  String(def.role).slice(0, 20000),
    tools: asked.filter(t => !NEVER.includes(t)),
    refusedTools: asked.filter(t => NEVER.includes(t)),
    memory: def.memory === true,
    environment: def.environment === 'full' ? 'full' : 'minimal',
    // Absent means "use the orchestrator's". A definition only overrides what
    // it has a reason to.
    provider: def.provider ? String(def.provider) : null,
    model:    def.model    ? String(def.model)    : null,
    // No ceiling, deliberately: a specialist's step count is the definition's
    // business, and capping it here would be limiting the agent to fix a cost
    // problem that lives in the prompt. The fallback is only for a definition
    // that never mentions it.
    maxSteps:      Number(def.maxSteps)      > 0 ? Number(def.maxSteps)      : 12,
    maxTokens:     Number(def.maxTokens)     > 0 ? Number(def.maxTokens)     : null,
    contextWindow: Number(def.contextWindow) > 0 ? Number(def.contextWindow) : null,
    builtin: !!def.builtin,
  };
}

/** Definitions on disk, which win over the shipped ones of the same id. */
function fromFiles() {
  let names;
  try { names = fs.readdirSync(dir()); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const def = JSON.parse(fs.readFileSync(path.join(dir(), name), 'utf8'));
      out.push(normalize({ ...def, id: def.id || name.replace(/\.json$/, '') }));
    } catch (e) {
      // A broken file is listed as broken rather than skipped: a definition
      // that silently vanished is a bug report nobody can write.
      out.push({ id: name.replace(/\.json$/, ''), label: name, broken: e.message });
    }
  }
  return out;
}

function list() {
  const files = fromFiles();
  const ids = new Set(files.map(f => f.id));
  const builtin = BUILTIN.filter(b => !ids.has(b.id)).map(b => normalize({ ...b, builtin: true }));
  return [...builtin, ...files].sort((a, b) => a.id.localeCompare(b.id));
}

function get(id) { return list().find(a => a.id === id) || null; }

/** Write a definition. This is how the agent builds a new specialist. */
function save(def) {
  const row = normalize(def);
  fs.mkdirSync(dir(), { recursive: true });
  const { builtin, refusedTools, ...stored } = row;
  fs.writeFileSync(fileFor(row.id), `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  return row;
}

function remove(id) {
  const row = get(id);
  if (!row) throw Object.assign(new Error(`No agent called "${id}"`), { status: 404 });
  try { fs.rmSync(fileFor(id), { force: true }); } catch { /* already gone */ }
  // A built-in whose file is deleted reverts to the shipped definition rather
  // than disappearing, which is the behaviour people expect from a reset.
  return get(id);
}

/* ── The prompt block ─────────────────────────────────── */

/** What the orchestrator is told it can call. Empty when the flag is off. */
function block() {
  if (!enabled()) return '';
  const rows = list().filter(a => !a.broken);
  if (!rows.length) return '';
  const out = ['# Specialists you can dispatch'];
  for (const a of rows) out.push(`- ${a.id} (${a.label}): ${a.note || 'no description'}`);
  out.push(
    'Dispatch one with `agent_dispatch` when the work is a self-contained errand — it runs as a mission '
    + 'in the background and you carry on talking. You are not blocked: the answer arrives later and you '
    + 'read it with `agent_results`. Tell the user what you sent and to whom.',
    'A specialist sees only the task and the context you give it. It has its own small tool list, it '
    + 'cannot change settings or install anything, and it cannot dispatch anyone else — if it needs '
    + 'something only the user can grant, it says so and you are the one who asks.');
  return out.join('\n');
}

module.exports = { BUILTIN, NEVER, enabled, setEnabled, dir, list, get, save, remove, normalize, validId, block };
