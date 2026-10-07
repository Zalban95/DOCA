'use strict';

/**
 * What happens once the panel is listening, whichever server it came up as.
 *
 * Here and not in createApp(): requiring the app must never spawn somebody's
 * child processes or publish to their devices, which is what the tests do.
 */
function afterListen({ certs = null, mode } = {}) {
  require('./agents/carry-on').carryOn(require('./agents/missions').recover());   // specialists a restart cut off: carried on (V10)
  require('./harness/workview').recover();            // work chats likewise, told to the devices
  require('./harness/supervisor').recover();          // and carried on: a restart is not a decision
  require('./harness/runs').recoverJobs();            // a device's command job that was running did not survive it
  require('./mcp/registry').startWithDoca();          // MCP servers marked "start with DOCA"
  require('./canvas/origin').start({ certs, mode });  // agent-written pages, on their own origin
  require('./backup/schedule').start();               // backups on a schedule, when switched on
  require('./computers/lifecycle').start();           // agents' computers nobody kept, tidied away
  require('./channels/telegram').start().catch(() => {});   // the Telegram bot, when a host switched it on
  require('./channels/matrix').start().catch(() => {});     // the Matrix bot account, likewise
  require('./channels/slack').start().catch(() => {});      // and the Slack app
  require('./channels/mail').start().catch(() => {});       // and the mailbox
  require('./schedules').start();                     // turns and recipes on a timetable, as their person
  require('./scout').start();                         // the model scout, when switched on (an experiment)
  require('./harness/trace').prune(); setInterval(() => require('./harness/trace').prune(), 86400000).unref();   // traces past tracing.retainDays
  const devices = require('./api-v1/devices');         // audit 2026-09-26 §4f, N5: tidy the device registry
  devices.repairNames();
  require('./api-v1/bus').collectOrphans(devices.list().map(d => d.id));
}

module.exports = { afterListen };
