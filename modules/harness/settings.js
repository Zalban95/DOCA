'use strict';

/**
 * The agent's hands on the panel's own settings — through the user, never past
 * them.
 *
 * The agent cannot write a setting. It writes a *proposal*: the dotted keys it
 * wants changed, the values now, the values it suggests, and why. The console
 * draws that as a card with Accept and Decline, and only Accept writes
 * anything. So the interesting code here is not the write, it is what may be
 * proposed at all and how a rejection is remembered.
 *
 * Two lists decide that. `SETTABLE` is where in the prefs file a proposal may
 * point, by prefix, so a key added to one of those sections next month is
 * proposable without touching this file. `FORBIDDEN` then wins over it, because
 * a prefix is a blunt instrument and nothing whose name says "key" or "token"
 * should ever travel through a model's tool call.
 *
 * Everything else on the machine stays out of reach by simply not being here:
 * the API keys in openclaw.json, the MCP server definitions (a command that
 * gets spawned), the custom harnesses (likewise), the systemd unit.
 */
const { loadPrefs, savePrefs } = require('../utils');
const paths = require('../paths');
const store = require('../store');

const PROPOSALS_DOC = 'harness/proposals';
const KEEP_DECIDED  = 20;      // decided proposals kept as the audit trail

/**
 * Sections of the prefs file a proposal may point into, each with the sentence
 * the confirmation card shows so the user is not reading a dotted path cold.
 */
const SETTABLE = [
  { prefix: 'paths',            label: 'Managed paths',        note: 'Applies after a restart of the panel' },
  { prefix: 'harness.config',   label: 'Harness parameters',   note: 'Includes this agent\'s own model and behaviour' },
  { prefix: 'harness.default',  label: 'Default harness',      note: 'Which runtime the chat panel talks to' },
  { prefix: 'agents.enabled',   label: 'Specialist agents',    note: 'Allow the orchestrator to dispatch specialists', exact: true },
  { prefix: 'models',           label: 'Model manager',        note: 'Ollama URL, download directories' },
  { prefix: 'snapshotSettings', label: 'Snapshot settings',    note: '' },
  { prefix: 'serviceSettings',  label: 'Inference services',   note: 'GPU assignment, ports, images' },
  { prefix: 'voiceServices',    label: 'Voice services',       note: '' },
  { prefix: 'vms',              label: 'Virtual machines',     note: 'The libvirt connection URI' },
  // Numbers only, and deliberately a different key from `mcpServers`, which
  // holds commands this host spawns and stays out of reach. `sectionFor` matches
  // a whole prefix, so "mcpSettings" can never open the door to "mcpServers".
  { prefix: 'mcpSettings',      label: 'MCP timeouts',         note: 'How long to wait for an MCP tool before giving up' },
  { prefix: 'sidebarStats',     label: 'Sidebar stats',        note: 'Which stats the sidebar shows' },
  { prefix: 'sidebarSections',  label: 'Sidebar sections',     note: '' },
  { prefix: 'hiddenTabs',       label: 'Navigation visibility', note: '' },
  { prefix: 'hiddenBuiltins',   label: 'Hidden built-ins',     note: '' },
  { prefix: 'theme',            label: 'Theme',                note: '' },
  { prefix: 'customTheme',      label: 'Custom theme colours', note: '' },
  { prefix: 'favorites',        label: 'Config favourites',    note: '' },
  { prefix: 'fmFavorites',      label: 'File manager favourites', note: '' },
];

/**
 * Names that never travel through a tool call, wherever they sit.
 *
 * Whole segments only, so `maxTokens` stays settable while `token` does not —
 * a substring match would quietly make half the harness parameters unreachable.
 */
const FORBIDDEN = /(^|\.)(api)?(key|keys|token|secret|password|passwd|credential|credentials)(\.|$)/i;

/**
 * The approval mode and its allowlist, named outright rather than merely left
 * off `SETTABLE`.
 *
 * No prefix covers `harness.approval` today, so this is belt and braces — but
 * it is the one setting whose whole purpose is to constrain the thing doing
 * the proposing. An agent that can move itself to full auto, or add `shell:rm`
 * to the standing allowlist, is not being supervised; it is filling in its own
 * permission slip. The day somebody adds a bare `harness` prefix to SETTABLE,
 * this is what stops that from quietly becoming a hole.
 */
const NEVER_SETTABLE = /^harness\.approval(\.|$)/i;

/** Keys that are not data, whatever section they appear under. */
const PROTO = /(^|\.)(__proto__|prototype|constructor)(\.|$)/;

const MAX_VALUE_CHARS = 8000;

/* ── Dotted paths ─────────────────────────────────────── */

