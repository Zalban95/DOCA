'use strict';

/**
 * The declaration of prefs `work` (settings-schema.js reads it from here): how many jobs may run behind the main chat
 * at once (harness/work-cap.js; experiment alwaysFree). No limit by default — the owner's answer of 2026-10-12: "no
 * limits by default, possibility to set them; mine is just one of the possible setups". Never proposable: how much
 * runs at once is the owner's, like limits.maxStepsCeiling.
 */
module.exports = { is: 'travels', home: 'hive', note: 'how many jobs run in the background at once, per person (harness/work-cap.js; the experiment is experiments.alwaysFree)',
  keys: {
    parallel: { type: 'integer', min: 0, max: 100, default: 0, propose: false, hint: 'The most jobs (work chats with a job) one person has running at once; one more waits, shown as waiting, and starts when one ends. 0: no limit.' },
    localSlots: { type: 'boolean', default: false, propose: false, hint: 'On a model server on this machine or the network that says how many requests it serves at once (llama.cpp\'s slots), run at most one fewer job than it has slots, so the main chat always finds one free. Off: only the limit above.' },
  } };
