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
  // Mastermind and worker (turn/model-route.js): which model plans and reviews, and which carries out the steps. Empty is
  // the harness's model for every step, as before. Not proposable: the harness's own model is (harness.config), but a
  // second model a turn may call is a question for the owner (D1's open question).
  'models.mastermind': { type: 'string', default: '', propose: false,
    hint: 'provider/model that plans, routes, re-plans and reviews: every step of the Orchestrator, and in a work chat or a chat the first step, the step after a plan changes or a step is marked done (the review and the final answer), and the step after a call fails. Empty: the harness\'s model. A person\'s choice of model in a chat wins; only a model allotted to the person is used.' },
  'models.worker': { type: 'string', default: '', propose: false,
    hint: 'provider/model that carries out the steps: in a work chat or a chat every step that follows tool results, and every step of a specialist whose definition names no model. Empty: the harness\'s model.' },
};
