'use strict';

/**
 * Live surface fan-out. On every sampler tick, each connected device whose
 * profile names surfaces receives one ephemeral `surface.update` event per
 * surface, throttled to the profile's `refreshSec`. Devices without a live
 * stream get nothing (they poll snapshots instead).
 */
const sampler  = require('./sampler');
const bus      = require('./bus');
const devices  = require('./devices');
const profiles = require('./profiles');
const surfaces = require('./surfaces');
const prompts  = require('./prompts');
const { hasScope } = require('./scopes');

const _lastPush = new Map();
let _wired = false;

async function pushFor(device) {
  const profile = profiles.effective(profiles.get(device.id), device.scopes);
  const now = Date.now();
  if (now - (_lastPush.get(device.id) || 0) < (profile.refreshSec || 10) * 1000 - 250) return;
  const ids = profiles.surfaceIds(profile).filter(id => hasScope(device.scopes, `read:${id}`));
  if (!ids.length) return;
  _lastPush.set(device.id, now);
  const wantSpark = profile.pages.some(pg => pg.surfaces.some(s => s.spark));
  const { surfaces: snap } = await surfaces.snapshot(ids, { spark: wantSpark, maxAgeSec: 5, extra: { openPrompts: prompts.openFor(device).length, llamacppInstances: safeLlama() } });
  for (const s of snap) {
    try { bus.publish(device.id, 'surface.update', { surface: s }); }
    catch (e) { if (e.code === 'event_too_large') bus.publish(device.id, 'surface.update', { surface: { ...s, items: (s.items || []).slice(0, 10), truncated: (s.items || []).length } }); }
  }
}

function safeLlama() {
  try { return require('../models-llamacpp').loadInstances(); } catch { return []; }
}

function wire() {
  if (_wired) return;
  _wired = true;
  sampler.emitter.on('sample', () => {
    for (const d of devices.list()) {
      if (d.revokedAt || !bus.isOnline(d.id)) continue;
      pushFor(devices.get(d.id)).catch(() => {});
    }
  });
}

/** Called when a device opens a stream: declare sampling demand at its refresh rate. */
function onConnect(device) {
  const profile = profiles.get(device.id);
  sampler.demand(profile.refreshSec || 10);
}

function _reset() { _lastPush.clear(); }

module.exports = { wire, onConnect, pushFor, _reset };
