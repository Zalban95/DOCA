'use strict';

/**
 * Running a recipe without a model (TODO H3.3): each step is a tool call made through the turn's own
 * `runToolCalls` — the conversation's mode, the person's level and grants, the approval gate, the control
 * plane and the charter's tool rules are the agent's, exactly — in a conversation of its own, so every step
 * and its result is in a transcript a person (or the agent repairing the recipe) can read. A failed check
 * stops the run and says which step and why.
 */
const crypto = require('crypto');

/** `{name}` → the parameter's value; quoted for the host's shell when it lands in a shell command. */
function fill(value, params, { shellQuote = false } = {}) {
  if (typeof value === 'string') {
    // A placeholder the author already put in quotes ("{path}") is replaced quotes and all, so it is quoted once.
    return value.replace(shellQuote ? /(["']?)\{([a-z0-9_]+)\}\1/gi : /()\{([a-z0-9_]+)\}/gi, (m, _q, name) => {
      if (!(name in params)) return m;
      const v = String(params[name]);
      if (!shellQuote) return v;
      return require('../shell').WIN ? `'${v.replace(/'/g, "''")}'` : `'${v.replace(/'/g, "'\\''")}'`;
    });
  }
  if (Array.isArray(value)) return value.map(v => fill(v, params, { shellQuote }));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, params, { shellQuote })]));
  return value;
}

/** Whether a step's result passed its check. Default: not an error, a refusal, or a non-zero exit. */
function passed(result, check = {}) {
  const r = String(result || '');
  if (check.ok !== false) {
    if (/^(Error|Refused|Not run)\b/.test(r)) return { ok: false, why: r.split('\n')[0].slice(0, 300) };
    const exit = /^exit (-?\d+|null)\b/.exec(r);
    if (exit && exit[1] !== '0') return { ok: false, why: `exit ${exit[1]}` };
  }
  if (check.contains && !r.includes(check.contains)) return { ok: false, why: `the result does not contain "${check.contains}"` };
  if (check.matches && !new RegExp(check.matches).test(r)) return { ok: false, why: `the result does not match /${check.matches}/` };
  return { ok: true };
}

/** The values a run uses: given ones, then defaults; a missing one is refused before anything runs. */
function resolveParams(recipe, given = {}) {
  const out = {};
  const missing = [];
  for (const p of recipe.params || []) {
    const v = given[p.name] == null || given[p.name] === '' ? p.default : given[p.name];   // left empty: the default
    if (v === undefined || v === '') missing.push(p.name); else out[p.name] = String(v);
  }
  if (missing.length) throw Object.assign(new Error(`The recipe needs: ${missing.map(n => `${n} (${recipe.params.find(p => p.name === n).description || 'no description'})`).join(', ')}.`), { status: 400 });
  return out;
}

/**
 * @param {object} recipe
 * @param {{ params?: object, person?: object, client?: object, parentId?: string, signal?: AbortSignal, emit?: Function }} o
 * @returns {Promise<{ ok, recipe, revision, sessionId, steps: Array<{n, tool, ok, why?, result}>, failedAt? }>}
 */
async function run(recipe, { params = {}, person = null, client = null, parentId = null, signal, emit = () => {} } = {}) {
  const values = resolveParams(recipe, params);
  const memory = require('../harness/memory');
  const tools = require('../harness/tools');
  const { disabledFor } = require('../harness/turn/prompt');
  const { runToolCalls } = require('../harness/turn/tool-calls');
  const lifecycle = require('../harness/turn/lifecycle');
  const session = memory.createSession(`Recipe · ${recipe.title}`.slice(0, 120), { activate: false, parentId });
  if (person?.id) require('../harness/session-access').claim(person, session.id);
  const ctrl = new AbortController();
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  await lifecycle.claim(session.id, ctrl);
  const who = client ? { ...client, user: person || client.user } : { name: 'Recipe', kind: 'recipe', user: person };
  const out = { ok: true, recipe: recipe.id, revision: recipe.revision, sessionId: session.id, steps: [] };
  try {
    memory.append(session.id, { role: 'user', content: `Run the recipe "${recipe.title}" (revision ${recipe.revision})`
      + `${Object.keys(values).length ? ` with ${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}.`, from: who.name });
    for (const [i, step] of recipe.steps.entries()) {
      const args = fill(step.args, values, { shellQuote: step.tool === 'shell' });
      const tc = { id: `rcp_${crypto.randomBytes(4).toString('hex')}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(args) } };
      memory.append(session.id, { role: 'assistant', content: step.note || '', tool_calls: [tc] });
      const p = require('../harness/agent').params();
      const stepDisabled = disabledFor(null, p, session.id);
      await runToolCalls({ reply: { tool_calls: [tc] }, schemas: tools.schemas(stepDisabled), stepDisabled, session, signal: ctrl.signal,
        client: who, profile: null, isMission: false, step: i + 1, say: emit, announced: new Set() });
      const result = String(memory.messages(session.id).filter(r => r.role === 'tool').pop()?.content || '');
      const verdict = passed(result, step.check);
      out.steps.push({ n: i + 1, tool: step.tool, ok: verdict.ok, ...(verdict.why ? { why: verdict.why } : {}), result: result.slice(0, 600) });
      emit({ type: 'recipe_step', n: i + 1, of: recipe.steps.length, tool: step.tool, ok: verdict.ok, why: verdict.why });
      if (!verdict.ok) { out.ok = false; out.failedAt = i + 1; break; }
    }
    const end = out.ok ? `Recipe done: ${out.steps.length} step${out.steps.length === 1 ? '' : 's'}, every check passed.`
      : `Recipe stopped at step ${out.failedAt} (${recipe.steps[out.failedAt - 1].tool}): ${out.steps.at(-1).why}.`;
    memory.append(session.id, { role: 'assistant', content: end });
    out.summary = end;
    return out;
  } finally {
    if (lifecycle.running.get(session.id) === ctrl) lifecycle.running.delete(session.id);
  }
}

module.exports = { run, fill, passed, resolveParams };
