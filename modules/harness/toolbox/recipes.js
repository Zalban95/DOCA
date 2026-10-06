'use strict';

/**
 * The `recipe` tool (modules/recipes; TODO H3.2–H3.3): keep what worked so it runs again without the thinking,
 * and run what was kept. A run is model-less and goes through the same gate as your own calls, in a
 * conversation of its own; its result is the summary and which step stopped it, if one did.
 */
module.exports = [
  {
    name: 'recipe',
    // Saved recipes are no longer listed here (a list in a description broke the cached prefix on every save and hid
    // them at the end of a long text): the readings name the ones matching the request (turn/fits.js).
    description: 'Recipes: run a saved sequence of tool calls again without reasoning through it, or save one — what you got working '
      + 'once, as steps with {parameters} and checks, so next time is one call. save_last keeps your last turn\'s tool calls '
      + 'that worked (lift the values that vary with params [{name, value, description}]); save takes explicit steps '
      + '[{tool, args, check?: {contains|matches}}]; run executes one with params, through the same approvals as your own '
      + 'calls, and stops at the first failed check (then read its conversation, repair the steps and save a new revision '
      + 'with the same id). propose offers a repaired revision for a person to accept instead of saving it (what a repair after a '
      + 'failed run does). In shell steps write {name} bare: the value is quoted for you. list and show read them; the ones '
      + 'matching a request are listed under "Likely fits" in the readings.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'show', 'run', 'save', 'save_last', 'propose'] },
        why: { type: 'string', description: 'propose: what changed, and what the repair does.' },
        id: { type: 'string', description: 'show / run: the recipe; save: an existing id to revise it.' },
        title: { type: 'string', description: 'save / save_last: a short name.' },
        description: { type: 'string', description: 'save / save_last: when to reach for it, in a sentence or two.' },
        params: { type: 'array', items: { type: 'object' }, description: 'save: [{name, description, default?}]; save_last: [{name, value, description}] — each literal value becomes {name}.' },
        steps: { type: 'array', items: { type: 'object' }, description: 'save: [{tool, args, check?, note?}].' },
        values: { type: 'object', description: 'run: the parameters, {name: value}.' },
      },
      required: ['action'],
    },
    run: async ({ action, id, title, description, params, steps, values, why }, ctx = {}) => {
      const store = require('../../recipes/store');
      const line = r => `- ${r.id} (r${r.revision}, ${r.steps.length} steps${r.params.length ? `; params ${r.params.map(p => p.name).join(', ')}` : ''}): ${r.title}${r.description ? ` — ${r.description}` : ''}`;
      if (action === 'list') { const l = store.list(); return l.length ? l.map(line).join('\n') : 'No recipes yet. save_last keeps what your last turn did.'; }
      if (action === 'show') { const r = store.get(id); return r ? JSON.stringify(r, null, 2) : `Error: no recipe "${id}".`; }
      if (action === 'save' || action === 'save_last') {
        const lifted = action === 'save_last' ? store.fromTurn(ctx.sessionId, { params: Array.isArray(params) ? params : [] }) : null;
        const r = store.save({ id, title, description, params: lifted ? lifted.params : params, steps: lifted ? lifted.steps : steps,
          by: ctx.user?.id || null, from: ctx.sessionId ? { sessionId: ctx.sessionId } : undefined });
        return `Saved recipe ${r.id} revision ${r.revision}:\n${line(r)}\n${r.steps.map((s, i) => `  ${i + 1}. ${s.tool} ${JSON.stringify(s.args).slice(0, 160)}`).join('\n')}`;
      }
      if (action === 'propose') {
        const r = store.propose({ id, title, description, params, steps, why });
        return `Proposed revision ${r.revision} of ${r.id}; a person accepts or discards it in Harness → Recipes. Runs keep the current revision until then.`;
      }
      if (action === 'run') {
        const r = store.get(id);
        if (!r) return `Error: no recipe "${id}". ${store.list().length ? `Saved: ${store.list().map(x => x.id).join(', ')}.` : ''}`;
        const out = await require('../../recipes/run').run(r, { params: values || {}, person: ctx.user || null, parentId: ctx.sessionId || null, signal: ctx.signal });
        return `${out.summary} (conversation ${out.sessionId})\n${out.steps.map(s => `  ${s.n}. ${s.tool}: ${s.ok ? 'ok' : `FAILED — ${s.why}`}`).join('\n')}`
          + (out.ok ? '' : `\nRead that conversation for the full result, repair the steps, and save revision ${r.revision + 1} with id "${r.id}".`);
      }
      return 'Error: action is list, show, run, save or save_last.';
    },
  },
];
