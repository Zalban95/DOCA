'use strict';

/**
 * machine_fit: what this machine can bear, and what to set up for a need (guided/, TODO P1.5). It only reads — the
 * machine, the project's suggested models, the providers' key state — and says how each part is set up: a local
 * model or service is an install_propose (a click installs it), a role the machine cannot bear is a provider key the
 * person pastes in Settings → Set-up. The skill guided-setup says when to use it.
 */
const { clip } = require('./common');

function render(p, a) {
  const out = [`Machine: ${a.machine.summary}`, `Shape: ${p.shape === 'local' ? 'local — it can run its own agent model' : 'preset — the agent\'s model has to come from a provider (a key)'}.`,
    p.askRoute ? 'Real choice for the person: run models here where they fit, or use providers for everything (ask once).' : 'No local choice: what is needed comes from providers.'];
  for (const s of p.steps) {
    if (s.type === 'install') out.push(`- install: install_propose {kind: "${s.kind}", id: "${s.id}"} — ${s.label}: ${s.why}${s.error ? ` (cannot: ${s.error})` : ''}`);
    else out.push(`- key for ${s.label} (${s.why}): ${s.providers.length ? s.providers.map(x => `${x.label}${x.hasKey ? ' (key already here)' : x.keyPage ? ` — key at ${x.keyPage}` : ''}`).join('; ') : s.note || 'no provider serves it yet'}`);
  }
  for (const d of p.devices) out.push(`- device ${d.label}: ${d.how}`);
  out.push(`Suggestions list v${a.suggestions.version} (${a.suggestions.source}, ${a.suggestions.updated}). Keys are pasted and tested in Settings → Set-up (link: /#settings/guided) or Field → API keys — never in the chat.`);
  return out.join('\n');
}

module.exports = [
  {
    name: 'machine_fit',
    description: 'What this machine can run and what to set up for a need: the suggested models that fit it, or providers where none does. '
      + 'It reads memory, graphics cards and disk, picks the newest suggested model per role (chat, coding, vision, embeddings, speech) that fits, '
      + 'and lists the providers to choose from where nothing fits. It reads only; installing is install_propose '
      + '(the person clicks), keys are pasted in Settings → Set-up. Use it when someone asks to be set up for something, or asks what this machine can run.',
    parameters: { type: 'object', properties: {
      uses: { type: 'array', items: { type: 'string', enum: ['talk', 'code', 'voice', 'see', 'find', 'home'] },
        description: 'What the person wants: talk (everyday help), code, voice (talk aloud), see (pictures, screens), find (by meaning), home. Default talk.' },
      route: { type: 'string', enum: ['local', 'providers'], description: 'local: run here where it fits (default); providers: hosted models for everything.' },
    } },
    run: async ({ uses, route } = {}) => {
      const { assess } = require('../../guided/assess');
      const doc = require('../../guided/suggestions').load();
      const machine = await assess();
      const p = require('../../guided/plan').plan({ uses, route }, machine, doc);
      return clip(render(p, { machine, suggestions: require('../../guided/suggestions').about() }), 5000);
    },
  },
];
