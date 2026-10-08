'use strict';

/**
 * An approval asked while a call is open on its conversation is said into the call and answered by voice
 * (harness/call-answer.js; the owner, 2026-10-08). The device is still asked on its screen as before
 * (approval.askAnywhere → reach.ask): whichever answer comes first wins, and the other is withdrawn.
 *
 *   attach({sessionId, model, log, person}) → { take(request), off() }
 *
 * `take` is offered each request the call hands on (the pipeline's every utterance, or a realtime model's `doca` call):
 * a plain yes or no to the question waiting is the answer — it returns the sentence that confirms it — and anything
 * else returns null and goes on as a message, with the question still open. The call log keeps that a question was
 * asked (the tool's name) and how it was answered by voice; never the words.
 */
const callAnswer = require('../harness/call-answer');

function attach({ sessionId, model, log, person }) {
  let open = null;   // { id, tool }
  const events = require('../harness/turn/lifecycle').events;
  const hear = e => {
    if (e.sessionId !== sessionId || e.type !== 'approval') return;
    if (e.state === 'asked' && e.id) {
      open = { id: e.id, tool: e.tool };
      log.note(`asked in the call: may ${e.tool} run? (a yes or a no is the answer)`);
      const q = e.spoken || callAnswer.sentence(e.tool, {});
      model.say(model.literal ? q : `Ask the person, in these words, and wait for their answer: ${q}`);
    } else if (e.state === 'answered' && open?.id === e.id) open = null;
  };
  events.on('event', hear);
  return {
    take(request) {
      if (!open) return null;
      let r;
      try { r = callAnswer.answer({ id: open.id, text: request, person }); } catch (e) { log.note(`a spoken answer was not taken: ${e.message}`, 'warn'); return null; }
      if (!r.decision) { if (r.gone) open = null; return null; }
      log.note(`answered by voice: ${r.decision === 'once' ? 'allowed once' : 'denied'} (${open.tool})`);
      open = null;
      return r.reply;
    },
    off() { events.off('event', hear); },
  };
}

module.exports = { attach };
