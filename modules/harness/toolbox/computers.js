'use strict';

/**
 * The `computer` tool: make, list, stop, start and remove computers — Linux desktops in containers
 * (modules/computers) — for missions to work in. Held by the Orchestrator and work chats; a specialist
 * never makes one (agents/registry NEVER), it is given one (agent_dispatch computer:).
 */
module.exports = [
  {
    name: 'computer',
    description: 'Computers for missions: a Linux desktop in a container, with a shell, files, a screen, a real Chromium '
      + 'and screen recording — a real environment where a risky thing can be tried, a site used as a person would, or a demo '
      + 'recorded, without touching this machine. create returns an id; pass it as computer: to agent_dispatch (the tester is '
      + 'made for this). list shows them; stop keeps its files, remove deletes it with its files. A person can watch or take '
      + 'over through the VNC link the list gives.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'start', 'stop', 'remove'] },
        id: { type: 'string', description: 'start / stop / remove: the computer.' },
        name: { type: 'string', description: 'create: a short name, e.g. "test-install".' },
        purpose: { type: 'string', description: 'create: what it is for, in a line.' },
      },
      required: ['action'],
    },
    run: async ({ action, id, name, purpose }, ctx = {}) => {
      const computers = require('../../computers');
      const line = c => `- ${c.id} "${c.name}" ${c.state || ''}${c.purpose ? ` — ${c.purpose}` : ''}; tools ${c.tools}; watch: ${c.vnc.url} (password ${c.vnc.password})`;
      if (action === 'list') { const l = await computers.list(); return l.length ? l.map(line).join('\n') : 'No computers. create makes one.'; }
      if (action === 'create') {
        const c = await computers.create({ name, purpose, by: ctx.sessionId || null });
        return `Computer ${c.id} "${c.name}" is up. Send a specialist to it with agent_dispatch { agent: "tester", computer: "${c.id}", task: … }.\n${line(c)}`;
      }
      if (!id) return 'Error: say which computer (id).';
      if (action === 'start') return `Started.\n${line(await computers.start(id))}`;
      if (action === 'stop') { await computers.stop(id); return `Stopped ${id}; its files stay until it is removed.`; }
      if (action === 'remove') { await computers.remove(id); return `Removed ${id} and its files.`; }
      return 'Error: action is list, create, start, stop or remove.';
    },
  },
];
