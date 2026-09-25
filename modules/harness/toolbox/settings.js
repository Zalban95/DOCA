'use strict';

/**
 * Settings and installs: read them, and propose changes the user applies.
 */

const installs = require('../installs');
const settings = require('../settings');
const { clip } = require('./common');

const approval = require('../approval');
/** Who did it and through what: the owner was not asked, so the log is what remains. */
const audit = (ctx, action, id) => { try { require('../../auth/store').audit({ actorId: null, via: ctx.sessionId, action, detail: id }); } catch {} };

module.exports = [
  {
    name: 'settings_read',
    description: 'Read this panel\'s settings — every one you are allowed to suggest a change to, with its '
      + 'current value. Do this before proposing anything, so you change what is actually set rather than what '
      + 'you assumed.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional substring to match against the setting paths, e.g. "paths" or "harness".' },
      },
    },
    run: ({ filter }) => {
      const q    = String(filter || '').toLowerCase();
      const rows = settings.readable().filter(r => !q || r.path.toLowerCase().includes(q));
      if (!rows.length) return `No settings match "${filter}".`;
      const body = rows.map(r =>
        `${r.path} = ${JSON.stringify(r.value)}${r.detail ? `   # ${r.detail}` : ''}`).join('\n');
      return clip(`${rows.length} settings you may propose changes to:\n${body}`);
    },
  },
  {
    name: 'settings_propose',
    description: 'Suggest a settings change. This does NOT apply it: the user sees the old and new values and '
      + 'accepts or declines. Put every key of one coherent change in a single call, give a one-line reason, '
      + 'then stop and let them answer — do not poll, repeat, or apply it another way.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why, in one line, in the user\'s terms.' },
        changes: {
          type: 'array',
          description: 'The keys to change, as dotted settings paths from settings_read.',
          items: {
            type: 'object',
            properties: {
              path:  { type: 'string', description: 'Dotted settings path, e.g. "paths.WORKSPACE_DIR".' },
              value: { description: 'The value to set. Same type as the current one.' },
            },
            required: ['path', 'value'],
          },
        },
      },
      required: ['reason', 'changes'],
    },
    run: ({ reason, changes }, ctx = {}) => {
      // Filed against the conversation that asked, so the card can be read
      // beside the transcript it came from. `propose()` always took a
      // sessionId; nothing passed one, so every proposal was anonymous and
      // several open conversations made the pending list ambiguous.
      const p = settings.propose({ changes, reason, sessionId: ctx.sessionId });
      // Unattended mode (approval.js): the owner chose not to be asked.
      if (approval.isUnattended()) {
        settings.apply(p.id);
        audit(ctx, 'unattended: settings applied', p.id);
        return `Applied at once — unattended mode is on, so nobody was asked:\n${p.changes.map(c => `  ${c.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('\n')}`;
      }
      const lines = p.changes.map(c => `  ${c.path}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
      return `Proposed (${p.id}) — waiting for the user to accept or decline:\n${lines.join('\n')}\n`
        + 'Tell them what you proposed and why, then stop.';
    },
  },
  {
    name: 'install_propose',
    description: 'Ask the user to install something this panel already knows how to install: an Ollama model '
      + '(kind "ollama-model", id is the model name), one of its inference services (kind "service", id is '
      + 'whisper / kokoro / vllm / sdwebui / comfyui), or an agent harness (kind "harness"). This does NOT '
      + 'install it — the user sees what it is and clicks, and the panel then runs its own installer with the '
      + 'right image, ports and flags. Use it instead of stopping at "I cannot do that": when the thing in your '
      + 'way is a missing tool, say which one and offer to fetch it. Do not install anything with `shell` '
      + 'instead — a hand-written docker run gets the GPU flags and cache mounts wrong and leaves something that '
      + 'looks installed and is not. Propose once, say what you proposed, then carry on without it.',
    parameters: {
      type: 'object',
      properties: {
        kind:   { type: 'string', enum: ['ollama-model', 'service', 'harness'], description: 'What sort of thing.' },
        id:     { type: 'string', description: 'Which one, e.g. "qwen2.5vl:7b" or "comfyui".' },
        reason: { type: 'string', description: 'Why, in one line, in the user\'s terms.' },
      },
      required: ['kind', 'id', 'reason'],
    },
    run: async ({ kind, id, reason }, ctx = {}) => {
      // Filed against the conversation that asked — see settings_propose.
      const row = installs.propose({ kind, id, reason, sessionId: ctx.sessionId });
      if (row.status !== 'pending') return `Already ${row.status}: ${row.kind} "${row.target}".`;
      if (approval.isUnattended()) {
        audit(ctx, 'unattended: install applied', row.id);
        const done = await installs.apply(row.id);
        return `Installed at once — unattended mode is on, so nobody was asked: ${row.what}\n${JSON.stringify(done).slice(0, 2000)}`;
      }
      return `Proposed (${row.id}) — waiting for the user to accept or decline:\n  ${row.what}\n`
        + (row.needsPassword ? '  (its installer needs sudo, so the user types their password, not you)\n' : '')
        + 'Tell them what you proposed and why, then carry on without it.';
    },
  },
];
