'use strict';

/**
 * What changed in an agent type's tools since its last turn.
 *
 * Kits make a new tool reach every agent type that holds its kit; this makes
 * the agent *told*. The catalogue each type was last shown is kept (names, and
 * a fingerprint of each description); when a release adds, removes or rewrites
 * a tool, the next turn of that type carries one short notice in its readings.
 * The first turn a type ever takes carries none — its "Your tools" section
 * already lists everything.
 *
 * Kept in `<DATA_DIR>/harness/tool-catalogue.json`, by type: "orchestrator",
 * "work", "specialist:<id>".
 */
const crypto = require('crypto');
const store = require('../../store');

const fp = s => crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 10);

/** The key an agent type's catalogue is kept under. */
function typeOf(session, profile) {
  if (profile?.level === 'orchestrator') return 'orchestrator';
  if (profile?.id && session?.kind === 'specialist') return `specialist:${profile.id}`;
  return session?.kind || 'work';
}

/**
 * The notice for this turn ('' when nothing changed), recording what was shown.
 * @param {string} type  from typeOf()
 * @param {Array<{function:{name, description}}>} schemas  what the turn is offered
 */
function news(type, schemas) {
  const doc = store.readJson('harness/tool-catalogue', { types: {} });
  const now = Object.fromEntries(schemas.map(s => [s.function.name, fp(s.function.description)]));
  const before = doc.types[type]?.tools;
  doc.types[type] = { tools: now, at: new Date().toISOString() };
  store.writeJson('harness/tool-catalogue', doc);
  if (!before) return '';
  const added = Object.keys(now).filter(n => !(n in before));
  const removed = Object.keys(before).filter(n => !(n in now));
  const changed = Object.keys(now).filter(n => n in before && before[n] !== now[n]);
  if (!added.length && !removed.length && !changed.length) return '';
  return ['# Your tools changed since your last turn',
    added.length ? `New: ${added.join(', ')} — described under "Your tools".` : '',
    changed.length ? `Changed (read their description again): ${changed.join(', ')}.` : '',
    removed.length ? `Gone: ${removed.join(', ')}. If your memory says to use them, correct it (memory_search the name).` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { news, typeOf };
