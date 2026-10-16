'use strict';

/**
 * One stage of a project's build (params/build.js): what it depends on, its template resolved, its recipe run with no
 * model, the files it made and its checks. A stage is
 *
 *   { id, recipe, values?: {name: "…${param}…"}, template?: "<spec>.tmpl.json", reads?: [param or group…],
 *     writes?: ["parts/*.stl", …], checks?: [ {file, contains?} | a modules/checks check ] }
 *
 * It names a recipe — never a command line: the command lives in a shipped or saved recipe, and the file supplies only
 * values (quoted by recipes/run.js like any recipe's). The recipe gets every value of the stage plus `spec` (the
 * resolved template), `params` (the parameters file), `out` (where to write: build/.next, mirrored onto the project
 * when every check holds) and `root`.
 */
const fs = require('fs');
const path = require('path');
const file = require('./file');
const resolve = require('./resolve');

const ID = /^[\w-]{1,40}$/;

/** Problems with a stage, before anything runs. */
function problems(st, i) {
  const out = [];
  if (!st || typeof st !== 'object') return [`build[${i}] is a stage object.`];
  if (!ID.test(String(st.id || ''))) out.push(`build[${i}]: id is letters, digits, - and _.`);
  if (typeof st.recipe !== 'string' || !st.recipe) out.push(`build[${i}] (${st.id}): names the recipe it runs.`);
  else if (!require('../recipes/store').get(st.recipe)) out.push(`build[${i}] (${st.id}): there is no recipe "${st.recipe}".`);
  if (st.template && typeof st.template !== 'string') out.push(`build[${i}] (${st.id}): template is a path in the project.`);
  return out;
}

const inside = (root, rel) => { const abs = path.resolve(root, String(rel)); return (abs + path.sep).startsWith(path.resolve(root) + path.sep) ? abs : null; };

/** Every file under `dir` (relative, / separated) with its sha256; build/resolved is input, never output. */
function listing(dir, base = dir, out = {}) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of names) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) listing(abs, base, out);
    else if (e.isFile()) out[path.relative(base, abs).split(path.sep).join('/')] = file.sha(fs.readFileSync(abs));
  }
  return out;
}

