'use strict';

/**
 * Agent Skills from public collections on GitHub (asked 2026-10-09: "we can search and include the ones we need").
 * The Skills page searched this machine only — DOCA's and other harnesses' (skill-sources.js); this reads a few
 * well-known open collections of the same format (a folder holding SKILL.md), checked to exist on 2026-10-09:
 *
 *   anthropics/skills    Anthropic's examples (documents, design, testing, MCP servers…)
 *   openai/skills        OpenAI's skills for Codex
 *   obra/superpowers     a development method as skills (planning, debugging, review)
 *   huggingface/skills   Hugging Face's (models, datasets, training)
 *
 * Read as data, GET only: the repository's file list from GitHub's API (one request per collection an hour — the
 * unauthenticated limit is 60 an hour; `GITHUB_TOKEN` in the environment raises it), each SKILL.md's front matter from
 * raw.githubusercontent.com. Importing is the packs' way — a dry run first (`plan`: the SKILL.md as written, what
 * skill-audit.js finds in it, every file it carries and which of them are scripts), then a host's click (`importSkill`)
 * copies the files into this machine's skills. Nothing it carries is run, on import or after: a script is text the
 * agent may later run under its own approvals, like any file. Host only (auth/rights.js).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SOURCES = [
  { id: 'anthropics', repo: 'anthropics/skills', label: 'Anthropic' },
  { id: 'openai', repo: 'openai/skills', label: 'OpenAI' },
  { id: 'superpowers', repo: 'obra/superpowers', label: 'Superpowers' },
  { id: 'huggingface', repo: 'huggingface/skills', label: 'Hugging Face' },
];
const TTL_MS = 3600000, PER_REPO = 120, MAX_FILES = 60, MAX_FILE = 300000, MAX_TOTAL = 3000000;
const SCRIPT = /(\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1|bat|cmd|exe|bin)$)|(^|\/)scripts\//i;
const api = () => process.env.DOCA_SKILLS_API || 'https://api.github.com';
const raw = () => process.env.DOCA_SKILLS_RAW || 'https://raw.githubusercontent.com';
const bad = (m, status = 400) => Object.assign(new Error(m), { status });
const cache = new Map();   // repo → { at, tree, skills }

async function get(url, { json = false, token = false } = {}) {
  const headers = { 'User-Agent': 'doca-skills', ...(json ? { Accept: 'application/vnd.github+json' } : {}) };
  const t = token && (process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  if (t) headers.Authorization = `Bearer ${t}`;
  const r = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!r.ok) throw bad(r.status === 403 || r.status === 429
    ? 'GitHub refused for now (its limit is 60 requests an hour without a token): try again later.' : `${url} answered ${r.status}.`, 502);
  return json ? r.json() : r.text();
}

const source = repo => { const s = SOURCES.find(x => x.repo === repo); if (!s) throw bad(`${repo} is not one of the collections searched here.`); return s; };

/** Every skill folder of a collection, with its name and description, kept an hour. */
async function index(repo) {
  const hit = cache.get(repo);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const tree = (await get(`${api()}/repos/${repo}/git/trees/HEAD?recursive=1`, { json: true, token: true })).tree || [];
  const dirs = tree.filter(t => t.type === 'blob' && /(^|\/)SKILL\.md$/.test(t.path)).map(t => path.posix.dirname(t.path)).slice(0, PER_REPO);
  const { split } = require('../agents/markdown');
  const skills = [];
  for (let i = 0; i < dirs.length; i += 8) {
    await Promise.all(dirs.slice(i, i + 8).map(async dir => {
      try {
        const { meta } = split(await get(`${raw()}/${repo}/HEAD/${dir === '.' ? '' : `${dir}/`}SKILL.md`));
        skills.push({ repo, dir, name: String(meta.name || path.posix.basename(dir)).trim().slice(0, 64), description: String(meta.description || '').trim().slice(0, 400) });
      } catch { /* one unreadable skill does not hide the rest */ }
    }));
  }
  const out = { at: Date.now(), tree, skills: skills.sort((a, b) => a.name.localeCompare(b.name)) };
  cache.set(repo, out);
  return out;
}

/** Search every collection (or list them all with no words). Collections that cannot be read are named, not hidden. */
async function search(q = '') {
  const { matcher } = require('./skill-match');
  const score = String(q).trim() ? matcher(q) : () => 1;
  const here = new Set(require('./skills').list().map(s => s.name));
  const results = [], failed = [];
  await Promise.all(SOURCES.map(async s => {
    try {
      for (const k of (await index(s.repo)).skills) {
        const sc = score({ name: k.name, description: k.description, body: '' });
        if (sc > 0) results.push({ ...k, source: s.label, score: sc, here: here.has(k.name), url: `https://github.com/${s.repo}/tree/HEAD/${k.dir}` });
      }
    } catch (e) { failed.push(`${s.label}: ${e.message}`); }
  }));
  return { results: results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 60), failed,
    sources: SOURCES.map(s => ({ label: s.label, repo: s.repo })) };
}

/** What importing it would bring: the SKILL.md, the audit, every file, which are scripts — nothing written. */
async function plan(repo, dir) {
  source(repo);
  const ix = await index(repo);
  const skill = ix.skills.find(k => k.dir === dir);
  if (!skill) throw bad(`No skill at ${dir} in ${repo}.`, 404);
  const prefix = dir === '.' ? '' : `${dir}/`;
  const files = ix.tree.filter(t => t.type === 'blob' && t.path.startsWith(prefix)).map(t => ({ path: t.path.slice(prefix.length), bytes: t.size || 0 }));
  const text = await get(`${raw()}/${repo}/HEAD/${prefix}SKILL.md`);
  const total = files.reduce((n, f) => n + f.bytes, 0);
  const tooBig = files.length > MAX_FILES ? `${files.length} files (at most ${MAX_FILES})`
    : files.some(f => f.bytes > MAX_FILE) ? `a file over ${MAX_FILE / 1000} KB` : total > MAX_TOTAL ? `${Math.round(total / 1e6)} MB in all` : null;
  return { ...skill, url: `https://github.com/${repo}/tree/HEAD/${dir}`, text, audit: require('./skill-audit').auditText(text),
    files, scripts: files.filter(f => SCRIPT.test(f.path)).map(f => f.path), bytes: total, tooBig,
    exists: require('./skills').list().some(s => s.name === skill.name), validName: /^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name) };
}

/** Copy it into this machine's skills (a host's click after the plan). Its files are written, never run. */
async function importSkill(repo, dir, { overwrite = false } = {}) {
  const p = await plan(repo, dir);
  if (p.tooBig) throw bad(`Not imported: it carries ${p.tooBig}. Copy it by hand if you want it.`);
  if (!p.validName) throw bad(`"${p.name}" is not a skill name here (lower-case letters, digits and -).`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doca-skill-'));
  try {
    const root = path.join(tmp, p.name);
    const prefix = dir === '.' ? '' : `${dir}/`;
    for (const f of p.files) {
      const dest = path.resolve(root, f.path);
      if (!dest.startsWith(root + path.sep)) continue;   // a path that would land outside the skill is left out
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const r = await fetch(`${raw()}/${repo}/HEAD/${prefix}${f.path.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'User-Agent': 'doca-skills' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw bad(`${f.path} could not be read (${r.status}).`, 502);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()), { mode: 0o644 });
    }
    const out = require('./skills').importFrom(tmp, { overwrite });
    return { imported: out, from: p.url, scripts: p.scripts };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { SOURCES, search, plan, importSkill, index, _cache: cache };
