'use strict';

/**
 * What happens once the panel is listening, whichever server it came up as.
 *
 * Here and not in createApp(): requiring the app must never spawn somebody's
 * child processes or publish to their devices, which is what the tests do.
 */
function afterListen({ certs = null, mode } = {}) {
  require('./agents/missions').recover();            // specialists a restart cut off: paused
  require('./harness/workview').recover();            // work chats likewise, told to the devices
  require('./harness/supervisor').recover();          // and carried on: a restart is not a decision
  require('./mcp/registry').startWithDoca();          // MCP servers marked "start with DOCA"
  require('./canvas/origin').start({ certs, mode });  // agent-written pages, on their own origin
  require('./backup/schedule').start();               // backups on a schedule, when switched on
  const devices = require('./api-v1/devices');         // audit 2026-09-26 §4f, N5: tidy the device registry
  devices.repairNames();
  require('./api-v1/bus').collectOrphans(devices.list().map(d => d.id));
}

module.exports = { afterListen };
