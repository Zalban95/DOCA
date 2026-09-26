'use strict';

/**
 * Skills: procedures the agent loads when a task needs them.
 *
 * TODO.md "Two layers of learned knowledge", layer 2: a skill is how to do a
 * kind of thing — build and ship an Android app, write a specialist — not a
 * fact about this machine. It reaches the prompt as a **manifest**: its name
 * and one-line description, always resident (tens of tokens); its body only
 * when the agent loads it with the `skill` tool because the task matches.
 *
 * The format is the open Agent Skills one — a folder holding `SKILL.md` (front
 * matter `name`, `description`, then the instructions) and any files it refers
 * to — so a Claude Code skill folder (~/.claude/skills/<name>) is imported by
 * copying it. Two places, the second winning on a name clash:
 *   <repo>/skills/<name>/SKILL.md      shipped with DOCA, updated by releases
 *   <DATA_DIR>/skills/<name>/SKILL.md  made or imported on this machine
 * The agent writes only the second. Reporting a learned skill upward (typed,
 * reviewed, the person's click) is the later half of the TODO entry.
 */
const fs   = require('fs');
const path = require('path');
const store = require('../store');
const { split } = require('../agents/markdown');

const SHIPPED = path.join(__dirname, '..', '..', 'skills');
const local = () => store.dir('skills');
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BODY = 40000, MAX_FILE = 200000;
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

function readDir(root, source) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; }
  const out = [];
  for (const n of names) {
    const file = path.join(root, n, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    try {
      const { meta } = split(fs.readFileSync(file, 'utf8'));
      out.push({ name: String(meta.name || n).trim(), description: String(meta.description || '').trim().slice(0, 400), source, dir: path.join(root, n) });
    } catch { /* unreadable: left out */ }
  }
  return out;
}

/** Every skill: shipped, overridden by this machine's of the same name. */
function list() {
  const map = new Map();
  for (const s of readDir(SHIPPED, 'shipped')) map.set(s.name, s);
  for (const s of readDir(local(), 'local')) map.set(s.name, s);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function need(name) {
  const s = list().find(x => x.name === name);
  if (!s) throw bad(`No skill called "${name}". The manifest in your prompt lists them.`, 404);
  return s;
}

/** A skill's instructions and the files beside them. */
function read(name) {
  const s = need(name);
  const { body } = split(fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'));
  const files = [];
  const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r); else if (r !== 'SKILL.md') files.push(r);
  } };
  walk(s.dir);
  return { ...s, body: body.slice(0, MAX_BODY), files };
}

/** One of a skill's own files (a script, a template), inside its folder only. */
function file(name, rel) {
  const s = need(name);
  const abs = path.resolve(s.dir, String(rel || ''));
  if (!abs.startsWith(s.dir + path.sep)) throw bad('That path is outside the skill.');
  const st = fs.statSync(abs);
  if (st.size > MAX_FILE) throw bad(`${rel} is ${st.size} bytes; read it with read_file at ${abs}.`);
  return { path: abs, text: fs.readFileSync(abs, 'utf8') };
}

/** Make or replace a skill on this machine. */
function write(name, { description, body }) {
  if (!NAME.test(String(name || ''))) throw bad('A skill name is lower-case letters, digits and -, up to 64.');
  if (!String(description || '').trim()) throw bad('A skill needs a description: when to use it, in one line.');
  if (!String(body || '').trim()) throw bad('A skill needs its instructions.');
  const dir = path.join(local(), name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${String(description).replace(/\n/g, ' ').trim()}\n---\n\n${String(body).trim().slice(0, MAX_BODY)}\n`);
  return need(name);
}

/** Copy every skill folder (one holding SKILL.md) from `folder` to this machine's. */
function importFrom(folder, { overwrite = false } = {}) {
  const out = [];
  for (const s of readDir(folder, 'import')) {
    const dest = path.join(local(), s.name);
    if (fs.existsSync(dest) && !overwrite) { out.push({ name: s.name, skipped: 'exists here' }); continue; }
    fs.cpSync(s.dir, dest, { recursive: true });
    out.push({ name: s.name, description: s.description });
  }
  return out;
}

/** The manifest in the prompt: names and triggers, bodies left out until loaded. */
function manifestBlock(only) {
  const rows = list().filter(s => !only || only.includes(s.name));
  if (!rows.length) return '';
  return ['# Skills — procedures you load when a task matches (skill action read, then follow it)',
    ...rows.map(s => `- ${s.name}: ${s.description || '(no description)'}`)].join('\n');
}

module.exports = { list, read, file, write, importFrom, manifestBlock, SHIPPED };
