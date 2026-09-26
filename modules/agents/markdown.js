'use strict';

/**
 * Agent definitions as markdown: a short front matter, then the role in prose.
 *
 *   ---
 *   name: blender-engineer
 *   label: Blender engineer
 *   description: Builds and renders Blender scenes. Dispatch for 3D modelling.
 *   kits: [files, shell, web]
 *   tools: [show_media]
 *   model: qwen3.8-27b
 *   provider: llamacpp
 *   memory: false
 *   maxSteps: 12
 *   ---
 *   You are the Blender engineer. …
 *
 * The same shape Claude Code subagents use (name, description, tools, model),
 * so one of those is imported by copying the file: its tool names (Read, Grep,
 * Bash, WebFetch…) are mapped onto kits, since the tools are not the same
 * tools. No YAML library: the front matter is `key: value` lines, with lists as
 * `[a, b]`, `a, b` or `- a` lines — what these files actually contain.
 */

/** Claude Code's tool names, as the kits that do the same work here. */
const CLAUDE_TOOLS = {
  Read: 'files', Write: 'files', Edit: 'files', MultiEdit: 'files', LS: 'files', NotebookEdit: 'files',
  Glob: 'code', Grep: 'code', Bash: 'shell', BashOutput: 'shell', KillBash: 'shell',
  WebFetch: 'web', WebSearch: 'web', TodoWrite: 'organization', Task: 'organization',
};

function parseList(v) {
  const s = String(v ?? '').trim();
  if (!s) return [];
  return s.replace(/^\[|\]$/g, '').split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function scalar(v) {
  const s = String(v ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

/** Split "---\nfront\n---\nbody". Returns { meta, body } (meta {} when there is none). */
function split(text) {
  const m = /^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/.exec(String(text || ''));
  if (!m) return { meta: {}, body: String(text || '').trim() };
  const meta = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(raw) || /^-\s+(.*)$/.exec(raw);
    if (item && listKey) { meta[listKey].push(item[1].trim().replace(/^['"]|['"]$/g, '')); continue; }
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (!kv) continue;
    listKey = null;
    if (kv[2].trim() === '') { meta[kv[1]] = []; listKey = kv[1]; }
    else meta[kv[1]] = kv[2];
  }
  return { meta, body: m[2].trim() };
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * A definition from markdown — ours or a Claude Code subagent's. `fallbackId`
 * (the file name) is used when the front matter names none.
 * Returns the definition registry.normalize() takes, plus `imported` notes.
 */
function parse(text, { fallbackId } = {}) {
  const { meta, body } = split(text);
  const notes = [];
  const kits = new Set(Array.isArray(meta.kits) ? meta.kits : parseList(meta.kits));
  const tools = [];
  for (const t of Array.isArray(meta.tools) ? meta.tools : parseList(meta.tools)) {
    if (CLAUDE_TOOLS[t]) { kits.add(CLAUDE_TOOLS[t]); continue; }
    // Claude Code's MCP tools (mcp__server__tool) are servers configured there, not here.
    if (/^[a-z][a-z0-9_]*$/.test(t) && !t.startsWith('mcp__')) tools.push(t);
    else notes.push(`tool "${t}" has no equivalent here and was left out`);
  }
  let id = slug(meta.id || meta.name || fallbackId);
  if (!/^[a-z]/.test(id)) id = `agent-${id}`.slice(0, 40);
  const def = {
    id,
    label: String(meta.label || meta.title || meta.name || id).slice(0, 60),
    note: String(meta.description || meta.note || '').slice(0, 300),
    role: body,
    kits: [...kits],
    tools,
  };
  for (const k of ['model', 'provider', 'environment']) if (meta[k] != null && meta[k] !== '') def[k] = String(scalar(meta[k]));
  // Claude Code's `model: inherit` / `sonnet` names models that are not ours: use the panel's.
  if (['inherit', 'sonnet', 'opus', 'haiku'].includes(def.model)) { notes.push(`model "${def.model}" is Claude Code's; this one uses the panel's model`); delete def.model; }
  for (const k of ['memory']) if (meta[k] != null) def[k] = scalar(meta[k]) === true;
  for (const k of ['maxSteps', 'maxTokens', 'contextWindow']) if (Number(scalar(meta[k])) > 0) def[k] = Number(scalar(meta[k]));
  return { ...def, imported: notes };
}

const listOut = a => `[${a.join(', ')}]`;

/** A normalized definition as markdown, to save or to export. */
function format(def) {
  const lines = ['---', `name: ${def.id}`];
  if (def.label && def.label !== def.id) lines.push(`label: ${def.label}`);
  if (def.note) lines.push(`description: ${String(def.note).replace(/\n/g, ' ')}`);
  if (def.kits?.length) lines.push(`kits: ${listOut(def.kits)}`);
  if (def.tools?.length) lines.push(`tools: ${listOut(def.tools)}`);
  for (const k of ['provider', 'model']) if (def[k]) lines.push(`${k}: ${def[k]}`);
  if (def.environment && def.environment !== 'minimal') lines.push(`environment: ${def.environment}`);
  lines.push(`memory: ${def.memory === true}`);
  for (const k of ['maxSteps', 'maxTokens', 'contextWindow']) if (def[k]) lines.push(`${k}: ${def[k]}`);
  lines.push('---', '', String(def.role || '').trim(), '');
  return lines.join('\n');
}

module.exports = { parse, format, split, CLAUDE_TOOLS };
