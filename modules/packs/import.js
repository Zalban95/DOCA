'use strict';

/**
 * Bringing a pack in (TODO H4.3): a `.dpack`, or a zip of other tools' own things — Agent Skills folders, a
 * Claude Desktop / Cursor / Claude Code config with `mcpServers`, subagent markdown under agents/, recipes,
 * memory as JSONL, AGENTS.md / CLAUDE.md / .mdc rules. `plan()` is the dry run — what it adds, what it would
 * overwrite, what it needs (secrets to fill, tools this hive lacks, a newer DOCA) and what it skips and why —
 * and `apply()` writes only what was chosen. Every write goes through the module that owns the thing, with
 * that module's checks (a skill name, a specialist's NEVER tools, a recipe's steps).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const zip = require('./zip');

const text = f => f.data.toString('utf8');

/** What the zip holds, as items: {kind, id, files|data, path}. */
function items(files) {
  const out = [], skipped = [];
  const byName = new Map(files.map(f => [f.name, f]));
  const manifest = byName.has('pack.json') ? (() => { try { return JSON.parse(text(byName.get('pack.json'))); } catch { return null; } })() : null;
  const skillRoots = files.filter(f => /(^|\/)SKILL\.md$/.test(f.name)).map(f => f.name.replace(/SKILL\.md$/, ''));
  for (const root of skillRoots) {
    const id = root.replace(/\/$/, '').split('/').pop() || 'skill';
    out.push({ kind: 'skill', id, root, files: files.filter(f => f.name.startsWith(root)) });
  }
  const inSkill = name => skillRoots.some(r => name.startsWith(r));
  for (const f of files) {
    if (f.name === 'pack.json' || inSkill(f.name)) continue;
    const base = f.name.split('/').pop();
    try {
      if (/^agents\/[^/]+\.md$/.test(f.name)) out.push({ kind: 'specialist', id: base.replace(/\.md$/, ''), data: text(f), path: f.name });
      else if (/\.recipe\.json$/.test(base)) { const r = JSON.parse(text(f)); out.push({ kind: 'recipe', id: r.id || base.replace(/\.recipe\.json$/, ''), data: r, path: f.name }); }
      else if (/\.json$/.test(base) && /mcpServers/.test(text(f))) {
        for (const [id, e] of Object.entries(JSON.parse(text(f)).mcpServers || {})) out.push({ kind: 'mcp', id, data: e, path: f.name });
      } else if (base === 'memory.jsonl') {
        const rows = text(f).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.key && r.value !== undefined);
        out.push({ kind: 'memory', id: `${rows.length} entries`, data: rows, path: f.name });
      } else if (/^(AGENTS|CLAUDE)\.md$/i.test(base) || /\.mdc$/.test(base)) {
        out.push({ kind: 'rules', id: base, data: rulesFrom(text(f)), path: f.name });
      } else if (!/^recipes\/[^/]+\.(sh|ps1)$/.test(f.name)) skipped.push({ path: f.name, why: 'not a kind of thing a pack carries' });
    } catch (e) { skipped.push({ path: f.name, why: `unreadable: ${e.message}` }); }
  }
  return { manifest, items: out, skipped };
}

/** The list items of a rules file: numbered or bulleted lines, front matter and headings left out. */
function rulesFrom(src) {
  return src.replace(/^---[\s\S]*?\n---\n/, '').split('\n')
    .map(l => (/^\s*(?:\d+[.)]|[-*])\s+(.+)$/.exec(l) || [])[1]).filter(Boolean).map(s => s.trim()).slice(0, 200);
}

function exists(it) {
  if (it.kind === 'skill') return require('../harness/skills').list().some(s => s.name === it.id && s.source === 'local');
  if (it.kind === 'specialist') return !!require('../agents/registry').get(it.id);
  if (it.kind === 'recipe') return !!require('../recipes/store').get(it.id);
  if (it.kind === 'mcp') return !!require('../mcp/registry').get(it.id);
  return false;
}

