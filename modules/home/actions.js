'use strict';

/**
 * What the Home page may ask Home Assistant to do: a short list of services per kind of thing, each with the data it
 * may carry — kept once beside doca-client (clients/node/home-shared.js), so a home node refuses exactly what the hub
 * does. Home Assistant can do far more (restart itself, run any service of any integration); those stay in HA and
 * with the agent's Home Assistant MCP server, under the agent's own approvals. One entity per call, one that is on the
 * page of that home (index.js source) and that the person may use (allot `home`). A lock's unlock and an alarm's
 * disarm ask for the password at the gate (auth/guarded.js `guardedCall`).
 */
const home = require('./index');

const { ALLOW, GUARDED, guardedCall, checkCall } = require('../../clients/node/home-shared');

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Checks a request against a home ({has}) and returns what to send HA, or throws with the reason. */
function check(person, body = {}, src = home.source(body.home)) {
  const msg = checkCall(body);
  const { domain } = msg, id = msg.target.entity_id;
  if (!src.has(id)) throw bad(`Home Assistant has no ${id}${src.kind === 'node' ? ` in ${src.home}` : ''}.`, 404);
  // A script runs whatever its author wrote into it (a door, a heater, a mail): an admin's to run from here.
  if (domain === 'script' && person?.id && !require('../auth/rights').can(person.role, 'host'))
    throw bad(`Running a Home Assistant script is an admin's from here: a script can do anything its author put in it.`, 403);
  if (!home.allowed(person, id, src.home)) throw bad(`${id} is not allotted to ${person?.name || 'this person'} — an admin gives it in Settings → Users (the level's Home).`, 403);
  return msg;
}

/** Does it: HA's own answer to call_service, which the state change that follows draws on every page. */
async function call(person, body) {
  const src = home.source(body?.home);
  await src.ready();   // the states are read once connected
  const msg = check(person, body, src);
  await src.send(msg);   // a node checks the list again itself
  return { ok: true, home: src.home, entity_id: msg.target.entity_id, service: `${msg.domain}.${msg.service}` };
}

module.exports = { ALLOW, GUARDED, guardedCall, check, call };
