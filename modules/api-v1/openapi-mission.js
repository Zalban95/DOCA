'use strict';

/**
 * The `agent.mission` event's schema (PROTOCOL §11.4), moved out of openapi.js, which may only shrink
 * (test/structure.test.js). `h` is openapi.js's schema helpers. Specialists' missions (agents/missions.js announce)
 * and work chats (harness/workview.js payloadOf) both send it; test/workview.test.js holds every field they send to
 * a property here.
 */
module.exports = ({ str, int, bool, arr, obj, iso, nullable }) => (
  { audience: 'device', payload: obj({
        missionId: str(), agentId: str(), label: str({ description: 'The specialist\'s name.' }),
        kind: str({ enum: ['work'], description: '`work` for a work chat (the Orchestrator\'s, `agentId: work`, `missionId` its conversation); absent for a specialist\'s mission. A work chat a person stopped or dropped is `cancelled` with why in `error`.' }), task: str({ description: 'What it was asked to do, truncated.' }),
        state: str({ enum: ['running', 'paused', 'done', 'failed', 'cancelled'] }), steps: int(), tokens: int(), startedAt: iso(), endedAt: nullable(iso()),
        result: str({ description: 'On `done`: the beginning of what it reported.' }), error: str(),
        plan: arr(obj({ title: str(), state: str({ enum: ['done', 'running', 'queued', 'failed'] }) }), { description: 'The specialist\'s own checklist, at most 12 items; absent when it made none.' }),
        progress: obj({ done: int(), total: int(), percent: int() }, { description: 'Counted from `plan`; absent without one — draw from `steps` then.' }),
        archivedAt: iso('The mission was put away: take its row off the list. Always sent with `quiet: true`.'),
        seenAt: iso('Its person opened the finished result (hub 2.282; read means done): clear its notice, keep it as finished. Sent with `quiet: true`.'),
        quiet: bool({ description: 'Present and true: update what you show, raise no notification, no haptic. Set when the owner is reading the panel right now, and always when a mission is put away.' }), }), note: 'A specialist agent\'s work, to every device with `harness:chat`. Starting and finishing are durable, so a watch that was asleep still learns the job is done; the step ticks in between are ephemeral, because progress replayed from an hour-old queue is not progress. `GET /harness/missions` is the same picture for a client that has just woken up.' }
);
