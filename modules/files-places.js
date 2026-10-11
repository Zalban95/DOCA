'use strict';
/**
 * Hub → Files' shortcuts, as the platform this is (asked 2026-10-12: "align the bookmarks with our project — they were
 * created when the project was just a dashboard for OpenClaw … now it's a platform that can manage multiple
 * harnesses"). Three groups, each place only where it leads somewhere:
 *   DOCA       home, its workspace, attachments, specialists, skills, backups — its own folders (greyed "create it"
 *              until they exist, made through Paths' own route)
 *   Projects   each project's folder, newest first (the Projects page's own list; archived ones left out)
 *   Harnesses  every harness this hub has whose own folder exists: OpenClaw (with its stack and snapshots), OpenDots,
 *              and the command-line ones by their settings folder (~/.claude, ~/.codex, ~/.gemini …)
 * The product's name is the branding's; the folders' names are what is on disk.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_PROJECTS = 8;
const exists = p => { try { return !!p && fs.existsSync(p); } catch { return false; } };
const tilde = p => String(p || '').replace(/^~(?=$|[\\/])/, os.homedir());

function docaPlaces(P) {
  const name = (() => { try { return require('./branding').name('product'); } catch { return 'DOCA'; } })();
  const store = require('./store');
  return [
    { id: 'home', icon: '⌂', label: 'Home', path: os.homedir() },
    { id: 'workspace', icon: '📁', label: 'Workspace', path: P.WORKSPACE_DIR, key: 'WORKSPACE_DIR' },
    { id: 'attachments', icon: '📎', label: 'Attachments', path: P.ATTACHMENTS_DIR, key: 'ATTACHMENTS_DIR' },
    { id: 'agents', icon: '🧑‍🔧', label: 'Specialists', path: P.AGENTS_DIR, key: 'AGENTS_DIR' },
    { id: 'skills', icon: '🧩', label: `${name}'s skills`, path: path.join(store.DATA_DIR, 'skills') },
    { id: 'backups', icon: '🗄', label: 'Backups', path: P.BACKUP_DIR },
  ].map(p => ({ ...p, group: name, missing: !exists(p.path) }))
    .filter(p => !p.missing || p.key);   // a folder that is not made yet is offered only when Paths can make it
}

function projectPlaces() {
  let list = [];
  try { list = require('./projects/store').list().filter(p => !p.archivedAt && p.root); } catch { /* none */ }
  return list.slice(0, MAX_PROJECTS).filter(p => exists(p.root))
    .map(p => ({ group: 'Projects', id: `project-${p.id}`, icon: '◆', label: p.name || path.basename(p.root), path: p.root }));
}

function harnessPlaces(P) {
  const out = [];
  const add = (id, label, dir, icon = '⚙') => { if (exists(dir) && !out.some(o => o.path === dir)) out.push({ group: 'Harnesses', id, icon, label, path: dir }); };
  // OpenClaw: its own folder, then the folders of its stack and its snapshots.
  add('openclaw', 'OpenClaw', path.dirname(P.CONFIG_PATH));
  add('openclaw-stack', 'OpenClaw · stack', P.COMPOSE_DIR, '🐳');
  add('openclaw-snapshots', 'OpenClaw · snapshots', P.SNAPSHOT_DIR, '📷');
  try { add('opendots', 'OpenDots', require('./harness/opendots').settings().dir); } catch { /* not this build */ }
  // The command-line harnesses: the folder of their settings file, when it is a folder of their own (not the home).
  let rows = [];
  try { rows = require('./harness/catalog').KNOWN || []; } catch { /* none */ }
  for (const h of rows) {
    if (h.kind !== 'cli' || !h.configPathHint) continue;
    const dir = path.dirname(tilde(h.configPathHint));
    if (path.resolve(dir) === path.resolve(os.homedir())) continue;
    add(h.id, h.label, dir);
  }
  return out;
}

/** Every shortcut, grouped, in the order the side list draws them. */
function places() {
  const P = require('./paths');
  return [...docaPlaces(P), ...projectPlaces(), ...harnessPlaces(P)];
}

module.exports = { places, docaPlaces, projectPlaces, harnessPlaces };