/** The dry run. */
function plan(buffer) {
  const { manifest, items: list, skipped } = items(zip.read(buffer));
  const have = new Set(require('../harness/tools').describe().map(t => t.name));
  const needs = { secrets: manifest?.needs?.secrets || [], missingTools: (manifest?.needs?.tools || []).filter(t => !have.has(t)) };
  const want = manifest?.needs?.doca?.replace(/^>=/, '');
  const ours = require('../../package.json').version;
  const older = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
  if (want && older(ours, want)) needs.doca = `made with DOCA ${want}; this is ${ours} — some parts may not load until it is updated`;
  for (const it of list.filter(i => i.kind === 'mcp')) for (const f of ['env', 'headers']) for (const [k, v] of Object.entries(it.data[f] || {})) if (v === '') needs.secrets.push(`mcp.${it.id}.${f}.${k}`);
  const view = it => ({ key: `${it.kind}:${it.id}`, kind: it.kind, id: it.id, path: it.path || it.root, overwrites: exists(it),
    ...(it.kind === 'mcp' ? { command: it.data.url || [it.data.command, ...(it.data.args || [])].join(' ') } : {}),
    ...(it.kind === 'rules' ? { count: it.data.length } : {}), ...(it.kind === 'recipe' ? { steps: (it.data.steps || []).length } : {}) });
  return { name: manifest?.name || null, description: manifest?.description || '', native: !manifest, items: list.map(view), needs: { ...needs, secrets: [...new Set(needs.secrets)] }, skipped };
}

/** Write what was chosen (`only`: keys from the plan; all when absent). Returns what happened to each. */
function apply(buffer, { only = null, overwrite = false, person = null } = {}) {
  const { items: list } = items(zip.read(buffer));
  const done = [];
  for (const it of list) {
    const key = `${it.kind}:${it.id}`;
    if (only && !only.includes(key)) continue;
    if (exists(it) && !overwrite) { done.push({ key, skipped: 'exists here (choose overwrite to replace it)' }); continue; }
    try {
      if (it.kind === 'skill') {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dpack-'));
        try {
          for (const f of it.files) { const dest = path.join(tmp, it.id, f.name.slice(it.root.length)); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, f.data); }
          const r = require('../harness/skills').importFrom(tmp, { overwrite })[0] || {};
          done.push(r.skipped ? { key, skipped: r.skipped } : { key, ok: true });
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      } else if (it.kind === 'specialist') {
        const def = require('../agents/markdown').parse(it.data, { fallbackId: it.id });
        const saved = require('../agents/registry').save(def);
        done.push({ key, ok: true, ...(saved?.refusedTools?.length ? { note: `refused tools: ${saved.refusedTools.join(', ')}` } : {}) });
      } else if (it.kind === 'recipe') {
        const store = require('../recipes/store');
        const { doca, revision, createdAt, updatedAt, ...r } = it.data;
        store.save({ ...r, id: exists(it) ? it.id : undefined, title: r.title || it.id, by: person?.id || null });
        done.push({ key, ok: true });
      } else if (it.kind === 'mcp') {
        const e = it.data;
        require('../mcp/registry').upsert({ id: it.id, label: it.id, transport: e.url ? 'http' : 'stdio', url: e.url, headers: e.headers,
          command: e.command, args: e.args, env: e.env, autostart: false });
        done.push({ key, ok: true, note: 'added, not started' });
      } else if (it.kind === 'memory') {
        const memory = require('../harness/memory');
        let n = 0;
        for (const r of it.data) { try { memory.memWrite({ key: r.key, value: r.value, category: r.category, tags: r.tags, pinned: r.pinned, source: 'user' }); n++; } catch { /* a locked or bad entry */ } }
        done.push({ key, ok: true, note: `${n} of ${it.data.length} written` });
      } else if (it.kind === 'rules') {
        const current = new Set(require('../harness/memory').rules().rules.map(r => (typeof r === 'string' ? r : r.text)));
        const add = it.data.filter(r => !current.has(r));
        if (add.length) require('../harness/memory').rulesPatch({ add, source: 'user' });
        done.push({ key, ok: true, note: `${add.length} new rule${add.length === 1 ? '' : 's'}` });
      }
    } catch (e) { done.push({ key, error: e.message }); }
  }
  return { done };
}

module.exports = { plan, apply, rulesFrom };
