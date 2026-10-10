'use strict';

/**
 * Five minutes before a meeting, its people are told on their own devices and pages — as their calendar would, and
 * also for a calendar DOCA could not write to. Once per person per meeting (`reminded_at`); a meeting moved later is
 * reminded again at its new time. A tick every 30 s, started with the hub (boot.afterListen); one activity line per
 * meeting reminded (CONSTITUTION §1: what the hub does on its own is a line).
 */
const store = require('./store');

let timer = null;
const lead = () => { try { return Number(require('../settings-schema').value('meetings.remindMin')) || 5; } catch { return 5; } };

async function tick(now = Date.now()) {
  const min = lead();
  if (min <= 0) return [];
  const due = await store.startingBetween(new Date(now - 60000).toISOString(), new Date(now + min * 60000).toISOString());
  const done = [];
  for (const m of due) {
    const people = (await store.people(m.id)).filter(p => p.personId && !(p.remindedAt && p.remindedAt >= m.updatedAt));
    if (!people.length) continue;
    const invite = require('./invite'), notice = require('../harness/reach-notice');
    for (const p of people) {
      const mins = Math.max(0, Math.round((Date.parse(m.startsAt) - now) / 60000));
      try {
        notice.deliver({ personId: p.personId, title: mins ? `In ${mins} min: ${m.title}` : `Now: ${m.title}`, text: `Join: ${invite.link(m)}`,
          to: notice.ownIds(p.personId), urgent: true, panel: 'always', from: 'meetings',
          meeting: { id: m.id, link: invite.link(m), title: m.title, by: '' } });
      } catch { /* told as far as it could be */ }
      await store.patchPerson(m.id, p.who, { remindedAt: new Date(now).toISOString() });
    }
    require('../activity').note({ from: 'meetings', what: `reminded ${people.length} ${people.length === 1 ? 'person' : 'people'} of "${m.title}"`, why: `it starts at ${m.startsAt}` });
    done.push(m.id);
  }
  return done;
}

function start() {
  if (timer) return;
  timer = setInterval(() => tick().catch(e => console.warn(`[meetings] reminders: ${e.message}`)), 30000);
  timer.unref?.();
}
function stop() { clearInterval(timer); timer = null; }

module.exports = { tick, start, stop };
