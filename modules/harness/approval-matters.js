'use strict';

/**
 * Manual approval that asks what matters (the owner, 2026-10-08, from a Live call in Manual mode: "they don't really
 * need an approval to change the time, or even to check position and set it… as for so many other things").
 *
 * `harness.approval.manualAsks` is beside the mode: `everything` is Manual as it always was — every call that does
 * something is asked — and `what-matters` asks only for what cannot be undone or leaves the machine. It is a safety
 * switch: guarded by the password like the mode (auth/guarded.js guards all of harness.approval) and never proposable.
 *
 * The rule is the risk classifier's (risk/classify.js, pure), read whether or not the riskTiers experiment is on: the
 * experiment adds asks in every mode; this only decides which of Manual's questions are worth a person's attention.
 *
 *   asked        an outward call (data sent off the machine, a post, mail, a publish, a payment, a delete outside a
 *                project); a push; a shell line DOCA cannot reduce to verbs, or one that changes this machine outside a
 *                project, or runs a verb whose effects it cannot tell; a tool on another machine that is not a read
 *                (DOCA keeps no way back there); a change with no way back at all (forgetting a memory, a grant)
 *   not asked    reads; changes with a way back — a project edit (its checkpoint is taken first, risk.keep), a file
 *                written with its backup, a setting the person asked for (its settings checkpoint, S1) or a proposal,
 *                the panel's layout or a page on a screen, memory, a reminder, a note to the person's own devices,
 *                work in the hive, an agents' computer; the person's own device's location or sensors read
 *
 * What approval.gate asks before this — what governs the agent, forced-asks.js, the level, outside text — is unchanged.
 */
const R = require('./risk/rules');

const MODES = ['everything', 'what-matters'];

function setting() {
  try { return require('../settings-schema').value('harness.approval.manualAsks'); } catch { return 'everything'; }
}

/** Whether a conversation is in Manual that asks what matters (a chat tab's own Manual counts too). */
function active(sessionId) {
  const approval = require('./approval');
  return require('./modes').approvalMode(sessionId, approval.settings().mode) === 'manual' && setting() === 'what-matters';
}

/** Verbs that change files in place, or build and test a project: within a project a checkpoint is their way back. */
const PROJECT_VERBS = new Set(['mkdir', 'touch', 'cp', 'mv', 'ln', 'chmod', 'sed', 'tee', 'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'git', 'npm', 'npx', 'yarn', 'pnpm', 'node', 'python', 'python3', 'py', 'pip', 'pip3', 'pytest', 'uv', 'make', 'cargo', 'go',
  'gradle', 'gradlew', 'dotnet', 'tsc', 'deno', 'bun', 'rm', 'rmdir', 'unlink', 'find', 'New-Item', 'Copy-Item', 'Move-Item', 'Set-Content']);
/** A person's own device: these read it and change nothing. */
const DEVICE_READS = /^(device_location|device_info|device_sensors)$/;
const noWay = way => !way || way === R.WAY.none || /^none\b/.test(way);

function shell(command, r, root) {
  const approval = require('./approval');
  if (approval.verbsOf(command) === null) return 'a command line DOCA cannot reduce to verbs';
  const segs = require('./risk/classify').segments(command);
  if (segs.some(s => /^git\s+push\b/.test(s.text))) return 'it pushes to a remote';
  if (r.tier === 'read') return null;
  if (!root || r.way !== R.WAY.project) return 'it changes this machine outside a project, with no checkpoint to go back to';
  const unknown = segs.find(s => !R.READ_VERBS.has(s.verb) && !PROJECT_VERBS.has(s.verb) && !R.READ_IF[s.verb]?.(s.text));
  return unknown ? `it runs ${unknown.verb}, whose effects DOCA cannot tell` : null;
}

function mcp(name, r, person) {
  if (r.tier === 'read' || /^mcp__computer-/.test(name)) return null;
  const tool = name.split('__').pop();
  if (DEVICE_READS.test(tool)) {
    let s = null;
    try { s = require('../auth/reach').serverOf(name); } catch { /* unknown: asked */ }
    if (s?.kind === 'device' && s.ownerId && s.ownerId === person?.id) return null;
  }
  return 'it acts on another machine, where DOCA keeps no way back';
}

/**
 * Why this call is worth asking about under what-matters, or null when it runs unasked. `ctx`: {sessionId, person}.
 * Pure but for reading the conversation's project and the MCP server's annotations (risk.of).
 */
function why(name, args, ctx = {}) {
  args = args && typeof args === 'object' ? args : {};
  const risk = require('./risk');
  const root = risk.projectOf(ctx.sessionId)?.root || null;
  const r = risk.of(name, args, ctx);
  if (r.tier === 'outward') return `outward: ${r.why || 'it leaves the machine'}`;
  if (name === 'shell') return shell(args.command, r, root);
  if (/^mcp__/.test(name)) return mcp(name, r, ctx.person);
  if (r.tier === 'read') return null;
  if (noWay(r.way) && !(r.touches && root)) return 'there is no way back once it runs';
  return null;
}

/** The line the agent reads in its approval block. */
function block() {
  return 'Manual asks what matters: only calls that cannot be undone or that leave this machine are asked — sending data out, '
    + 'posting, mail, pushing, paying, deleting outside a project, a command line DOCA cannot read, a change outside a project, '
    + 'a tool on another machine. Reads and changes with a way back (project edits with a checkpoint, settings the person asked '
    + 'for, the panel\'s layout, memory, reminders) run without asking. A refusal is about the action, not the wording — do not retry '
    + 'it another way.';
}

module.exports = { MODES, setting, active, why, block, PROJECT_VERBS };
