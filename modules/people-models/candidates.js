'use strict';

/**
 * The models a person or a level could be assigned (the Users card's one picker, the people_models tool): the models
 * this hub already names — the harness's model and its fallbacks, its escalation, the mastermind and worker, assistant
 * mode's, every model a level lists by name, and every model already assigned — each kept only when allot.js allots it
 * to whom it is for. Read from settings, never asked of a provider over the network, so the card opens at once; a
 * model named nowhere yet is typed ("Other model…" in the card, or by name to the agent).
 */
const parse = v => require('../harness/turn/model-route').parse(v);
const key = e => `${e.provider}/${e.model}`;

function named() {
  const out = new Map();
  const add = e => { if (e?.provider && e?.model) out.set(key(e), { provider: e.provider, model: e.model }); };
  const sc = require('../settings-schema');
  const v = path => { try { return sc.value(path); } catch { return null; } };
  try { require('../harness/turn/choice').order(require('../harness/turn/params').params()).forEach(add); } catch { /* no harness model yet */ }
  const esc = v('harness.config.doca.escalateTo');
  add(typeof esc === 'string' ? parse(esc) : esc);
  add(parse(v('harness.models.mastermind'))); add(parse(v('harness.models.worker')));
  if (v('assistant.model')) add({ provider: v('assistant.provider') || require('../harness/turn/params').params().provider, model: v('assistant.model') });
  for (const l of require('../auth/levels').list()) for (const m of l.resources?.model || []) if (!String(m).includes('*')) add(parse(m));
  const pol = require('./index').policy(), d = require('./assign').load();
  for (const raw of [pol.all, ...Object.values(pol.levels || {}), ...Object.values(pol.people || {}),
    ...Object.values(d.people).map(r => r.model), ...Object.values(d.levels).map(r => r.model)]) add(parse(raw));
  return [...out.values()];
}

/** The named models allotted to `forWhom` ({id, role, name} — a level as {id: 'level:<id>', role: <id>}), as strings. */
function forTarget(forWhom, list = named()) {
  const allot = require('../auth/allot');
  return list.filter(e => { try { return allot.allowsModel(forWhom, e); } catch { return false; } }).map(key).sort();
}

module.exports = { named, forTarget };
