'use strict';

/**
 * What one step sends: the system prompt, the history, and the panel's
 * readings after it. Moved out of `runTurn` unchanged.
 */

const memory = require('../memory');
const { isMissionProfile, liveBlock, systemPrompt } = require('./prompt');
const { toApiMessages } = require('./messages');
// Required lazily: modules/agents requires the harness back (see agent.js).
const missions = () => require('../../agents/missions');

/**
 * @returns {{ messages: object[], acknowledge: () => void }} — call
 *   `acknowledge()` once the provider has answered, so a notice is marked shown
 *   only when the step that carried it actually went out.
 */
function stepRequest({ p, ep, message, summary, client, profile, projectBrief, schemas, disabled, session, led, toolNews, contextSkips }) {
  const { rows: windowRows, folded } = memory.window(session.id, Number(p.historyTurns) || 0);
  // Old tool results this turn already used, shortened in what is sent once token pressure cleared them.
  const rows = require('./clear-results').view(windowRows, folded, memory.getSession(session.id)?.clearedThrough);
  const messages = [
    {
      role: 'system',
      content: systemPrompt({
        p, userText: message, summary, client, profile, projectBrief, sessionId: session.id,
        toolCount: schemas.length, disabledCount: disabled.length, disabled,
      }),
    },
    // `provider` is the one this request is addressed to, which decides which
    // echoes travel — see `toApiMessages`.
    ...toApiMessages(rows, { sessionId: session.id, provider: ep.id }),
  ];

  // The readings go last, after the history. Everything above is now
  // byte-identical from one step to the next, so the cached prefix grows with
  // the transcript instead of being cut off at the first line that moves —
  // and a per-step line inside the system prompt is exactly what did the
  // cutting (ISSUES.md H-9). Not persisted: this is this step's reading, and
  // the next step generates its own.
  // Sent as `user`, not as a second `system`. A chat template is entitled to
  // refuse a system message that is not the first one, and Qwen's does:
  // llama.cpp with `--jinja` answers `500 Jinja Exception: System message must
  // be at the beginning`, which killed every llamacpp-served turn on its first
  // step from the moment the readings moved down here (H-9). The position is
  // what H-9 was protecting, not the role, so the cached prefix is unaffected.
  // It says whose words these are, because a bare block at the end of a
  // conversation reads as the user's.
  const isMission = isMissionProfile(profile);
  const completed = isMission ? [] : missions().notices(session.id);
  const organization = require('../organization');
  const reports = organization.notices(session.id).slice(0, 10);
  const since = rows.length - [...rows].reverse().findIndex(r => r.role === 'user');   // this turn's own rows
  const fits = require('./fits').block({ message, schemas, rows: since <= rows.length ? rows.slice(since) : [], person: client?.user, sessionId: session.id, turnRow: rows[since - 1] });
  const live = [liveBlock(p, led), require('../../timezones').line(client?.user?.id), toolNews, fits, isMission ? '' : missions().block({ sessionId: session.id, completed }),
    organization.block(session.id, reports),
    ...contextSkips.values()].filter(Boolean).join('\n');
  if (live) messages.push({ role: 'user', content: `[panel readings, not from the user]\n${live}` });

  return {
    messages,
    acknowledge() {
      if (!isMission) missions().acknowledgeNotices(completed);
      organization.acknowledge(session.id, reports);
    },
  };
}

module.exports = { stepRequest };
