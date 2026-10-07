'use strict';

/**
 * The hub's own commands for the agent (TODO B6b; audit 2026-10-06 aw 5, coh F9): the registry a phone sends commands
 * from (api-v1/commands.js) — start or stop an inference service, a container, the stack, a llama.cpp server; enable a
 * skill; take a snapshot. Before it, "start whisper" became a hand-written docker run through shell. A command the
 * registry marks confirm is always put to a person (harness/forced-asks.js), in every mode, never "always". Restarting
 * the panel is left out: the turn asking would be waiting on itself.
 */
const LEFT_OUT = new Set(['panel.restart']);

module.exports = [
  {
    name: 'hub_command',
    description: 'Run one of the hub\'s own commands — start or stop an inference service, a container, the stack or a llama.cpp '
      + 'server, enable a skill, take a snapshot — use it instead of shell for these. list shows each with its parameters and '
      + 'whether a person is asked first (confirm). A long one returns a job; system_status shows what it started. An MCP server is not one of these: mcp_connect starts and stops those.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'run'] },
        id: { type: 'string', description: 'run: the command, e.g. services.start, docker.container.restart, snapshots.create.' },
        params: { type: 'object', description: 'run: its parameters, as list shows them (e.g. {"id": "whisper"}).' },
      },
      required: ['action'],
    },
    run: async ({ action, id, params }) => {
      const commands = require('../../api-v1/commands');
      if (action === 'list')
        return commands.ids().filter(x => !LEFT_OUT.has(x)).map(x => { const d = commands.describe(x);
          return `- ${x}: ${d.title}${Object.keys(d.params || {}).length ? ` (${Object.keys(d.params).join(', ')})` : ''}${d.confirm ? ' — a person is asked' : ''}${d.longRunning ? ' — runs as a job' : ''}`; }).join('\n');
      if (action !== 'run') return 'Error: action is list or run.';
      if (!id || LEFT_OUT.has(id)) return `Error: ${id ? `${id} is a person's, from the panel` : 'say which command (id); list shows them'}.`;
      try {
        const r = await commands.execute(id, params || {}, 'agent');
        return r.kind === 'job' ? `Started ${id} as job ${r.job.id}: ${r.job.status}. Check on it with system_status, or ask again later.`
          : `${id}: done${r.result ? ` — ${JSON.stringify(r.result).slice(0, 600)}` : ''}`;
      } catch (e) { return `Error: ${e.message}`; }
    },
  },
];
