'use strict';

/**
 * The `computer` tool: make, list, stop, start and remove computers — Linux desktops in containers
 * (modules/computers) — for missions to work in. Held by the Orchestrator and work chats; a specialist
 * never makes one (agents/registry NEVER), it is given one (agent_dispatch computer:).
 */
module.exports = [
  {
    name: 'computer',
    description: 'Make a computer whenever the work needs a real environment: testing something risky, using a site as a person '
      + 'would, building or running what should not touch this machine, or recording a demo. A computer is a Linux desktop in a '
      + 'container with a shell, files, a screen, a real Chromium and screen recording. create returns an id: its tools '
      + '(mcp__computer-<id>__*) are yours from your next step, or pass it as computer: to agent_dispatch (the tester is made for '
      + 'this). It stops by itself a few minutes after the mission it was lent to ends, and one you made is removed some days after '
      + 'it stopped unless a person pins it; stop it yourself when you are done with it. list shows them; stop keeps its files, '
      + 'remove deletes it with its files. put copies an attachment into its work folder (attachment, path); get keeps a file '
      + 'from it as an attachment (path), to show or send on. A person watches or takes over from the Computers tab; while '
      + 'they drive, your mouse, keys and browser clicks wait.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'start', 'stop', 'remove', 'put', 'get'] },
        attachment: { type: 'string', description: 'put: the attachment\'s name.' },
        path: { type: 'string', description: 'put: where in its work folder (default: the attachment\'s name); get: the file, relative to the work folder or absolute.' },
        id: { type: 'string', description: 'start / stop / remove: the computer.' },
        name: { type: 'string', description: 'create: a short name, e.g. "test-install".' },
        purpose: { type: 'string', description: 'create: what it is for, in a line.' },
      },
      required: ['action'],
    },
    run: async ({ action, id, name, purpose, attachment, path }, ctx = {}) => {
      const computers = require('../../computers');
      const line = c => `- ${c.id} "${c.name}" ${c.state || ''}${c.pinned ? ' pinned' : ''}${c.purpose ? ` — ${c.purpose}` : ''}; tools ${c.tools}`;
      if (action === 'list') { const l = await computers.list(); return l.length ? l.map(line).join('\n') : 'No computers. create makes one.'; }
      if (action === 'create') {
        const c = await computers.create({ name, purpose, by: ctx.sessionId || null, auto: true });
        return `Computer ${c.id} "${c.name}" is up. Its tools (mcp__computer-${c.id}__*) are yours from your next step; or send a specialist with agent_dispatch { agent: "tester", computer: "${c.id}", task: … }.\n${line(c)}`;
      }
      if (!id) return 'Error: say which computer (id).';
      if (action === 'start') return `Started.\n${line(await computers.start(id))}`;
      if (action === 'stop') { await computers.stop(id); return `Stopped ${id}; its files stay until it is removed.`; }
      if (action === 'remove') { await computers.remove(id); return `Removed ${id} and its files.`; }
      if (action === 'put') { const r = await computers.put(id, attachment, path); return `Copied into ${id} at ${r.path} (${r.bytes} bytes).`; }
      if (action === 'get') { const a = await computers.fetchFile(id, path); return `Kept as an attachment: ${a.path} (${a.bytes} bytes) — show it with show_media or read it.`; }
      return 'Error: action is list, create, start, stop, remove, put or get.';
    },
  },
];
