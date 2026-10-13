'use strict';

/**
 * Casts that are running, kept across a restart (R3e's other half; cast-reach.md §2.2): a TV showing a page holds it by
 * itself, but it reads that page through the hub's cast door, which a restart closes — so the page goes dead. Each page
 * cast to a thing is noted here (the thing, its address, the page; never a link's code or a session), forgotten at Stop,
 * and at start the door is opened again for those of the last day, while the owner's switch (cast.door) is on: the TV's
 * view session is in the database, so its page carries on by itself. A sound is not kept: it has played.
 */
const store = require('../store');
const DOC = 'cast-running';
const KEEP_MS = 24 * 3600e3;

const all = () => store.readJson(DOC, { casts: [] }).casts || [];
const write = casts => store.writeJson(DOC, { casts });

function note({ thing, ip, page, via = null }) {
  write([...all().filter(c => c.thing !== thing), { thing, ip, page, via, at: new Date().toISOString() }]);
}

function forget(thing) { write(all().filter(c => c.thing !== thing)); }

/** At start: the door again for the page casts of the last day the hub itself served (a relay's door is its own). */
async function restore() {
  const door = require('./door');
  const fresh = all().filter(c => Date.now() - Date.parse(c.at) < KEEP_MS);
  write(fresh);
  if (!door.on()) return 0;
  let n = 0;
  for (const c of fresh.filter(x => !x.via)) {
    try { await door.open(c.ip, { page: c.page }); n++; } catch { /* the hub has no address there now: the TV shows what it last had */ }
  }
  if (n) require('../activity').note({ from: 'cast', what: `opened the cast door again for ${n} screen${n === 1 ? '' : 's'} showing a page`, why: 'a restart closed it while they were cast to' });
  return n;
}

module.exports = { all, note, forget, restore, KEEP_MS };
