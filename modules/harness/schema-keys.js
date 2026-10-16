'use strict';

/**
 * The harness section's declared leaves (settings-schema.js `harness.keys`), kept beside the harness's code so the
 * schema stays under its line ceiling.
 */
module.exports = {
  // Never proposed: how long a person is given to answer for a mission's use of a machine (harness/mission-asks.js).
  'approval.missionAskSec': { type: 'integer', min: 10, max: 900, default: 300, propose: false,
    hint: 'Seconds a mission\'s question to use a machine (a VNC screen, a sign-in on its computer) is pressed on its person\'s devices; then it is held or denied (missionAskTimeout).' },
  // Never proposed: what Manual asks (harness/approval-matters.js). A safety switch — guarded by the password with the
  // mode (auth/guarded.js). A new install asks what matters; an install from before keeps everything (migration 2.331-manual-asks).
  'approval.manualAsks': { type: 'string', oneOf: ['everything', 'what-matters'], default: 'what-matters', propose: false,
    hint: 'What Manual approval asks about: everything that does something, or only what matters — what cannot be undone or leaves this machine (sending data out, posting, mail, pushing, paying, deleting outside a project, a command it cannot read).' },
  // Never proposed either: what an unanswered machine question becomes — hold (it stays open, the mission waits) or deny.
  'approval.missionAskTimeout': { type: 'string', oneOf: ['hold', 'deny'], default: 'hold', propose: false,
    hint: 'When nobody answers a mission\'s machine question in time: hold — the question stays open in Harness → Approvals and the mission waits, paused, until someone answers — or deny.' },
};