function get(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

function set(obj, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  let node = obj;
  for (const k of keys) {
    if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
    node = node[k];
  }
  if (value === null) delete node[last];
  else node[last] = value;
  return obj;
}

function sectionFor(dotted) {
  return SETTABLE.find(s => dotted === s.prefix || (!s.exact && dotted.startsWith(`${s.prefix}.`))) || null;
}

/**
 * Is this a change the agent is allowed to suggest?
 * @returns {string|null} the reason it is not, or null when it is fine
 */
function refuse(dotted, value) {
  if (!dotted || typeof dotted !== 'string')          return 'a settings path is required';
  if (dotted.length > 200)                            return `path is absurdly long: ${dotted.slice(0, 60)}…`;
  if (!/^[A-Za-z0-9_.\- ]+$/.test(dotted))            return `path has characters that cannot be a prefs key: ${dotted}`;
  // `paths.__proto__.x` is inside an allowed section and would still walk out of
  // the object it is meant to be setting.
  if (PROTO.test(dotted))                             return `${dotted} is not a settings path`;
  if (FORBIDDEN.test(dotted))                         return `${dotted} holds a secret — those are never set this way`;
  if (NEVER_SETTABLE.test(dotted))
    return `${dotted} is the approval mode that governs you — only the user changes it, in Harness → Approvals`;
  if (!sectionFor(dotted))
    return `${dotted} is not a setting the agent may change (allowed: ${SETTABLE.map(s => s.prefix).join(', ')})`;

  if (dotted === 'agents.enabled' && typeof value !== 'boolean')
    return 'agents.enabled must be a boolean (true or false)';

  if (value === undefined)                            return `${dotted}: no value given`;
  if (typeof value === 'function' || typeof value === 'bigint') return `${dotted}: value is not JSON`;
  let json;
  try { json = JSON.stringify(value); } catch { return `${dotted}: value is not JSON`; }
  if (json === undefined)                             return `${dotted}: value is not JSON`;
  if (json.length > MAX_VALUE_CHARS)                  return `${dotted}: value is too large (${json.length} characters)`;

  // Changing a number into an object is how a settings file stops loading. If
  // the key is already there, the shape it has is the shape it keeps.
  const current = get(loadPrefs(), dotted);
  if (current !== undefined && value !== null) {
    const was = Array.isArray(current) ? 'array' : typeof current;
    const now = Array.isArray(value)   ? 'array' : typeof value;
    const article = w => (/^[aeiou]/.test(w) ? 'an' : 'a');
    if (was !== now) return `${dotted} is ${article(was)} ${was}, not ${article(now)} ${now}`;
  }
  return null;
}

/* ── What the agent may read ──────────────────────────── */

/** Flatten to dotted leaves, so a proposal can name exactly one of them. */
function flatten(value, prefix, out) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = value;
  }
  return out;
}

/**
 * Every setting the agent may look at, with what it is set to now.
 *
 * Effective values, not saved ones. A path with nothing saved still has a value
 * (from the environment, or the default), and so does a harness parameter on a
 * fresh install — an agent shown only the saved half would keep suggesting a
 * value that is already in force, or think a section does not exist because
 * nobody has touched it yet.
 */
function readable() {
  const prefs = loadPrefs();
  const out = [{ path: 'agents.enabled', value: prefs.agents?.enabled === true, section: 'Specialist agents',
    detail: 'Off by default. A proposal only enables specialists after the user accepts it.' }];

  for (const spec of paths.describe())
    out.push({
      path: `paths.${spec.key}`, value: spec.value, section: 'Managed paths',
      detail: `${spec.label} — ${spec.source}${spec.exists ? '' : ', does not exist yet'}`,
    });

  try {
    const catalog = require('./catalog');
    const config = catalog.configFor(catalog.BUILTIN_ID);
    const trigger = require('./budget').compactionFor(config);
    for (const [k, v] of Object.entries(config))
      // The prompt is in the prompt already; repeating it here doubles it.
      if (k !== 'systemPrompt')
        out.push({ path: `harness.config.${catalog.BUILTIN_ID}.${k}`, value: v, section: 'Harness parameters',
          ...(['compactTokens', 'compactAt'].includes(k) ? { detail: trigger
            ? `Effective token trigger: ${trigger.at} (harness.config.${catalog.BUILTIN_ID}.${trigger.setting}); message-count folding also applies.`
            : 'No token trigger is configured; message-count folding still applies.' } : {}),
        });
  } catch { /* catalog unavailable — the rest of the list is still useful */ }

  // Effective values, like the paths and harness rows above: nothing is written
  // to prefs until somebody changes one, and a setting the agent cannot see is a
  // setting it will never propose — which is how the MCP call timeout spent this
  // long being a number nobody could reach.
  try {
    const { McpClient } = require('../mcp/client');
    out.push(
      { path: 'mcpSettings.callTimeoutMs', value: McpClient.timeoutFor('call'), section: 'MCP timeouts',
        detail: 'How long a single MCP tool call may take. It stops the waiting, not the work.' },
      { path: 'mcpSettings.listTimeoutMs', value: McpClient.timeoutFor('list'), section: 'MCP timeouts',
        detail: 'How long to wait for a server to list its tools when it starts.' },
    );
  } catch { /* mcp module unavailable — the rest of the list is still useful */ }

  const seen = new Set(out.map(r => r.path));
  for (const s of SETTABLE) {
    if (s.prefix === 'paths') continue;
    const current = get(prefs, s.prefix);
    if (current === undefined) continue;
    for (const [dotted, value] of Object.entries(flatten(current, s.prefix, {}))) {
      if (FORBIDDEN.test(dotted) || NEVER_SETTABLE.test(dotted) || seen.has(dotted)) continue;
      out.push({ path: dotted, value, section: s.label });
    }
  }
  return out;
}

