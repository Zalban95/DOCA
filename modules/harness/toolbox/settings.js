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
    name: 'effort',
    description: 'Set how hard you think in this conversation when the person asks — "think harder", "take your time" (high), '
      + '"quick answers" (low), "no thinking" (off), "as usual" (default). It changes only this conversation, from the next step; '
      + 'say so in a few words.',
    parameters: { type: 'object', properties: {
      level: { type: 'string', enum: ['off', 'low', 'medium', 'high', 'default'] },
    }, required: ['level'] },
    run: ({ level }, ctx = {}) => {
      const memory = require('../memory');
      if (!ctx.sessionId || !memory.getSession(ctx.sessionId)) return 'Error: no conversation to set it for.';
      if (!['off', 'low', 'medium', 'high', 'default'].includes(level)) return 'Error: level is off, low, medium, high or default.';
      memory.updateSession(ctx.sessionId, { effort: level === 'default' ? null : level });
      return level === 'default' ? 'Thinking effort is back to the usual for this conversation.' : `Thinking effort is ${level} in this conversation from the next step.`;
    },
  },
  {
    name: 'form_fill',
    description: 'Fill fields of a form the person asked you to help with ("Help me fill …" names the form and its field ids): the values '
      + 'land in that form on their screen as a draft they review and save — nothing is saved by you. Never a password, token, key or header.',
    parameters: { type: 'object', properties: {
      form: { type: 'string', description: 'The form id from their message, e.g. form3.' },
      fields: { type: 'object', description: 'Field id → value, e.g. {"mcp-url": "http://homeassistant.local:8123/api/mcp"}.' },
    }, required: ['form', 'fields'] },
    run: ({ form, fields }, ctx = {}) => {
      if (!/^form\d{1,4}$/.test(String(form || ''))) return 'Error: form is the id from the person\'s message (form1, form2, …).';
      const SECRET = /pass|token|secret|api.?key|bearer|authori[sz]ation|header|credential|cookie/i;
      const ok = Object.fromEntries(Object.entries(fields || {}).filter(([k, v]) => !SECRET.test(k) && /^[\w.-]{1,60}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 4000) : v]));
      const refused = Object.keys(fields || {}).filter(k => !(k in ok));
      if (typeof ctx.emit !== 'function') return 'Error: this conversation has no form on a screen to fill.';
      ctx.emit({ type: 'form_fill', form, fields: ok });
      return `Filled ${Object.keys(ok).length} field(s) of ${form} as a draft; the person reviews and saves.${refused.length ? ` Not filled: ${refused.join(', ')} (secret or not a field) — tell them where it comes from.` : ''}`;
    },
  },
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
      + 'whisper / kokoro / vllm / sdwebui / comfyui), an agent harness (kind "harness"), or an MCP server from the '
      + 'panel\'s catalogue (kind "mcp": playwright — a browser you drive — or chrome-devtools), or a program from '
      + 'Settings → System → System tools (kind "tool": e.g. android-sdk, android-emulator, jdk21, dotnet, ffmpeg, tailscale, '
      + 'nvidia-ctk — each installed with its own command for this OS). This does NOT '
      + 'install it — the user sees what it is and clicks, and the panel then runs its own installer with the '
      + 'right image, ports and flags. Use it instead of stopping at "I cannot do that": when the thing in your '
      + 'way is a missing tool, say which one and offer to fetch it. Do not install anything with `shell` '
      + 'instead — a hand-written docker run gets the GPU flags and cache mounts wrong and leaves something that '
      + 'looks installed and is not. Propose once, say what you proposed, then carry on without it.',
    parameters: {
      type: 'object',
      properties: {
        kind:   { type: 'string', enum: ['ollama-model', 'service', 'harness', 'mcp', 'tool'], description: 'What sort of thing.' },
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
  {
    name: 'mcp_draft',
    description: 'Prepare an MCP server that is not in the catalogue, for a person to add: its name, how it runs (a command with its '
      + 'arguments, or an http address), the names of the secrets it needs, and which machine it belongs on. Nothing starts and nothing is '
      + 'saved as a server: the draft waits in the MCP tab, where "Open in the form" fills the add-server form for them to read, paste the '
      + 'secrets and Save. Find how the server runs first (research_docs on its own page); for one in the catalogue use install_propose.',
    parameters: { type: 'object', properties: {
      name: { type: 'string', description: 'A short name, e.g. "fusion360".' },
      transport: { type: 'string', enum: ['stdio', 'http'], description: 'stdio: a command DOCA runs; http: an address the server listens on.' },
      command: { type: 'string', description: 'For stdio: the program, e.g. npx, uvx, python.' },
      args: { type: 'array', items: { type: 'string' }, description: 'For stdio: its arguments, one per item.' },
      url: { type: 'string', description: 'For http: the address, e.g. http://localhost:8123/mcp.' },
      env: { type: 'object', description: 'Environment it needs: a secret by name with an empty value (the person fills it), a setting with its value.' },
      headers: { type: 'array', items: { type: 'string' }, description: 'For http: header names it needs (Authorization …); never their values.' },
      where: { type: 'string', description: 'Which machine it belongs on: "this hub", or a paired device by name when it drives a program there (Fusion 360 on a desktop).' },
      why: { type: 'string', description: 'One sentence: what it gives the agents.' },
      docs: { type: 'string', description: 'The page it is documented on.' },
    }, required: ['name', 'why'] },
    run: (args, ctx = {}) => {
      let d;
      try { d = require('../../mcp/drafts').draft(args || {}, { sessionId: ctx.sessionId }); } catch (e) { return `Error: ${e.message}`; }
      const secrets = [...Object.entries(d.env).filter(([, v]) => v === '').map(([k]) => k), ...d.headers];
      return `Drafted "${d.name}" (${d.transport === 'http' ? d.url : [d.command, ...d.args].join(' ')}) for ${d.where}. It waits in the MCP tab under `
        + `"Prepared by the agent": the person opens it in the form, ${secrets.length ? `fills ${secrets.join(', ')}, ` : ''}and saves — nothing runs before that. `
        + 'Tell them where it is and what to paste.';
    },
  },
  {
    name: 'service_draft',
    description: 'Prepare a web service (an API with a key) for a person to switch on in one step: how its key is sent, its address, '
      + 'what it is for, and a skill with the steps to use it. Read its documentation first (research_docs); then the draft waits in '
      + 'Settings → Connectors, the person pastes the key and saves, and from then on http_fetch with key: "<name>" reaches it. For a '
      + 'service with an MCP server use mcp_draft; for one in the catalogue, install_propose.',
    parameters: { type: 'object', properties: {
      name: { type: 'string', description: 'The key\'s short name, e.g. "hi3d" — what http_fetch names.' },
      origin: { type: 'string', description: 'The API\'s address, e.g. https://api.hitem3d.ai.' },
      place: { type: 'string', enum: ['header', 'query', 'exchange'], description: 'header (Authorization: Bearer by default), query (a parameter), or exchange (id:secret traded for a token at field).' },
      field: { type: 'string', description: 'The header or parameter name — or, for exchange, the token address.' },
      prefix: { type: 'string', description: 'Before the key in a header, e.g. "Bearer " or "" (default Bearer for Authorization).' },
      note: { type: 'string', description: 'One line: what it is for (agents read it).' },
      docs: { type: 'string', description: 'Its documentation\'s address.' },
      skill: { type: 'object', description: '{name, description, body}: the steps an agent follows to use it, in markdown — the requests, their fields, waiting for results, keeping files (save_as) and showing them.' },
    }, required: ['name', 'origin', 'note'] },
    run: (args, ctx = {}) => {
      let d;
      try { d = require('../../service-drafts').draft(args || {}, { sessionId: ctx.sessionId }); } catch (e) { return `Error: ${e.message}`; }
      return `Prepared "${d.name}" (${d.origin}, key ${d.place === 'exchange' ? 'id:secret traded for a token' : `in the ${d.place}`})${d.skill ? ` with the skill "${d.skill.name}"` : ''}. `
        + 'It waits in Settings → Connectors under "Prepared by the agent": the person pastes the key and saves. Tell them where to get the key '
        + '(the service\'s developer page) — never ask them to paste it in the chat.';
    },
  },
];
