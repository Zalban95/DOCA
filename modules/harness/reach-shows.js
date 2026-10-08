'use strict';

/**
 * Which devices can show a notice or a question to a person (deep test B, 2026-10-08). Holding `interact` says a
 * device may be sent one, not that anybody will see it: a reminder "fired" on a doca-client, which lends tools and
 * draws nothing, and the record said "Reminded on desk-client" while the person, at the panel, saw nothing.
 *
 * What shows one: a linked chat (the channel posts it), and a client with a screen that draws `alert` and
 * `prompt.new` — DocaMobile, DocaWear, DocaDesk. What does not: a signed-in browser record (the panel's own notices
 * reach it instead, modules/notices), an agent, a device that says it is headless, and doca-client, whose event loop
 * acts only on `device.control` (clients/node/doca-client.js). Decided: doca-client is not offered as a target rather
 * than taught to print a notice to its log — a log nobody reads is not a person being told.
 */

/** Why `d` cannot show a notice or a question, or null when it can. */
function whyNot(d) {
  if (!d) return 'no such device';
  if (d.kind === 'channel') return null;
  if (d.kind === 'browser') return 'a signed-in browser: its notices come on the panel';
  if (d.kind === 'agent') return 'an agent, not a person\'s screen';
  if (d.caps?.ext?.client === 'doca-client') return 'a doca-client: it lends tools and shows no notices';
  if (d.caps?.formFactor === 'headless') return 'headless: it has no screen';
  return null;
}

const shows = d => !whyNot(d);

/** One line naming the devices that cannot show it and why, for a record or a tool's answer. */
function explain(list) {
  return list.map(d => `${d.name} (${whyNot(d) || 'it may not be sent one: no "interact" scope'})`).join(', ');
}

module.exports = { shows, whyNot, explain };
