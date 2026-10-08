'use strict';

// Reading iCalendar (modules/calendar): samples shaped like Google's secret-address export, an iCloud public
// calendar and an Outlook published calendar (Windows zone names), plus the recurrences people use — weekly across a
// change to summer time, the last Friday, the 31st, Thanksgiving, an exception moved, a date taken out.

require('./helpers');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ics = require('../modules/calendar/ics');
const zones = require('../modules/calendar/zones');

const sample = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'ics', `${name}.ics`), 'utf8');
const OCT = Date.parse('2026-10-01T00:00:00Z'), JAN = Date.parse('2027-01-01T00:00:00Z');
const cal = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

test('Google\'s export: a weekly event keeps its 09:00 across the change to winter time; EXDATE, a moved instance, cancelled, escapes', () => {
  const parsed = ics.parse(sample('google'));
  assert.equal(parsed.name, 'Family');
  assert.equal(parsed.zone, 'Europe/Rome');
  const ev = ics.events(sample('google'), OCT, Date.parse('2026-11-01T00:00:00Z'));
  const standups = ev.filter(e => e.title === 'Stand-up').map(e => e.start);
  assert.deepEqual(standups.slice(0, 4), ['2026-10-05T07:00:00.000Z', '2026-10-14T07:00:00.000Z', '2026-10-19T07:00:00.000Z', '2026-10-21T07:00:00.000Z'],
    'the 7th is excepted, the 12th moved');
  assert.ok(standups.includes('2026-10-26T08:00:00.000Z'), 'after 25 October 09:00 in Rome is 08:00 UTC');
  const moved = ev.find(e => e.title === 'Stand-up (moved)');
  assert.equal(moved.start, '2026-10-12T09:00:00.000Z');
  assert.ok(!ev.some(e => e.start === '2026-10-12T07:00:00.000Z'), 'the original of a moved instance is gone');
  assert.ok(!ev.some(e => e.title === 'Called off'), 'a cancelled event is left out');
  const first = ev.find(e => e.title === 'Stand-up');
  assert.equal(first.where, 'Kitchen, upstairs');
  assert.equal(first.description, 'Daily sync, short.\nBring notes.');
  const bday = ev.find(e => e.title === 'Granny\'s birthday');
  assert.deepEqual([bday.start, bday.end, bday.allDay], ['2026-10-08', '2026-10-09', true]);
  const next = ics.events(sample('google'), Date.parse('2027-10-01T00:00:00Z'), Date.parse('2027-10-31T00:00:00Z'));
  assert.ok(next.some(e => e.title === 'Granny\'s birthday' && e.start === '2027-10-08'), 'a yearly all-day event comes back');
});

test('iCloud\'s calendar: a folded line, the last Friday of the month four times, a quoted parameter, a weekend', () => {
  const ev = ics.events(sample('icloud'), OCT, JAN);
  const club = ev.filter(e => e.title.startsWith('Book club'));
  assert.equal(club[0].title, 'Book club — last Friday of the month with a long title that is folded over two lines');
  assert.deepEqual(club.map(e => e.start), ['2026-10-30T18:00:00.000Z', '2026-11-27T18:00:00.000Z', '2026-12-25T18:00:00.000Z'],
    'COUNT=4 counts September\'s too; London is on GMT from 25 October');
  assert.equal(club[0].where, 'The Pub; Main St');
  const away = ev.find(e => e.title === 'Weekend away');
  assert.deepEqual([away.start, away.end], ['2026-10-10', '2026-10-13']);
  assert.ok(ics.events(sample('icloud'), Date.parse('2026-10-11T12:00:00Z'), Date.parse('2026-10-11T13:00:00Z')).some(e => e.title === 'Weekend away'), 'a day in the middle overlaps');
});

