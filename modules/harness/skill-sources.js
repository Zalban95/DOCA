'use strict';

/**
 * Skills from other harnesses (TODO.md, Done log 2026-09-25: "Skills from other
 * harnesses (Claude Code, Codex, Cursor rules…) listed and managed in the
 * Skills section, usable by the DOCA harness").
 *
 * Only Agent Skills folders (a folder with SKILL.md) imported until now, which
 * is Claude Code's skills and nobody else's. The other harnesses keep the same
 * kind of thing — a named procedure with a line saying when to use it — as one
 * file each, in their own shape:
 *
 *   Claude Code   ~/.claude/skills/<n>/SKILL.md           folder, as is
 *                 ~/.claude/plugins/…/skills/<n>/SKILL.md folder, as is
 *                 ~/.claude/commands/<n>.md               front matter `description`, body
 *   Codex         ~/.codex/prompts/<n>.md                 same shape
 *   Gemini CLI    ~/.gemini/commands/<n>.toml             description = "…", prompt = """…"""
 *   Cursor        <project>/.cursor/rules/<n>.mdc         front matter `description`, body
 *
 * A single-file one becomes a skill folder through skills.write(), so after the
 * import it is an ordinary local skill: listed, loaded by the `skill` tool,
 * editable. The original is never touched. Nothing here runs anything: a
 * command file is text the agent reads, which is all a skill is.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { split } = require('../agents/markdown');

const home = () => os.homedir();

/** A file name as a skill name: lower-case letters, digits and -, up to 64. */
const slug = s => String(s).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'imported';

const firstLine = body => String(body).split('\n').map(l => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '';

/** Front matter + body, the way Claude Code commands, Codex prompts and Cursor rules are written. */
function fromMarkdown(file) {
  const { meta, body } = split(fs.readFileSync(file, 'utf8'));
  const text = String(body || '').trim();
  return { name: slug(path.basename(file)), description: String(meta.description || firstLine(text)).replace(/\s+/g, ' ').slice(0, 300), body: text };
}

/** Gemini CLI's command files: just the two keys it defines, without a TOML dependency. */
function fromToml(file) {
  const src = fs.readFileSync(file, 'utf8');
  const multi = /prompt\s*=\s*"""([\s\S]*?)"""/.exec(src) || /prompt\s*=\s*'''([\s\S]*?)'''/.exec(src);
  const single = /prompt\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(src);
  const desc = /description\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(src);
  const body = (multi ? multi[1] : single ? JSON.parse(`"${single[1]}"`) : '').trim();
  return { name: slug(path.basename(file)), description: (desc ? JSON.parse(`"${desc[1]}"`) : firstLine(body)).slice(0, 300), body };
}

function filesIn(dir, ext) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith(ext)).map(f => path.join(dir, f)).sort(); } catch { return []; }
}

/** Skill folders under a root, at most `depth` levels down (plugins nest them). */
function skillDirs(root, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()); } catch { return []; }
  const out = [];
  for (const e of entries) {
    const dir = path.join(root, e.name);
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) out.push(dir);
    else if (depth > 0) out.push(...skillDirs(dir, depth - 1));
  }
  return out;
}

