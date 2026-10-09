'use strict';

/**
 * What happens once the panel is listening, whichever server it came up as.
 *
 * Here and not in createApp(): requiring the app must never spawn somebody's
 * child processes or publish to their devices, which is what the tests do.
 */
function afterListen({ certs = null, mode } = {}) {
  require('./panel-running').mark({ port: require('./paths').PORT });   // the token CLI asks whether a panel reads this data folder
  require('./harness/runs').recoverTurns();           // turns the last process was running ended with it — closed first, before anything carries on
  require('./agents/carry-on').carryOn(require('./agents/missions').recover());   // specialists a restart cut off: carried on (V10)
  require('./agents/after').listen();                 // errands waiting on other missions' results start when those are done
  require('./teams').listen();                        // teams carry on: each task starts when the ones it comes after are done (teams/)
  require('./harness/workview').recover();            // work chats likewise, told to the devices
  require('./harness/supervisor').recover();          // and carried on: a restart is not a decision
  require('./harness/runs').recoverJobs();            // a device's command job that was running did not survive it
  require('./api-services/jobs').recover();           // nor did following a service's long job: said where it started
  require('./mcp/registry').startWithDoca();          // MCP servers marked "start with DOCA"
  require('./canvas/origin').start({ certs, mode });  // agent-written pages, on their own origin
  require('./backup/schedule').start();               // backups on a schedule, when switched on
  require('./computers/lifecycle').start();           // agents' computers nobody kept, tidied away
  require('./agents/tidy').start();                   // and finished missions nobody needs any more, put away in the Archive
  require('./screens/archive').start();               // and browsers nobody opened for a week (devices.browserArchiveDays)
  require('./channels/telegram').start().catch(() => {});   // the Telegram bot, when a host switched it on
  require('./channels/matrix').start().catch(() => {});     // the Matrix bot account, likewise
  require('./channels/slack').start().catch(() => {});      // and the Slack app
  require('./channels/mail').start().catch(() => {});       // and the mailbox
  for (const ch of ['telegram', 'matrix', 'slack', 'mail'])  // what came back on with DOCA, written down (activity.js)
    if (require('./settings-schema').value(`channels.${ch}.enabled`)) require('./activity').note({ from: 'channels', what: `${ch} is listening again`, why: 'a host switched it on; it resumes when DOCA starts' });
  require('./schedules').start();                     // turns and recipes on a timetable, as their person
  require('./system-one/service').autostart();        // Laya's service, when the owner asked for it at boot
  require('./library').start();                       // the Library's schedule or watched folders, when the experiment is on
  require('./scout').start();                         // the model scout, when switched on (an experiment)
  require('./network').tailnetSuffix();             // this tailnet's name, cached before an agent's first owned() asks (toolbox/http.js)
  require('./service-life').start();                  // services nothing uses, stopped when the owner asked (off by default)
  require('./update-channel').start();               // a production hive's update channel: releases checked, applied holding running work
  require('./license/checkin').start();              // the licence: checked in with its server when due, and the clock remembered
  require('./log-keep').start();                      // what is kept of what happened, to its bounds: now and daily (logs.*, tracing.*)
  const devices = require('./api-v1/devices');         // audit 2026-09-26 §4f, N5: tidy the device registry
  devices.repairNames();
  require('./api-v1/bus').collectOrphans(devices.list().map(d => d.id));
}

module.exports = { afterListen };
