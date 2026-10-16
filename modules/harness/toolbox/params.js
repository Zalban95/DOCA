'use strict';

/**
 * project_params: a project's parameters for the agent (parametric projects, phase 1) — the same file, checks and
 * build as the mask (modules/params). `show` and `status` read; `set` changes values only when the person asked for
 * exactly that on their own turn (`asked: true`, CONSTITUTION S1 — otherwise the values and the mask are named for them
 * to decide); `build` runs the declared build at once as the person the conversation is for, when they may work on the
 * project (owner, 2026-10-16: someone with the right to build who asks for it gets it; a build that changed since they
 * last ran it is said in one line). Not in approval.FREE: it reads and writes a project's files, like read_file.
 */
const access = () => require('../../projects/access');

function pick(a, ctx) {
  const projects = require('../../projects/store');
  const person = access().personOfCtx(ctx);
  const p = a.id ? access().need(person, a.id) : projects.forSession(ctx.sessionId);
  if (!p) throw new Error('This conversation is not in a project: give an id (project list).');
  return { p: access().need(person, p.id), person };
}

const fmt = v => (typeof v === 'string' ? JSON.stringify(v) : String(v));

function show(p) {
  const file = require('../../params/file');
  const f = file.read(p.root);
  if (!f.exists) return `${p.name} has no ${file.NAME}. A job that builds deliverables declares every value a person might change there (format 1: params with type, default, min, max, unit, group; build: stages naming recipes), and its scripts and templates read it.`;
  if (!f.doc) return f.errors.join(' ');
  const v = file.view(f.doc);
  const lines = v.params.map(x => `${x.name} = ${fmt(x.value)}${x.unit ? ` ${x.unit}` : ''}${x.changed ? '' : ' (default)'}${x.min != null || x.max != null ? ` [${x.min ?? ''}…${x.max ?? ''}]` : ''}${x.lock ? ' locked' : ''}`);
  return [`${v.title || p.name} — ${file.NAME}${f.errors.length ? ` (problems: ${f.errors.join(' ')})` : ''}`, ...lines,
    `Build: ${(f.doc.build || []).map(s => `${s.id} (${s.recipe})`).join(' → ') || 'none declared'}.`, status(p)].join('\n');
}

function status(p) {
  const s = require('../../params/build').status(p);
  if (s.running) return `Building now: stage ${s.running.done + 1} of ${s.running.of} (${s.running.stage || 'starting'}).`;
  const failed = s.stages.find(x => !x.ok);
  return `${s.built.ok ? 'Built from the current values' : `Not built from the current values: ${s.built.why}`}.`
    + (failed ? ` The last build stopped at ${failed.id}: ${failed.why}.` : '');
}

module.exports = [
  {
    name: 'project_params',
    description: 'Read and change a project\'s parameters (project.params.json: every value a person might change, with its range), and rebuild its deliverables from them with no model. '
      + 'show: the values, their ranges and the build; status: whether the deliverables are built from the current values; '
      + 'set: new values ({values: {name: value}}) — only with asked: true when the person asked for exactly these values, else tell them the values and Projects → Parameters; '
      + 'build: run the declared build now (it takes minutes for renders; status follows it). The mask, the build and the checks are the same ones the person uses.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'status', 'set', 'build'] },
        id: { type: 'string', description: 'A project id; default: this conversation\'s project.' },
        values: { type: 'object', description: 'For set: {name: value}, each of its declared type and range.' },
        asked: { type: 'boolean', description: 'For set: the person asked for exactly these values.' },
        build: { type: 'boolean', description: 'For set: rebuild after saving (default true).' },
      },
      required: ['action'],
    },
    run: async (a, ctx = {}) => {
      const { p, person } = pick(a, ctx);
      switch (a.action) {
        case 'show': return show(p);
        case 'status': return status(p);
        case 'set': {
          if (!(a.asked === true && ctx.byPerson)) return 'Not set: values change when the person asks for exactly them, on their own turn (asked: true). Tell them what you would set and that Projects → Parameters saves it with one click.';
          if (!access().mayWork(person, p)) return `Not set: ${p.name} is shared with this person to see, not to work on.`;
          const r = await require('../../params/save').save(p, { values: a.values || {}, person, client: { name: 'Build', kind: 'recipe', user: person }, byAgent: true, build: a.build !== false, say: true });
          if (!r.changes.length) return `Nothing changed: those are the values already.${r.build ? ' Building, since the deliverables were not from them.' : ''}`;
          return `Saved ${r.changes.map(c => `${c.name} ${fmt(c.from)} → ${fmt(c.to)}`).join(', ')}${r.commit ? ` (commit ${r.commit})` : ''}.`
            + `${r.build ? ` Building now (${r.build.of} stage(s)); project_params status follows it.${r.build.note ? ` ${r.build.note}` : ''}` : ''}`;
        }
        case 'build': {
          if (!access().mayWork(person, p)) return `Not built: ${p.name} is shared with this person to see, not to work on.`;
          const st = require('../../params/build').start(p, { person, client: { name: 'Build', kind: 'recipe', user: person }, say: true });
          return `Building ${p.name}: ${st.of} stage(s), with no model; project_params status follows it.${st.note ? ` ${st.note}` : ''}`;
        }
        default: throw new Error('Unknown project_params action.');
      }
    },
  },
];
