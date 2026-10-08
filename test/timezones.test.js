'use strict';

/**
 * Times are the person's clock, not the hub's (deep test B, C10): a reminder said "1:17 PM" to someone whose clock
 * read 15:17, and a schedule's "Daily 09:00" ran at 09:00 UTC.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const H = require('./helpers');
const zones = require('../modules/timezones');
const when = require('../modules/schedules/when');

test.before(() => H.start());
test.after(() => H.stop());

test('a wall-clock time is read on the zone given, and written with its offset', () => {
  const at = zones.parseLocal('2026-10-08T15:17', 'Europe/Rome');
  assert.equal(at.toISOString(), '2026-10-08T13:17:00.000Z');
  assert.equal(zones.iso(at, 'Europe/Rome'), '2026-10-08T15:17:00+02:00');
  assert.equal(zones.iso(at, 'America/New_York'), '2026-10-08T09:17:00-04:00');
  assert.equal(zones.parseLocal('2026-10-08T15:17Z', 'Europe/Rome').toISOString(), '2026-10-08T15:17:00.000Z', 'an offset given is kept');
  assert.equal(zones.parseLocal('2026-01-15T09:00', 'Europe/Rome').toISOString(), '2026-01-15T08:00:00.000Z', 'winter time');
  assert.equal(zones.valid('Not/AZone'), null);
});

test('a cron with a zone runs on that clock', () => {
  const from = new Date('2026-10-08T06:00:00Z');   // 08:00 in Rome
  assert.equal(when.next({ cron: '0 9 * * *', tz: 'Europe/Rome' }, from).toISOString(), '2026-10-08T07:00:00.000Z');
  assert.equal(when.next({ cron: '0 9 * * *', tz: 'Asia/Tokyo' }, from).toISOString(), '2026-10-09T00:00:00.000Z');
  // Weekdays on the zone's own calendar: Friday 23:30 in New York is Saturday in UTC.
  assert.equal(when.next({ cron: '30 23 * * 5', tz: 'America/New_York' }, new Date('2026-10-09T12:00:00Z')).toISOString(), '2026-10-10T03:30:00.000Z');
  assert.match(when.describe({ cron: '0 9 * * *', tz: 'Europe/Rome' }), /\(Europe\/Rome\)/);
});

test('a screen reports its zone; the person\'s schedules and reminders follow it', async () => {
  const r = await H.api(null, 'POST', '/api/presence', { visible: true, tz: 'Europe/Rome' });
  assert.equal(r.status, 200);
  const me = (await H.api(null, 'GET', '/api/auth/me')).body;
  const id = me.user?.id || me.id;
  assert.equal(zones.of(id), 'Europe/Rome');
  const s = await H.api(null, 'POST', '/api/schedules', { kind: 'turn', message: 'check the disk', cron: '0 8 * * *' });
  assert.equal(s.body.when.tz, 'Europe/Rome', 'the person\'s zone, with none sent');
  const t = await H.api(null, 'POST', '/api/schedules', { kind: 'turn', message: 'x', cron: '0 8 * * *', tz: 'Asia/Tokyo' });
  assert.equal(t.body.when.tz, 'Asia/Tokyo', 'the zone the panel sent');

  const remind = require('../modules/harness/toolbox/schedules').find(x => x.name === 'remind');
  const out = await remind.run({ text: 'stretch', at: '2099-10-08T18:00' }, { user: { id } });
  assert.match(out, /2099-10-08T18:00:00\+02:00/);
  assert.match(out, /Europe\/Rome/);
  if (zones.hostZone() !== 'Europe/Rome') assert.match(zones.line(id), /the person's clock: .*Europe\/Rome/);
});
