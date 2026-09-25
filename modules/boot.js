'use strict';

/**
 * What happens once the panel is listening, whichever server it came up as.
 *
 * Here and not in createApp(): requiring the app must never spawn somebody's
 * child processes or publish to their devices, which is what the tests do.
 */
function afterListen() {
  require('./agents/missions').recover();            // specialists a restart cut off: paused
  require('./harness/workview').recover();            // work chats likewise, told to the devices
  require('./mcp/registry').startWithDoca();          // MCP servers marked "start with DOCA"
}

module.exports = { afterListen };
