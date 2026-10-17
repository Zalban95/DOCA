'use strict';

/**
 * A container Docker brought up by its restart policy is said so (modules/machines/started.js; audit 2026-10-17: after a
 * reboot every DOCA service read "started outside DOCA", in amber): restarted by its policy after failures, started by
 * it when the machine started, and an older line of DOCA's no longer taken for this start. The facts are set by hand,
 * never read from this machine's Docker.
 */
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

test.after(() => H.stop());

test('Docker\'s restart policy is named as who started a container, over an older line of DOCA\'s', async () => {
  await H.start();
  const started = require('../modules/machines/started'), origin = require('../modules/machines/origin');
  started._reset(); origin._reset();
  const now = Date.now(), up = 3600;   // booted an hour ago
  const iso = ms => new Date(ms).toISOString();

  started._set('doca-whisper', { startedAt: iso(now - up * 1000 + 30000), policy: 'unless-stopped', restarts: 0 });
  assert.equal(started.phrase('doca-whisper', now, up).text, 'started by Docker when this machine started (its restart policy)');

  started._set('doca-qwentts', { startedAt: iso(now - 1000), policy: 'unless-stopped', restarts: 14 });
  assert.equal(started.phrase('doca-qwentts', now, up).text, 'restarted by Docker (its restart policy, 14 times)');

  // Started long after boot, never restarted: Docker did not start it — no phrase, so the row may still say outside.
  started._set('scratch', { startedAt: iso(now - 600000), policy: 'unless-stopped', restarts: 0 });
  assert.equal(started.phrase('scratch', now, up), null);
  // No restart policy: Docker never starts it on its own.
  started._set('manual', { startedAt: iso(now - up * 1000 + 30000), policy: 'no', restarts: 0 });
  assert.equal(started.phrase('manual', now, up), null);

  // Through origin.of: a service row (doca-<id>) and a container row read Docker's part when no line says.
  assert.equal(origin.of('service', 'qwentts', { up: true }).by, 'docker');
  assert.equal(origin.of('container', 'doca-qwentts', { up: true, name: 'doca-qwentts' }).outside, false);
  // origin.of reads this machine's own uptime (a CI runner booted minutes ago): the outside case is one with no policy.
  assert.equal(origin.of('container', 'manual', { up: true, name: 'manual' }).text, 'started outside DOCA');

  // A person's start from before the container's current start is not this start; one after it still is.
  const activity = require('../modules/activity');
  activity.note({ from: 'person', what: 'started doca-qwentts', machine: { kind: 'container', id: 'doca-qwentts', name: 'doca-qwentts' }, act: 'start', ok: true });
  origin._reset();
  assert.equal(origin.of('container', 'doca-qwentts', { up: true, name: 'doca-qwentts' }).by, 'person', 'a line newer than the start wins');
  started._set('doca-qwentts', { startedAt: iso(now + 600000), policy: 'unless-stopped', restarts: 15 });
  origin._reset();
  assert.equal(origin.of('container', 'doca-qwentts', { up: true, name: 'doca-qwentts' }).by, 'docker', 'restarted by Docker after the person\'s start');
});
