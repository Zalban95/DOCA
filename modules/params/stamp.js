'use strict';

/**
 * The proof a project's deliverables came from its values (parametric projects, phase 1): `project.build.json` beside
 * the parameters, written only by the hub's build — the parameters file's hash, the build's fingerprint, each stage's
 * inputs hash and outputs (sha256 of every file), each check's verdict, when and by whom. "Built from the current
 * values" is then a comparison anyone can repeat (builtNow, and the check `{built}` in modules/checks).
 *
 * The build is accepted like a plan: the fingerprint of the `build` section and of each script a stage runs is kept per
 * person as of their last run (DATA_DIR store, not the project's folder), so a build someone else changed since is said
 * before it runs again (owner, 2026-10-16: Save shows the diff and asks; a build asked in chat says it in one line).
 */
const fs = require('fs');
const path = require('path');
const file = require('./file');

const NAME = 'project.build.json';
const where = root => path.join(root, NAME);

function read(root) { try { return JSON.parse(fs.readFileSync(where(root), 'utf8')); } catch { return null; } }
function write(root, stamp) { fs.writeFileSync(where(root), `${JSON.stringify(stamp, null, 2)}\n`); return stamp; }

const shaOf = abs => { try { return file.sha(fs.readFileSync(abs)); } catch { return null; } };

/** The scripts the build runs (a stage's `values.script`), inside the project. */
function scripts(root, doc) {
  const out = {};
  for (const st of Array.isArray(doc?.build) ? doc.build : []) {
    const rel = st?.values?.script;
    if (typeof rel !== 'string' || !rel || rel.includes('${')) continue;
    const abs = path.resolve(root, rel);
    if ((abs + path.sep).startsWith(path.resolve(root) + path.sep)) out[rel] = shaOf(abs);
  }
  return out;
}

/** What a person accepts by running it: the build section and its scripts, hashed. */
function fingerprint(root, doc) {
  const build = Array.isArray(doc?.build) ? doc.build : [];
  const sc = scripts(root, doc);
  return { hash: file.sha(JSON.stringify({ build, scripts: sc })), build, scripts: sc };
}

/** { ok, why }: the deliverables on disk are the ones the build made from the values in the file now. */
function builtNow(root) {
  const f = file.read(root);
  if (!f.exists) return { ok: false, why: `there is no ${file.NAME}` };
  const s = read(root);
  if (!s) return { ok: false, why: 'it was never built by the hub (no project.build.json)' };
  if (s.paramsHash !== f.hash) return { ok: false, why: `the values changed since the last build (${s.at})` };
  if (!s.ok) return { ok: false, why: `the last build failed${s.failed ? ` at ${s.failed}` : ''}: its deliverables are older than the values` };
  for (const st of s.stages || []) {
    for (const [rel, sha] of Object.entries(st.outputs || {})) {
      const now = shaOf(path.join(root, rel));
      if (!now) return { ok: false, why: `${rel} is gone since the build` };
      if (now !== sha) return { ok: false, why: `${rel} changed since the build made it` };
    }
  }
  const outputs = (s.stages || []).reduce((n, st) => n + Object.keys(st.outputs || {}).length, 0);
  return { ok: true, why: `built ${s.at} from the current values: ${outputs} file${outputs === 1 ? '' : 's'} as the build left them` };
}

// ── What each person last ran ──
const KEY = 'params/accepted';
const accepted = () => require('../store').readJson(KEY, {});

/** { changed, diff? }: whether the build changed since this person last ran it (else since the last build). */
function changedFor(person, projectId, root, fp) {
  const mine = person?.id ? accepted()[projectId]?.[person.id] : null;
  const last = read(root)?.build;
  const base = mine || (last ? { hash: last.hash, build: last.steps, scripts: last.scripts } : null);
  if (!base || base.hash === fp.hash) return { changed: false };
  const d = require('../workstream/diff').diff(JSON.stringify(base.build || [], null, 2), JSON.stringify(fp.build, null, 2));
  const lines = d.hunks.flatMap(h => h.lines.filter(l => l.op !== ' ').map(l => `${l.op} ${l.line}`)).slice(0, 80);
  const scriptsChanged = Object.keys({ ...fp.scripts, ...(base.scripts || {}) }).filter(k => (base.scripts || {})[k] !== fp.scripts[k]);
  return { changed: true, since: mine ? 'you last ran it' : 'the last build', diff: lines, scripts: scriptsChanged };
}

function accept(person, projectId, fp) {
  if (!person?.id) return;
  const all = accepted();
  all[projectId] = { ...(all[projectId] || {}), [person.id]: { hash: fp.hash, build: fp.build, scripts: fp.scripts, at: new Date().toISOString() } };
  require('../store').writeJson(KEY, all);
}

/** One line for a reply: what changed in the build since this person last ran it. */
function changedLine(c) {
  if (!c?.changed) return '';
  const parts = [c.diff?.length ? `${c.diff.length} line(s) of its steps` : '', c.scripts?.length ? `script ${c.scripts.join(', ')}` : ''].filter(Boolean);
  return `The build changed since ${c.since}${parts.length ? ` (${parts.join('; ')})` : ''}.`;
}

module.exports = { NAME, read, write, shaOf, scripts, fingerprint, builtNow, changedFor, accept, changedLine };
