'use strict';

/**
 * The `service` tool: an API service the owner set up (api-services/, Field → Connectors → API services), used by its
 * actions rather than by hand-built requests. Never looser than api_call, which it sends through: the key is added by
 * the hub for the service's own origin only (the agent names the service, never an address or a key), redirects are
 * checked hop by hop, answers are scrubbed of the key and framed as the service's words (untrusted.js). It cannot add,
 * change or point a service anywhere — that is a person's Save; service_draft prepares one.
 */
const { clip } = require('./common');

function line(p) {
  const bits = [p.type, p.required ? 'required' : null, p.enum ? `one of ${p.enum.join(' | ')}` : null, p.default !== undefined ? `default ${p.default}` : null].filter(Boolean).join(', ');
  return `  - ${p.name}${p.in ? ` (${p.in})` : ''}${p.file ? ' — a file: give a path or an attachment\'s name in files' : ''}: ${bits}${p.description ? ` — ${p.description}` : ''}`;
}

function describe(def, only) {
  const acts = def.actions.filter(a => !only || a.name === only);
  if (only && !acts.length) return `Error: ${def.name} has no action "${only}". It has: ${def.actions.map(a => a.name).join(', ') || 'none'}.`;
  const out = [`${def.title || def.name} (${def.name}) at ${def.server}${def.note ? ` — ${def.note}` : ''}${def.docs ? `. Docs: ${def.docs}` : ''}.`];
  if (!def.actions.length) out.push('No actions are set up: an admin adds them (Field → Connectors → API services), or use api_call with key: "' + def.name + '".');
  for (const a of acts) {
    out.push(`\n${a.name}: ${a.method} ${a.path}${a.summary ? ` — ${a.summary}` : ''}${a.job ? ` [a long job: the hub follows it with ${a.job.poll.operation} every ${a.job.every} s and keeps the result]` : ''}`);
    for (const p of a.params || []) out.push(line(p));
    if (a.body) {
      out.push(`  body (${a.body.kind}${a.body.required ? ', required' : ''})${a.body.free ? ': any JSON object — pass it as params.body' : ':'}`);
      for (const f of a.body.fields || []) out.push(line(f).replace(/^ {2}/, '    '));
    }
  }
  return out.join('\n');
}

async function call(def, args, ctx) {
  const a = def.actions.find(x => x.name === args.operation);
  if (!a) return `Error: ${def.name} has no action "${args.operation || ''}". It has: ${def.actions.map(x => x.name).join(', ') || 'none — use api_call with its key'}.`;
  const jobs = require('../../api-services/jobs');
  const sessionId = ctx.sessionId || null;
  let rec;
  if (args.follow) {
    if (!a.job) return `Error: ${a.name} is not a long job; follow is for an action marked as one.`;
    rec = jobs.start(def, a, { remote: args.follow, sessionId, user: ctx.user, saveAs: args.save_as });
  } else {
    const res = await require('../../api-services/call').send(def, a, { params: args.params, files: args.files, ctx });
    if (res.error) return res.error;
    const head = `HTTP ${res.status} ${res.statusText}`;
    if (!a.job || !res.ok) return clip(`${head}\n\n${res.text}`);
    try { rec = jobs.start(def, a, { answer: res.json, sessionId, user: ctx.user, saveAs: args.save_as }); }
    catch (e) { return clip(`${head} — but ${e.message}, so nothing is followed:\n\n${res.text}`); }
  }
  const wait = Math.min(60, Math.max(0, Number(args.wait ?? 30)));
  const ended = await jobs.wait(rec.id, wait * 1000);
  if (ended) return jobs.sentence(ended);
  return `Submitted: job ${rec.id} (its id at ${def.name}: ${rec.remote}). The hub asks after it every ${a.job.every} s and keeps the result as an attachment; `
    + 'this conversation is told when it ends, so do not poll it yourself. Say it is on its way and carry on.';
}

module.exports = [
  {
    name: 'service',
    description: 'Use an API service the owner set up, by its named actions — list the services, describe one\'s actions, or call an action '
      + 'with its parameters and files. The hub adds the key (only for that service\'s address; you never see it), follows a long '
      + 'job (a 3D model, a video, a song) in the background without your steps, keeps the result files as attachments and '
      + 'tells this conversation when it ends. Prefer it to api_call for a service listed here.',
    parameters: {
      type: 'object',
      properties: {
        action:    { type: 'string', enum: ['list', 'describe', 'call'], description: 'list (default), describe a service\'s actions, or call one.' },
        service:   { type: 'string', description: 'The service\'s name, e.g. "hi3d".' },
        operation: { type: 'string', description: 'For describe (optional) and call: the action\'s name, e.g. "submitTask".' },
        params:    { type: 'object', description: 'The action\'s parameters and body fields, name → value (describe lists them).' },
        files:     { type: 'object', description: 'File fields of an upload, field → a path or an attachment\'s name, e.g. {"images": "chair.png"}.' },
        save_as:   { type: 'string', description: 'For a long job: the name to keep its result under (the extension comes from the file).' },
        wait:      { type: 'number', description: 'For a long job: seconds to wait for it here before going on (0–60, default 30); after that the hub tells you.' },
        follow:    { type: 'string', description: 'Take up a job the service already has, by its id there (after a restart): the hub follows it as if just submitted.' },
      },
    },
    run: async (args = {}, ctx = {}) => {
      const store = require('../../api-services/store');
      const allot = require('../../auth/allot');
      const action = args.action || (args.operation ? 'call' : args.service ? 'describe' : 'list');
      if (action === 'list') {
        const ss = store.list();
        if (!ss.length) return 'No API services are set up. An admin adds one in Field → Connectors → API services; service_draft prepares one for them.';
        return ss.map(s => `${s.name} — ${s.title !== s.name ? `${s.title}: ` : ''}${s.note || s.origin}. Actions: ${s.actions.map(a => `${a.name}${a.job ? ' (long job)' : ''}`).join(', ') || 'none (api_call with its key)'}`
          + `${s.needsKey ? ' — its key is not pasted yet' : allot.uses(ctx.user, 'key', s.name) || s.auth.type === 'none' ? '' : ' — not allotted to this person'}`).join('\n');
      }
      const def = store.get(args.service);
      if (!def) return `Error: no service "${args.service || ''}". Services: ${store.list().map(s => s.name).join(', ') || 'none'}.`;
      if (action === 'describe') return clip(describe(def, args.operation));
      if (action !== 'call') return 'Error: action is list, describe or call.';
      return call(def, args, ctx);
    },
  },
];
