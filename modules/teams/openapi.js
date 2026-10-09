'use strict';

/**
 * The `agent.team` event's schema (PROTOCOL §11.4), beside the module that sends it (teams/announce.js `payload`):
 * openapi.js may only shrink, so it takes this as `...require('../teams/openapi').events(h)`.
 */
function events({ str, int, bool, arr, obj, iso }) {
  const task = obj({
    id: str(), title: str(), agent: str({ description: 'The specialist\'s id, or `work` for a work chat.' }),
    state: str({ enum: ['queued', 'waiting', 'running', 'paused', 'checking', 'done', 'failed', 'stopped'] }),
    percent: int({ description: 'Running: steps used of its budget (at most 99). Done: 100, only once its contract holds. Otherwise 0.' }),
    step: int(), budget: int({ description: 'The specialist\'s step budget; with `step`, "step 12 of 30".' }),
    after: arr(str(), { description: 'Ids of the tasks it waits for.' }), waitingOn: arr(str(), { description: 'Those of `after` not done yet.' }),
    missionId: str({ description: 'Its mission, also announced as `agent.mission` (with `team`).' }),
    why: str({ description: 'Why it failed or stopped, or what its contract check found.' }), doneWhen: str({ description: 'Its contract, in a sentence.' }),
  });
  return {
    'agent.team': { audience: 'device', payload: obj({
      teamId: str(), title: str(), goal: str(), state: str({ enum: ['running', 'done', 'failed', 'stopped'] }),
      progress: obj({ done: int(), total: int(), percent: int() }, { description: 'Tasks done of tasks, every task weighing the same — say so where it is drawn.' }),
      keepGoing: obj({ on: bool(), rounds: int(), maxRounds: int() }, { description: 'Whether a failed task is tried again, and how many of its rounds are used.' }),
      tasks: arr(task, { description: 'At most 12, in the order the team lists them.' }),
      notes: int({ description: 'How many findings the teammates posted (read them in the document).' }),
      doc: obj({ name: str(), kind: str({ enum: ['doc'] }), mime: str(), url: str({ description: 'Fetch with the device token; open it as a document (a watch skips it).' }) }),
      startedAt: iso(), endedAt: iso(), archivedAt: iso('The team was put away: take its row off. Sent with `quiet: true`.'),
      quiet: bool({ description: 'Update what you show, raise no notification (as on `agent.mission`).' }),
    }), note: 'A team of specialists on one board (hub teams/): to every device with `harness:chat` whose person may open the conversation that leads it. Durable when a task changes state or the team ends; ephemeral when only a percentage moved. Every field is worked out by the hub from missions and contracts — no agent writes it.' },
  };
}

module.exports = { events };