/** `writes` globs: * within one path segment, ** across them. */
function globRe(g) {
  const s = String(g).replace(/\\/g, '/').replace(/[.+^$()|{}[\]]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${s}$`);
}

/** The parameter values a stage reads: named ones or whole groups; every one when it names none. */
function reads(st, doc, vals) {
  const want = Array.isArray(st.reads) ? st.reads.map(String) : null;
  if (!want) return vals;
  return Object.fromEntries(Object.entries(vals).filter(([n]) => want.includes(n) || want.includes(doc.params?.[n]?.group)));
}

/** A check's numbers may be sums of parameters ("${bed}-5"): filled, and made numbers where they read as one. */
function fillCheck(c, vars) {
  const walk = v => {
    if (typeof v === 'string' && /\$\{/.test(v)) {
      let n = NaN;
      try { n = resolve.number(v, vars); } catch { /* not a sum: text */ }
      return Number.isFinite(n) ? n : resolve.fillString(v, vars);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(c);
}

/** { ok, why } for one check, its files read in `dir` (the stage's output). */
async function runCheck(c, dir) {
  if (typeof c?.file === 'string') {
    const abs = inside(dir, c.file);
    if (!abs) return { ok: false, why: `${c.file} is outside the project` };
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { return { ok: false, why: `${c.file} was not made` }; }
    if (c.contains != null && !text.includes(String(c.contains))) return { ok: false, why: `${c.file} does not contain "${c.contains}"` };
    return { ok: true, why: `${c.file} is there${c.contains != null ? ` with "${c.contains}"` : ''}` };
  }
  const checks = require('../checks');
  if (!checks.kind(c)) return { ok: false, why: `not a check this build knows: ${JSON.stringify(c).slice(0, 120)}` };
  return checks.run(c, { cwd: dir });
}

/**
 * Run one stage. `ctx`: { root, next, doc, vals, derived, upstream, prev (this stage's last record), person, client,
 * signal, projectId, emit }. Returns its record: { id, inputs, ok, skipped?, outputs, checks, ms, why?, sessionId? }.
 */
async function run(st, ctx) {
  const { root, next, doc, vals } = ctx;
  const started = Date.now();
  const tmplAbs = st.template ? inside(root, st.template) : null;
  if (st.template && !tmplAbs) return { id: st.id, ok: false, why: `template ${st.template} is outside the project`, outputs: {}, checks: [] };
  let tmpl = null;
  if (tmplAbs) { try { tmpl = JSON.parse(fs.readFileSync(tmplAbs, 'utf8')); } catch (e) { return { id: st.id, ok: false, why: `template ${st.template}: ${e.message}`, outputs: {}, checks: [] }; } }
  const recipe = require('../recipes/store').get(st.recipe);
  const scriptRel = typeof st.values?.script === 'string' ? st.values.script : null;
  const inputs = file.sha(JSON.stringify({ reads: reads(st, doc, vals), values: st.values || {}, template: tmpl, recipe: [recipe?.id, recipe?.revision],
    script: scriptRel && inside(root, scriptRel) ? require('./stamp').shaOf(inside(root, scriptRel)) : null, checks: st.checks || [], upstream: ctx.upstream }));
  const vars = { ...vals, derived: ctx.derived };
  // Unchanged since a build that held: its files are copied into the next build as they are, and nothing runs.
  if (ctx.prev?.ok && ctx.prev.inputs === inputs && Object.keys(ctx.prev.outputs || {}).length
    && Object.entries(ctx.prev.outputs).every(([rel, sha]) => require('./stamp').shaOf(path.join(root, rel)) === sha)) {
    for (const rel of Object.keys(ctx.prev.outputs)) {
      fs.mkdirSync(path.dirname(path.join(next, rel)), { recursive: true });
      fs.copyFileSync(path.join(root, rel), path.join(next, rel));
    }
    return { ...ctx.prev, skipped: true, ms: 0 };
  }
  let spec = '';
  try {
    if (tmpl) {
      spec = path.join(root, 'build', 'resolved', `${st.id}.json`);
      fs.mkdirSync(path.dirname(spec), { recursive: true });
      fs.writeFileSync(spec, `${JSON.stringify(resolve.fill(tmpl, vars), null, 2)}\n`);
    }
    const params = { ...Object.fromEntries(Object.entries(resolve.fill(st.values || {}, vars)).map(([k, v]) => [k, String(v)])),
      spec, params: file.where(root), out: next, root };
    const before = listing(next);
    const r = await require('../recipes/run').run(recipe, { params, person: ctx.person, client: ctx.client, signal: ctx.signal,
      fields: { projectId: ctx.projectId, paramsBuild: true }, emit: ctx.emit });
    const after = listing(next);
    const want = Array.isArray(st.writes) && st.writes.length ? st.writes.map(globRe) : null;
    const outputs = Object.fromEntries(Object.entries(after).filter(([rel, sha]) => before[rel] !== sha && (!want || want.some(re => re.test(rel)))));
    if (!r.ok) return { id: st.id, inputs, ok: false, why: r.summary || 'the recipe stopped', outputs, checks: [], ms: Date.now() - started, sessionId: r.sessionId };
    const checks = [];
    for (const c of Array.isArray(st.checks) ? st.checks : []) {
      let filled;
      try { filled = fillCheck(c, vars); } catch (e) { checks.push({ check: c, ok: false, why: e.message }); continue; }
      checks.push({ check: filled, ...(await runCheck(filled, next)) });
    }
    const failed = checks.find(c => !c.ok);
    return { id: st.id, inputs, ok: !failed, ...(failed ? { why: failed.why } : {}), outputs, checks, ms: Date.now() - started, sessionId: r.sessionId };
  } catch (e) {
    return { id: st.id, inputs, ok: false, why: e.message, outputs: {}, checks: [], ms: Date.now() - started };
  }
}

module.exports = { problems, run, listing, globRe, fillCheck, reads };
