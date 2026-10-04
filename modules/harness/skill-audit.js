'use strict';

/**
 * Is this skill written for DOCA, or for somebody else's harness? (Asked for
 * 2026-10-04: "a skill precisely made for a harness shows as to edit for Doca".)
 *
 * An imported skill is text another agent was meant to follow, and it speaks
 * that agent's dialect: "use the Bash tool", `allowed-tools: Read, Grep`,
 * `$ARGUMENTS`, a `!`git status`` line Claude Code runs before reading, a
 * `${CLAUDE_PLUGIN_ROOT}` path, Gemini's `{{args}}`, a Cursor rule's `globs`.
 * Followed literally here, it asks for tools that do not exist under those
 * names and placeholders nothing fills.
 *
 * - `audit()` reads a skill and says `ready` or `adapt`, which harness it looks
 *   written for, and every finding with its line and the DOCA equivalent. Static
 *   and cheap: no model call, so it runs on every list.
 * - Until it is adapted the skill still works: its manifest line is tagged and
 *   `skills.read()` puts a translation note above the body, so the agent maps
 *   the names itself.
 * - `adapt()` is the mechanical half — tool names, placeholders, the front matter
 *   only the other harness reads — returned as before/after for the person to
 *   look at, written only on their click, with the original kept beside it as
 *   `SKILL.original.md` (`restore()` puts it back). What cannot be translated by
 *   rule (a `!` command line, a plugin path) stays a finding marked `review`.
 */
const fs = require('fs');
const path = require('path');
const { split } = require('../agents/markdown');

/** Claude Code's tools and what does the same job here. */
const TOOLS = {
  Bash: 'shell', Read: 'read_file', Write: 'write_file', Edit: 'replace_in_files', MultiEdit: 'replace_in_files',
  Glob: 'search_files', Grep: 'search_files', LS: 'list_dir', WebFetch: 'http_fetch', WebSearch: 'research_docs',
  Task: 'agent_dispatch', TodoWrite: 'work_plan', NotebookEdit: 'write_file', AskUserQuestion: 'ask_device',
};
const TOOL_NAMES = Object.keys(TOOLS).join('|');
// A tool named as a tool — backticked, or "the X tool", "X tool", "use X to" — never the ordinary word.
const TOOL_RE = new RegExp(`\`(${TOOL_NAMES})\`|\\b(?:the )?(${TOOL_NAMES}) tool\\b|\\b[Uu]se (${TOOL_NAMES}) (?:to|for)\\b`, 'g');

