'use strict';

/**
 * The model scout's tool (modules/scout; experiment modelScout). Absent while the experiment is off; in registry.NEVER,
 * so a mission never files or reads suggestions — the scout specialist reports, its leader suggests.
 */
module.exports = [
  {
    name: 'model_scout',   // 'scout' is the airlock specialist; this is the model scout (audit 2026-10-06, coh F24)
    description: 'Find better or new models for DOCA\'s functions and suggest them for a person to accept. Actions: signals (the latest look: '
      + 'trending models per function with growth, new releases and news — outside words), roles (what each function uses now), list (what '
      + 'was suggested and decided, with reasons), suggestions (the guided set-up\'s suggested models and the pick for each size class), suggest '
      + '(file one: title, role, candidate, replaces, why, evidence, tryWith; or kind "suggested-model" with class and entry, a model for '
      + 'that list). A suggestion changes nothing: a person accepts it — into TODO to build, or a model into Set-up\'s list.',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['signals', 'roles', 'list', 'suggestions', 'suggest'] },
      kind: { type: 'string', enum: ['change', 'suggested-model'], description: 'suggest: a change to build (default), or a model for the guided set-up\'s list.' },
      class: { type: 'string', description: 'suggested-model: the size class it would be the pick for (from suggestions, e.g. gpu-16).' },
      entry: { type: 'object', description: 'suggested-model: the list entry — id, label, quant, released, rank, needs {vramGB, ramGB, diskGB}, context {native, at}, install {kind, id}, licence, toolCalling, sources [{url, checked}], alsoFor.' },
      fresh: { type: 'boolean', description: 'signals: keep this look as the baseline growth is measured from (the daily look does).' },
      title: { type: 'string' }, role: { type: 'string', description: 'A function id from roles (stt, tts, vision, …) or new.' },
      candidate: { type: 'string', description: 'The model or project, e.g. a Hugging Face id.' },
      replaces: { type: 'string', description: 'What it would replace, when it replaces something.' },
      why: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' }, description: 'Sources: model cards, benchmarks, release notes (URLs).' },
      tryWith: { type: 'string', description: 'How it would be tried in DOCA without breaking the current way: a setting, a Services or System tools row, a reader…' },
    }, required: ['action'] },
    run: async a => {
      const scout = require('../../scout'), signals = require('../../scout/signals'), roles = require('../../scout/roles');
      if (a.action === 'roles') return roles.roles().map(r => `- ${r.id}: ${r.label} — now ${r.current || 'nothing set'} (${r.where}); Hugging Face: ${r.tasks.join(', ')}`).join('\n');
      if (a.action === 'list') {
        const xs = scout.list();
        return xs.length ? xs.map(s => `${s.id} [${s.state}] ${s.title} (${s.role}${s.candidate ? `: ${s.candidate}` : ''})${s.reason ? ` — declined: ${s.reason}` : ''}`).join('\n') : 'Nothing suggested yet.';
      }
      if (a.action === 'suggestions') return require('../../scout/model-suggestion').view();
      if (a.action === 'suggest') { const s = scout.suggest(a); return `Filed ${s.id} (${s.state}). A person accepts or declines it in Settings → Harness → Scout.`; }
      const r = await signals.look({ keep: a.fresh === true });
      return signals.brief(r);
    },
  },
];
