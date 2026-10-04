'use strict';

/**
 * A pack (docs/design/hive.md §2.4, §9; TODO H4.1–H4.2): what this hive made, in one `.dpack` (a zip) that
 * another hive imports — and that other tools read without DOCA, because every part inside is in the format
 * its own world uses:
 *
 *   pack.json                       what is inside, what it needs (DOCA version, tools, secrets to fill in)
 *   skills/<name>/SKILL.md …        Agent Skills folders (Claude Code, the Agent Skills standard)
 *   agents/<id>.md                  subagent markdown (Claude Code's .claude/agents format, DOCA's own editor format)
 *   recipes/<id>.recipe.json        recipes, and recipes/<id>.sh / .ps1 when every step is a shell command
 *   mcp.json                        { mcpServers: … } — what Claude Desktop, Cursor and Claude Code read
 *   memory.jsonl                    memory entries, one JSON object a line
 *   AGENTS.md                       the memory rules, as the instructions file every coding agent reads
 *
 * Nothing secret travels: an MCP server's env and header values whose names say key/token/secret/password are
 * emptied and listed under `needs.secrets`, for whoever imports it to fill in.
 */
const fs = require('fs');
const path = require('path');
const zip = require('./zip');

const VERSION = 1;
const SECRET = /(key|token|secret|password|passwd|credential|auth)/i;

function skillFiles(name) {
  const s = require('../harness/skills').list().find(x => x.name === name);
  if (!s) throw Object.assign(new Error(`No skill "${name}".`), { status: 404 });
  const out = [];
  const walk = (dir, rel) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'SKILL.original.md') continue;
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(path.join(dir, e.name), r); else out.push({ name: `skills/${name}${r}`, data: fs.readFileSync(path.join(dir, e.name)) });
  } };
  walk(s.dir, '');
  return out;
}

/** @param {{ name?, description?, skills?: string[], specialists?: string[], recipes?: string[], mcp?: string[], memory?: boolean, rules?: boolean }} sel */
function build(sel = {}) {
  const files = [];
  const contents = [];
  const needs = { doca: `>=${require('../../package.json').version}`, tools: new Set(), secrets: [] };
  for (const name of sel.skills || []) { files.push(...skillFiles(name)); contents.push({ kind: 'skill', id: name, path: `skills/${name}/` }); }
  for (const id of sel.specialists || []) {
    const def = require('../agents/registry').get(id);
    if (!def || def.broken) throw Object.assign(new Error(`No readable specialist "${id}".`), { status: 404 });
    files.push({ name: `agents/${id}.md`, data: require('../agents/markdown').format(def) });
    for (const t of def.tools || []) needs.tools.add(t);
    contents.push({ kind: 'specialist', id, path: `agents/${id}.md` });
  }
  for (const id of sel.recipes || []) {
    const r = require('../recipes/store').get(id);
    if (!r) throw Object.assign(new Error(`No recipe "${id}".`), { status: 404 });
    const ex = require('../recipes/export');
    files.push({ name: `recipes/${id}.recipe.json`, data: ex.exportAs(r, 'json').body });
    if (ex.shellOnly(r)) files.push({ name: `recipes/${id}.sh`, data: ex.exportAs(r, 'bash').body }, { name: `recipes/${id}.ps1`, data: ex.exportAs(r, 'powershell').body });
    for (const s of r.steps) needs.tools.add(s.tool);
    contents.push({ kind: 'recipe', id, path: `recipes/${id}.recipe.json` });
  }
  if (sel.mcp?.length) {
    const reg = require('../mcp/registry');
    const servers = {};
    for (const id of sel.mcp) {
      const spec = reg.get(id);
      if (!spec) throw Object.assign(new Error(`No MCP server "${id}".`), { status: 404 });
      if (spec.origin?.kind === 'client') continue;   // hosted by another machine: its address means nothing elsewhere
      const e = require('../mcp/export').entry(spec);
      for (const field of ['env', 'headers']) for (const k of Object.keys(e[field] || {}))
        if (SECRET.test(k)) { e[field] = { ...e[field], [k]: '' }; needs.secrets.push(`mcp.${id}.${field}.${k}`); }
      servers[id] = e;
      contents.push({ kind: 'mcp', id, path: 'mcp.json' });
    }
    files.push({ name: 'mcp.json', data: `${JSON.stringify({ mcpServers: servers }, null, 2)}\n` });
  }
  if (sel.memory) {
    const entries = require('../harness/memory').memList().map(({ key, value, category, tags, pinned, locked }) => ({ key, value, category, tags, pinned, locked }));
    files.push({ name: 'memory.jsonl', data: entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '') });
    contents.push({ kind: 'memory', count: entries.length, path: 'memory.jsonl' });
  }
  if (sel.rules) {
    const r = require('../harness/memory').rules();
    files.push({ name: 'AGENTS.md', data: `# Rules\n\n${(r.rules || []).map((x, i) => `${i + 1}. ${typeof x === 'string' ? x : x.text || JSON.stringify(x)}`).join('\n')}\n` });
    contents.push({ kind: 'rules', count: (r.rules || []).length, path: 'AGENTS.md' });
  }
  if (!contents.length) throw Object.assign(new Error('Choose at least one thing to put in the pack.'), { status: 400 });
  const manifest = { format: 'dpack', version: VERSION, name: String(sel.name || 'pack').slice(0, 80), description: String(sel.description || '').slice(0, 500),
    createdAt: new Date().toISOString(), from: { doca: require('../../package.json').version }, contents,
    needs: { doca: needs.doca, tools: [...needs.tools].sort(), secrets: needs.secrets } };
  files.unshift({ name: 'pack.json', data: `${JSON.stringify(manifest, null, 2)}\n` });
  return { manifest, buffer: zip.write(files) };
}

module.exports = { build, VERSION };
