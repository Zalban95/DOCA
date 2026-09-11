'use strict';

/**
 * Scope vocabulary and matching.
 *
 * A scope is `<family>:<target>`. `target` may be `*`. A device holding the
 * bare `*` scope holds everything. Matching is prefix-aware for dotted
 * targets: `read:system.*` grants `read:system.cpu`.
 */
const FAMILIES = {
  read:      'Read snapshots and receive push updates for a surface',
  command:   'Invoke a command (and confirm prompt outcomes that run it)',
  interact:  'Receive prompts, select choices, confirm/back, send messages',
  profile:   'Read/write device profiles (self or *)',
  vars:      'Write own variables document (self) or read any (*)',
  sensors:   'Report sensor samples (report) or read them (*)',
  media:     'Upload media (upload) or read any media (*)',
  artifacts: 'Read artifacts delivered to this device',
  mcp:       'Read/update the MCP server this device itself hosts (self)',
  devices:   'Device administration: pair, list, revoke, rotate (admin)',
  agent:     'Agent-facing API: raise prompts/alerts, request sensors, deliver outcomes and artifacts',
};

/** Scopes that are a bare family with no target (e.g. `interact`). */
const BARE = new Set(['interact', 'agent']);

function normalize(scope) {
  const s = String(scope || '').trim();
  if (!s) return null;
  if (s === '*') return s;
  const [family, target] = s.split(':');
  if (!FAMILIES[family]) return null;
  if (BARE.has(family)) return family;
  return `${family}:${target || '*'}`;
}

function normalizeAll(list) {
  const out = new Set();
  for (const s of Array.isArray(list) ? list : []) {
    const n = normalize(s);
    if (n) out.add(n);
  }
  return [...out];
}

/** True if `granted` (one scope string) satisfies `needed`. */
function matches(granted, needed) {
  if (granted === '*' || granted === needed) return true;
  const [gf, gt] = granted.split(':');
  const [nf, nt] = needed.split(':');
  if (gf !== nf) return false;
  if (gt === undefined || nt === undefined) return gt === nt;
  if (gt === '*') return true;
  if (gt.endsWith('.*')) return nt.startsWith(gt.slice(0, -1));
  return false;
}

function hasScope(scopes, needed) {
  const n = normalize(needed);
  if (!n) return false;
  return (scopes || []).some(g => matches(g, n));
}

/** Filter a list of ids to those the scopes admit under `family`. */
function filterByScope(scopes, family, ids) {
  return ids.filter(id => hasScope(scopes, `${family}:${id}`));
}

/** Preset bundles used by the CLI and pairing UI. */
const PRESETS = {
  admin:    ['*'],
  agent:    ['agent', 'read:*', 'artifacts:*', 'media:*', 'sensors:*', 'vars:*', 'profile:*'],
  watch:    ['read:*', 'interact', 'profile:self', 'vars:self', 'sensors:report', 'media:upload', 'artifacts:self'],
  // `mcp:self` is in `phone` because that is the preset a desktop client pairs
  // with, and it is self-limiting by construction: it reaches only the one
  // definition a human already pointed at this device. A device hosting nothing
  // can do nothing with it.
  phone:    ['read:*', 'command:*', 'interact', 'profile:*', 'vars:self', 'sensors:report', 'media:upload', 'artifacts:self', 'devices:admin', 'mcp:self'],
  viewer:   ['read:*'],
};

module.exports = { FAMILIES, PRESETS, normalize, normalizeAll, hasScope, filterByScope, matches };