const RULES = [
  { re: TOOL_RE, origin: 'claude-code', what: m => `the ${m[1] || m[2] || m[3]} tool`, fix: m => `${TOOLS[m[1] || m[2] || m[3]]}` },
  { re: /\$ARGUMENTS\b|\$[1-9]\b/g, origin: 'claude-code', what: m => `the ${m[0]} placeholder (filled by a Claude Code command)`, fix: () => 'the user\'s request' },
  { re: /\{\{args\}\}/g, origin: 'gemini', what: () => 'the {{args}} placeholder (filled by a Gemini CLI command)', fix: () => 'the user\'s request' },
  { re: /^!\s*`[^`]+`|!`[^`]+`/gm, origin: 'claude-code', what: m => `${m[0]} — Claude Code runs this before reading`, review: 'run it with shell first, then read on' },
  { re: /\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PROJECT_DIR|~\/\.claude\//g, origin: 'claude-code', what: m => `the path ${m[0]}`, review: 'point it at this skill\'s own folder (skill action file)' },
  { re: /\bCLAUDE\.md\b/g, origin: 'claude-code', what: () => 'CLAUDE.md', review: 'the project\'s rules come from repo_rules here' },
  { re: /\bGEMINI\.md\b|~\/\.gemini\//g, origin: 'gemini', what: m => m[0], review: 'the project\'s rules come from repo_rules here' },
  { re: /~\/\.codex\/|\bcodex exec\b/g, origin: 'codex', what: m => m[0], review: 'Codex-specific: say what to do instead' },
];
const META_ORIGIN = { 'allowed-tools': 'claude-code', 'argument-hint': 'claude-code', 'disable-model-invocation': 'claude-code', globs: 'cursor', alwaysApply: 'cursor' };
const LABEL = { 'claude-code': 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex', cursor: 'Cursor' };

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** { status: 'ready'|'adapt', origin, label, findings: [{ line, what, fix?, review? }], adapted } for a SKILL.md's text. */
function auditText(src) {
  const { meta, body } = split(src);
  const findings = [];
  const origins = {};
  // Lines as the file numbers them, not the body: what a person opening SKILL.md sees.
  const at = String(src).indexOf(String(body).slice(0, 40));
  const offset = at > 0 ? lineOf(src, at) - 1 : 0;
  for (const k of Object.keys(meta || {})) if (META_ORIGIN[k]) {
    findings.push({ line: null, what: `front matter "${k}" (read by ${LABEL[META_ORIGIN[k]]} only)`, fix: 'removed' });
    origins[META_ORIGIN[k]] = (origins[META_ORIGIN[k]] || 0) + 1;
  }
  for (const r of RULES) for (const m of String(body).matchAll(r.re)) {
    findings.push({ line: lineOf(body, m.index) + offset, what: r.what(m), ...(r.fix ? { fix: r.fix(m) } : { review: r.review }) });
    origins[r.origin] = (origins[r.origin] || 0) + 1;
  }
  findings.sort((a, b) => (a.line || 0) - (b.line || 0));   // front matter first, then in the order the file reads
  const origin = Object.entries(origins).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { status: findings.length ? 'adapt' : 'ready', origin, label: origin ? LABEL[origin] : null, findings,
    adapted: meta?.adaptedFor === 'doca' };
}

function audit(name) {
  const s = require('./skills').list().find(x => x.name === name);
  if (!s) throw Object.assign(new Error(`No skill called "${name}".`), { status: 404 });
  return { name, source: s.source, ...auditText(fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8')),
    hasOriginal: fs.existsSync(path.join(s.dir, 'SKILL.original.md')) };
}

/** The note `skills.read()` puts above a body that is not adapted yet: the agent translates as it goes. */
function readingNote(a) {
  if (a.status === 'ready') return '';
  const tools = [...new Set(a.findings.filter(f => f.fix && /tool$/.test(f.what)).map(f => `${f.what.replace(/^the | tool$/g, '')} → ${f.fix}`))];
  return `[Written for ${a.label || 'another harness'}, not adapted for DOCA yet. Translate as you follow it`
    + `${tools.length ? `: ${tools.join(', ')}` : ''}; a $ARGUMENTS or {{args}} placeholder means the user's request`
    + `${a.findings.some(f => f.review) ? '; lines marked for review (a !`command`, a plugin path) need judgement' : ''}.]\n\n`;
}

/** The mechanical rewrite: { before, after, findings, remaining } — nothing is written. */
function adaptText(src) {
  const { meta, body } = split(src);
  let out = String(body);
  out = out.replace(TOOL_RE, (whole, a, b, c) => {
    const name = a || b || c, to = TOOLS[name];
    return a ? `\`${to}\`` : whole.replace(name, to);
  });
  out = out.replace(/\$ARGUMENTS\b|\$[1-9]\b|\{\{args\}\}/g, 'the user\'s request');
  const kept = Object.fromEntries(Object.entries(meta || {}).filter(([k]) => !META_ORIGIN[k]));
  kept.adaptedFor = 'doca';
  const front = Object.entries(kept).map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`).join('\n');
  const after = `---\n${front}\n---\n\n${out.trim()}\n`;
  return { before: src, after, findings: auditText(src).findings, remaining: auditText(after).findings };
}

function dirOf(name) {
  const s = require('./skills').list().find(x => x.name === name);
  if (!s) throw Object.assign(new Error(`No skill called "${name}".`), { status: 404 });
  if (s.source !== 'local') throw Object.assign(new Error(`${name} ships with DOCA and is already written for it.`), { status: 400 });
  return s.dir;
}

/** Preview (apply false) or write (apply true) the adapted SKILL.md; the original is kept once, beside it. */
function adapt(name, { apply = false } = {}) {
  const dir = dirOf(name);
  const file = path.join(dir, 'SKILL.md');
  const r = adaptText(fs.readFileSync(file, 'utf8'));
  if (apply) {
    const orig = path.join(dir, 'SKILL.original.md');
    if (!fs.existsSync(orig)) fs.copyFileSync(file, orig);
    fs.writeFileSync(file, r.after);
  }
  return { name, applied: apply, ...r };
}

/** Put the imported original back. */
function restore(name) {
  const dir = dirOf(name);
  const orig = path.join(dir, 'SKILL.original.md');
  if (!fs.existsSync(orig)) throw Object.assign(new Error(`${name} has no original kept: it was never adapted here.`), { status: 400 });
  fs.copyFileSync(orig, path.join(dir, 'SKILL.md'));
  fs.rmSync(orig);
  return audit(name);
}

module.exports = { audit, auditText, adapt, adaptText, restore, readingNote, TOOLS };