/** The known places, each with how to read an item from it. `project` adds a project's Cursor rules. */
function sources({ project } = {}) {
  const h = home();
  const folder = dir => {
    const { meta } = split(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
    return { name: String(meta.name || path.basename(dir)).trim(), description: String(meta.description || '').trim().slice(0, 300), dir };
  };
  const list = [
    { id: 'claude-skills', label: 'Claude Code skills', path: path.join(h, '.claude', 'skills'), items: () => skillDirs(path.join(h, '.claude', 'skills')).map(folder) },
    { id: 'claude-plugins', label: 'Claude Code plugin skills', path: path.join(h, '.claude', 'plugins'), items: () => skillDirs(path.join(h, '.claude', 'plugins'), 5).map(folder) },
    { id: 'claude-commands', label: 'Claude Code commands', path: path.join(h, '.claude', 'commands'), items: () => filesIn(path.join(h, '.claude', 'commands'), '.md').map(fromMarkdown) },
    { id: 'codex-prompts', label: 'Codex prompts', path: path.join(h, '.codex', 'prompts'), items: () => filesIn(path.join(h, '.codex', 'prompts'), '.md').map(fromMarkdown) },
    { id: 'gemini-commands', label: 'Gemini CLI commands', path: path.join(h, '.gemini', 'commands'), items: () => filesIn(path.join(h, '.gemini', 'commands'), '.toml').map(fromToml) },
  ];
  if (project) list.push({ id: 'cursor-rules', label: `Cursor rules in ${project}`, path: path.join(project, '.cursor', 'rules'),
    items: () => filesIn(path.join(project, '.cursor', 'rules'), '.mdc').map(fromMarkdown) });
  return list;
}

/** What is there to import, per source; sources that do not exist on this machine are left out. */
function detect(opts) {
  const have = new Set(require('./skills').list().filter(s => s.source === 'local').map(s => s.name));
  return sources(opts).map(s => {
    let items = [];
    try { items = s.items().filter(i => i.body !== '' || i.dir); } catch { items = []; }
    return { id: s.id, label: s.label, path: s.path, items: items.map(i => ({ name: i.name, description: i.description, here: have.has(i.name) })) };
  }).filter(s => s.items.length);
}

/** Import the named items (all when `names` is empty) from one source. Existing local skills are skipped unless `overwrite`. */
function importSource(id, { names = [], overwrite = false, project } = {}) {
  const skills = require('./skills');
  const src = sources({ project }).find(s => s.id === id);
  if (!src) throw Object.assign(new Error(`No skill source "${id}".`), { status: 404 });
  const have = new Set(skills.list().filter(s => s.source === 'local').map(s => s.name));
  const out = [];
  for (const item of src.items()) {
    if (names.length && !names.includes(item.name)) continue;
    if (have.has(item.name) && !overwrite) { out.push({ name: item.name, skipped: 'exists here' }); continue; }
    try {
      if (item.dir) {
        fs.cpSync(item.dir, skills.importDest(item.name), { recursive: true });
      } else {
        if (!item.body) { out.push({ name: item.name, skipped: 'empty' }); continue; }
        skills.write(item.name, { description: item.description || `Imported from ${src.label}.`,
          body: `${item.body}\n\n<!-- Imported from ${src.label}: ${src.path} -->` });
      }
      out.push({ name: item.name, description: item.description, from: src.label });
    } catch (e) { out.push({ name: item.name, skipped: e.message }); }
  }
  return out;
}

/**
 * One search over every skill this machine has: DOCA's own (shipped and made
 * here) and every other harness's, imported or not (asked 2026-10-04). Words
 * score by where they hit — name, then description, then body — and a result
 * says where it lives, whether it is in DOCA yet, and a line of context.
 */
function search(q, { project, limit = 30 } = {}) {
  const words = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
  if (!words.length) return [];
  // Loose: stems, prefixes, typos, a few synonyms, weighted by where (skill-match.js).
  const m = require('./skill-match').matcher(q);
  const score = (name, description, body) => m({ name, description, body });
  const snippet = body => {
    const lower = body.toLowerCase();
    const at = words.flatMap(w => [w, require('./skill-match').stem(w)]).map(w => lower.indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0];
    return at === undefined ? '' : body.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, ' ').trim();
  };
  const bodyOf = dir => { try { return split(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).body || ''; } catch { return ''; } };
  const out = [];
  for (const s of require('./skills').list()) {
    const body = bodyOf(s.dir);
    const n = score(s.name, s.description, body);
    if (n) out.push({ name: s.name, description: s.description, where: s.source === 'shipped' ? 'DOCA (shipped)' : 'DOCA (this machine)',
      source: 'doca', inDoca: true, harness: s.harness || null, score: n, snippet: snippet(body) });
  }
  const have = new Set(require('./skills').list().map(s => s.name));
  for (const src of sources({ project })) {
    let items = [];
    try { items = src.items(); } catch { continue; }
    for (const i of items) {
      const body = i.body ?? bodyOf(i.dir);
      const n = score(i.name, i.description || '', body);
      if (n) out.push({ name: i.name, description: i.description, where: src.label, source: src.id, inDoca: have.has(i.name), score: n, snippet: snippet(body) });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

module.exports = { detect, importSource, search, sources, fromMarkdown, fromToml, slug };