/* ── Proposals ────────────────────────────────────────── */

function load() {
  const doc = store.readJson(PROPOSALS_DOC, { proposals: [] });
  if (!Array.isArray(doc.proposals)) doc.proposals = [];
  return doc;
}

function save(doc) {
  // Pending ones all stay; decided ones are history and are trimmed, so a
  // chatty week cannot grow this file without bound.
  const pending = doc.proposals.filter(p => p.status === 'pending');
  const decided = doc.proposals.filter(p => p.status !== 'pending').slice(-KEEP_DECIDED);
  store.writeJson(PROPOSALS_DOC, { proposals: [...decided, ...pending] });
}

function list() {
  const all = load().proposals;
  return {
    pending: all.filter(p => p.status === 'pending'),
    decided: all.filter(p => p.status !== 'pending').reverse(),
  };
}

function find(id) {
  return load().proposals.find(p => p.id === id) || null;
}

/**
 * Record a suggestion. Nothing is written to the prefs file here — that only
 * happens in `apply`, and only from a click.
 *
 * @param {{ changes: object[], reason?: string, sessionId?: string }} input
 * @returns {object} the stored proposal
 */
function propose({ changes, reason, sessionId } = {}) {
  const rows = Array.isArray(changes) ? changes : [changes];
  if (!rows.length) throw Object.assign(new Error('changes are required'), { status: 400 });
  if (rows.length > 20) throw Object.assign(new Error('too many changes in one proposal'), { status: 400 });

  const prefs = loadPrefs();
  const effective = Object.fromEntries(readable().map(r => [r.path, r.value]));
  const prepared = [];

  for (const row of rows) {
    const dotted = String(row?.path ?? '').trim();
    const why = refuse(dotted, row?.value);
    if (why) throw Object.assign(new Error(why), { status: 400 });
    const section = sectionFor(dotted);
    prepared.push({
      path: dotted,
      from: dotted in effective ? effective[dotted] : get(prefs, dotted) ?? null,
      to:   row.value,
      section: section.label,
      note:    section.note || '',
    });
  }

  const doc = load();
  const proposal = {
    id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    reason: String(reason || '').trim().slice(0, 600),
    sessionId: sessionId || null,
    changes: prepared,
    status: 'pending',
  };
  doc.proposals.push(proposal);
  save(doc);
  return proposal;
}

/**
 * Accept one. The keys are re-checked against the allowlist even though they
 * passed it when proposed: this is a request coming from a browser, and the
 * only thing standing between it and the prefs file is this function.
 */
function apply(id) {
  const doc = load();
  const p = doc.proposals.find(x => x.id === id);
  if (!p)                       throw Object.assign(new Error('Unknown proposal'), { status: 404 });
  if (p.status !== 'pending')   throw Object.assign(new Error(`Already ${p.status}`), { status: 409 });

  const prefs = loadPrefs();
  for (const c of p.changes) {
    const why = refuse(c.path, c.to);
    if (why) throw Object.assign(new Error(why), { status: 400 });
    set(prefs, c.path, c.to);
  }
  savePrefs(prefs);

  p.status     = 'applied';
  p.decidedAt  = new Date().toISOString();
  save(doc);

  require('./environment').invalidate();
  return { proposal: p, restartNeeded: p.changes.some(c => c.path.startsWith('paths.')) };
}

function reject(id, reason) {
  const doc = load();
  const p = doc.proposals.find(x => x.id === id);
  if (!p)                     throw Object.assign(new Error('Unknown proposal'), { status: 404 });
  if (p.status !== 'pending') throw Object.assign(new Error(`Already ${p.status}`), { status: 409 });
  p.status        = 'rejected';
  p.decidedAt     = new Date().toISOString();
  p.decidedReason = String(reason || '').trim().slice(0, 400);
  save(doc);
  return p;
}

/* ── What the agent is told about its own proposals ───── */

/**
 * The recent verdicts, for the system prompt.
 *
 * An agent that cannot see it was declined proposes the same thing again next
 * turn, which is how a helpful feature becomes nagging. A declined change with
 * the user's reason attached is the single most useful thing to carry forward.
 */
function block() {
  const { pending, decided } = list();
  if (!pending.length && !decided.length) return '';

  const lines = ['# Your settings proposals'];
  for (const p of pending)
    lines.push(`- WAITING on the user: ${p.changes.map(c => `${c.path} → ${JSON.stringify(c.to)}`).join(', ')}`
      + ' — do not repeat it or work around it.');
  for (const p of decided.slice(0, 6))
    lines.push(`- ${p.status.toUpperCase()}: ${p.changes.map(c => `${c.path} → ${JSON.stringify(c.to)}`).join(', ')}`
      + (p.decidedReason ? ` (they said: ${p.decidedReason})` : ''));
  return lines.join('\n');
}

module.exports = {
  SETTABLE, FORBIDDEN,
  readable, refuse,
  propose, apply, reject, list, find, block,
  get, set,
};