test('Outlook\'s published calendar: Windows zone names, UNTIL inclusive, a custom zone by its own offset', () => {
  assert.equal(zones.resolve('W. Europe Standard Time'), 'Europe/Berlin');
  assert.equal(zones.resolve('/mozilla.org/20050126_1/Europe/Rome'), 'Europe/Rome');
  assert.equal(zones.resolve('Nowhere Standard Time'), null);
  const ev = ics.events(sample('outlook'), OCT, JAN);
  const gym = ev.filter(e => e.title === 'Gym').map(e => e.start);
  assert.equal(gym.length, 8, 'weekdays from Wednesday the 21st through Friday the 30th');
  assert.equal(gym[0], '2026-10-21T06:00:00.000Z');
  assert.equal(gym.at(-1), '2026-10-30T07:00:00.000Z', 'UNTIL is inclusive, and the zone moved to winter time');
  assert.ok(!gym.includes('2026-10-24T06:00:00.000Z'), 'no Saturday');
  const call = ev.find(e => e.title === 'Call with Pune');
  assert.deepEqual([call.start, call.end], ['2026-10-08T11:30:00.000Z', '2026-10-08T12:15:00.000Z'], 'the VTIMEZONE\'s +0530, DURATION PT45M');
});

test('recurrences people use: the 31st, every other week, Thanksgiving, a floating time in the calendar\'s zone, daily COUNT', () => {
  const one = (rule, start = 'DTSTART:20260131T100000Z', extra = '') => ics.events(cal(`BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:x\r\n${start}\r\nDURATION:PT1H\r\nRRULE:${rule}\r\n${extra}END:VEVENT`),
    Date.parse('2026-01-01T00:00:00Z'), Date.parse('2027-01-01T00:00:00Z')).map(e => e.start.slice(0, 10));
  assert.deepEqual(one('FREQ=MONTHLY;COUNT=4'), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'], 'months without a 31st are skipped');
  assert.deepEqual(one('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5', 'DTSTART:20260106T100000Z'), ['2026-01-06', '2026-01-08', '2026-01-20', '2026-01-22', '2026-02-03']);
  assert.deepEqual(one('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', 'DTSTART;VALUE=DATE:20251127'), ['2026-11-26']);
  assert.deepEqual(one('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3'), ['2026-01-31', '2026-02-28', '2026-03-31'], 'the last day of each month');
  assert.deepEqual(one('FREQ=DAILY;COUNT=3', 'DTSTART:20261231T230000Z'), ['2026-12-31'], 'the other two fall in 2027, outside the range');
  assert.deepEqual(one('FREQ=DAILY;COUNT=3', 'DTSTART:20260101T080000Z', 'EXDATE:20260102T080000Z\r\n'), ['2026-01-01', '2026-01-03']);
  assert.deepEqual(one('FREQ=HOURLY;COUNT=3', 'DTSTART:20260101T080000Z'), ['2026-01-01'], 'a rule not read shows its first occurrence');
  const floating = ics.events(`BEGIN:VCALENDAR\r\nX-WR-TIMEZONE:America/New_York\r\nBEGIN:VEVENT\r\nUID:f\r\nSUMMARY:f\r\nDTSTART:20260708T090000\r\nDTEND:20260708T100000\r\nEND:VEVENT\r\nEND:VCALENDAR`,
    Date.parse('2026-07-01T00:00:00Z'), Date.parse('2026-08-01T00:00:00Z'));
  assert.equal(floating[0].start, '2026-07-08T13:00:00.000Z', 'a floating time is read in the calendar\'s zone');
});

test('broken input does not throw: no calendar, lines without a value, a DTSTART that is not a date', () => {
  assert.deepEqual(ics.events('', OCT, JAN), []);
  assert.deepEqual(ics.events('not a calendar at all', OCT, JAN), []);
  assert.deepEqual(ics.events(cal('BEGIN:VEVENT\r\nSUMMARY\r\nDTSTART:tomorrow\r\nEND:VEVENT'), OCT, JAN), []);
  assert.equal(ics.duration('P1DT2H'), 26 * 3600000);
  assert.equal(ics.duration('nonsense'), null);
});
