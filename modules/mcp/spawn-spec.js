'use strict';

/**
 * How a stdio MCP server's command is started, per OS (hive.md §7). On Windows most servers are `npx …`
 * or `uvx …`, and `npx` there is `npx.cmd`: Node refuses to spawn a .cmd or .bat without a shell (EINVAL
 * since the 2024 security releases), so every such server failed to start on a Windows host. A batch file
 * is run through cmd.exe with its arguments quoted for cmd; anything else is spawned as it is.
 */
const quote = a => (/^[\w.:/\\@=+,-]+$/.test(String(a)) ? String(a) : `"${String(a).replace(/"/g, '""')}"`);

function spawnSpec(command, args = [], { platform = process.platform, which = require('../shell').which } = {}) {
  if (platform !== 'win32') return { file: command, args, opts: {} };
  const found = /[\\/]/.test(command) ? command : which(command) || command;
  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args, opts: {} };
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[found, ...args].map(quote).join(' ')}"`],
    opts: { windowsVerbatimArguments: true } };
}

module.exports = { spawnSpec };
