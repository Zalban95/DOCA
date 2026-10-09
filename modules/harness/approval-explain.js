'use strict';

/**
 * An approval explained (the owner, 2026-10-09: "When requesting approvals show what they mean to do with that request
 * and what it does, and underneath the code section to approve in an extendable dropdown"). Presentation only: the
 * request approval.gate made is not changed in anything a decision reads (keys, forced, recheck, level, machine) — these
 * fields are added beside them.
 *
 *   why        the agent's own words from the step that made the call (its text before the call), trimmed to a sentence
 *              or two — else the request the conversation is answering. Labelled by `whyFrom`: 'agent' or 'request'.
 *              The agent's claim, never in place of `does`.
 *   does       what the call does, mechanical (approval-does.js): a fixed sentence from the tool and its arguments.
 *   way        whether it can be undone, from the risk table.
 *   asked      why it is asked, when the gate said more than the call itself (a protected file, outside text, a level).
 *   detail     the exact request — the command line or the arguments as they will run — secrets masked.
 *
 *   explain(gate, name, args, { reply, sessionId, mission }) → the gate's request with these fields added
 *   noteFor(req, { watch })   the text a device's prompt carries; blocksFor(req, { watch }) its body blocks
 */
const { MASK, mask } = require('../secrets-mask');

const clean = t => String(t || '')
  .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
  .replace(/\[(whispers|laughs|sighs|excited|calm|sad|curious|serious)\]/gi, ' ')
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/[#*_`>]+/g, '')
  .replace(/\s+/g, ' ').trim();

/** A sentence or two, at most `n` characters, cut at a sentence end when there is one. */
function sentences(text, n = 280) {
  const t = clean(text);
  const all = t.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
  const two = all.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (two && two.length <= n) return all.length > 2 ? `${two} …` : t.length <= n ? t : two;
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
}

/** The agent's words for this step, else what the conversation was asked. */
function whyOf({ reply, sessionId } = {}) {
  const own = sentences(reply?.content);
  if (own) return { why: own, whyFrom: 'agent' };
  try {
    const rows = require('./memory').messages(sessionId) || [];
    const asked = [...rows].reverse().find(r => r.role === 'user' && typeof r.content === 'string' && clean(r.content));
    if (asked) return { why: sentences(asked.content, 200), whyFrom: 'request' };
  } catch { /* no transcript */ }
  return null;
}

/** Secrets on a command line: a secret-named flag's value, NAME_TOKEN=…, a bearer value, token=… (busy-read's rules). */
function maskLine(line) {
  return String(line)
    .replace(/(--?[\w-]*(?:token|key|secret|password|passwd|bearer)[\w-]*[=\s]+)(?!-)("[^"]*"|'[^']*'|\S+)/gi, `$1${MASK}`)
    .replace(/\b([A-Za-z_]\w*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD)\w*=)("[^"]*"|'[^']*'|\S+)/g, `$1${MASK}`)
    .replace(/(\bbearer\s+)[^\s'"]+/gi, `$1${MASK}`)
    .replace(/(\b(?:token|api[-_]?key|secret|password|passwd)\s*[=:]\s*)[^\s'"&]+/gi, `$1${MASK}`)
    .replace(/(https?:\/\/[^\s:@/]+:)[^\s@/]+@/g, `$1${MASK}@`);
}

/** The exact request, as it will run: a command line as typed, anything else as its arguments — secrets masked. */
function detailOf(name, args, { mission } = {}) {
  args = args && typeof args === 'object' ? args : {};
  const cut = t => (t.length > 6000 ? `${t.slice(0, 6000)}\n… (${t.length - 6000} more characters)` : t);
  if (name === 'shell') {
    const extra = Object.keys(args).filter(k => k !== 'command');
    return cut(maskLine(args.command || '') + (extra.length ? `\n\n${extra.map(k => `${k}: ${JSON.stringify(args[k])}`).join('\n')}` : ''));
  }
  let a = mask(args);
  for (const k of ['headers', 'env']) if (a[k] && typeof a[k] === 'object') a[k] = mask(a[k], k, true);
  if (typeof a.url === 'string') a.url = maskLine(a.url);
  if (name === 'api_call' && typeof args.key === 'string') a.key = args.key;   // the key's name, never the key
  // What a mission would type on a machine is never shown (mission-asks.js): its length is.
  if (mission && typeof a.text === 'string') a = { ...a, text: `(${a.text.length} characters)` };
  try { return cut(JSON.stringify(a, null, 2)); } catch { return ''; }
}

/** Why it is asked, when the gate's summary says more than the call: what follows the call's own line, or all of it. */
function askedOf(summary, name, args) {
  const s = String(summary || '');
  const base = require('./approval').summarize(name, args);
  if (!s || s === base) return null;
  if (base && s.startsWith(base)) return s.slice(base.length).replace(/^\s*—\s*/, '').trim() || null;
  return s;
}

function explain(gate, name, args, ctx = {}) {
  if (!gate) return gate;
  const d = require('./approval-does');
  const out = { ...gate };
  try {
    Object.assign(out, whyOf(ctx) || {});
    out.does = d.does(name, args, ctx);
    const way = d.way(name, args, ctx);
    if (way) out.way = way;
    const asked = askedOf(gate.summary, name, args);
    if (asked) out.asked = asked;
    out.detail = detailOf(name, args, ctx);
  } catch { /* presentation only: the request stands as the gate made it */ }
  return out;
}

const shorten = (t, n) => {
  const bare = String(t || '').replace(/\s*\([^)]*\)/g, '');   // a wrist has no room for a host's name or a list of paths
  return bare.length > n ? `${bare.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : bare;
};

/** The text a device's prompt carries: who says why, and what it does. A watch gets both shortened and no code. */
function noteFor(req, { watch = false } = {}) {
  if (!req.does) return req.summary;
  const lines = [];
  if (req.why) lines.push(`${req.whyFrom === 'agent' ? 'The agent says' : 'Asked'}: ${watch ? shorten(req.why, 90) : req.why}`);
  lines.push(watch ? shorten(req.does, 110) : `${req.does}${req.way ? ` ${req.way}` : ''}`);
  if (!watch && req.asked) lines.push(`Asked because: ${req.asked}`);
  return lines.join('\n');
}

/**
 * A device's prompt body (PROTOCOL §19.1 text blocks): the agent's words, what it does, and — not on a watch — the
 * exact request as a `code` block with `ext.collapsed`, which a client draws folded under `ext.label`.
 */
function blocksFor(req, { watch = false } = {}) {
  if (!req.does) return null;
  const out = [];
  if (req.why) out.push({ type: 'text', style: 'body', text: `${req.whyFrom === 'agent' ? 'The agent says' : 'Asked'}: ${watch ? shorten(req.why, 90) : req.why}`, ext: { role: 'why', from: req.whyFrom } });
  out.push({ type: 'text', style: 'body', text: watch ? shorten(req.does, 110) : req.does, ext: { role: 'does' } });
  if (!watch && req.way) out.push({ type: 'text', style: 'caption', text: req.way, ext: { role: 'way' } });
  if (!watch && req.asked) out.push({ type: 'text', style: 'caption', text: `Asked because: ${req.asked}`, ext: { role: 'asked' } });
  if (!watch && req.detail) out.push({ type: 'text', style: 'code', text: req.detail.slice(0, 2000), ext: { role: 'detail', collapsed: true, label: 'The exact request' } });
  return out;
}

/** A device's prompt for a request: `{ note, blocks }`, shortened and without code on a watch. */
function forDevice(req, client) {
  const watch = client?.formFactor === 'watch' || client?.caps?.formFactor === 'watch';
  return { note: noteFor(req, { watch }), blocks: blocksFor(req, { watch }) };
}

module.exports = { explain, forDevice, whyOf, detailOf, maskLine, askedOf, noteFor, blocksFor, sentences };
