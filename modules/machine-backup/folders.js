'use strict';

/**
 * Which folders a backup of this machine suggests, per OS, and what each one is (its role) — so a copy made on one
 * machine lands in the right place on another: a Linux ~/Documents restores into a Windows Documents and back.
 *
 * Everything here takes the machine as arguments (platform, home, environment, a way to ask whether a path exists and
 * what a folder holds), so a test describes a Mac or a Windows box from Linux. The defaults read this machine.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** The known folders, by role: their usual name under the home folder on each OS, and how a person reads them. */
const KNOWN = [
  { role: 'documents', label: 'Documents', name: { linux: 'Documents', darwin: 'Documents', win32: 'Documents' }, xdg: 'XDG_DOCUMENTS_DIR' },
  { role: 'desktop',   label: 'Desktop',   name: { linux: 'Desktop',   darwin: 'Desktop',   win32: 'Desktop' },   xdg: 'XDG_DESKTOP_DIR' },
  { role: 'pictures',  label: 'Pictures',  name: { linux: 'Pictures',  darwin: 'Pictures',  win32: 'Pictures' },  xdg: 'XDG_PICTURES_DIR' },
  { role: 'music',     label: 'Music',     name: { linux: 'Music',     darwin: 'Music',     win32: 'Music' },     xdg: 'XDG_MUSIC_DIR' },
  { role: 'videos',    label: 'Videos',    name: { linux: 'Videos',    darwin: 'Movies',    win32: 'Videos' },    xdg: 'XDG_VIDEOS_DIR' },
];

/** Folders under home whose name says they hold someone's projects. */
const PROJECTS = /^(projects?|code|src|dev|development|workspace|work|repos?|git|github|gitlab|sites|source)$/i;

/** Settings files worth carrying to a fresh install, under home (posix names; Windows reads the same where they exist). */
const DOTFILES = [
  { rel: '.ssh', role: 'ssh', label: 'SSH keys and hosts' },
  { rel: '.gitconfig', role: 'git', label: 'Git settings' },
  { rel: '.bashrc', role: 'shell', label: 'bash settings' },
  { rel: '.bash_profile', role: 'shell', label: 'bash login settings' },
  { rel: '.profile', role: 'shell', label: 'login settings' },
  { rel: '.zshrc', role: 'shell', label: 'zsh settings' },
  { rel: '.zprofile', role: 'shell', label: 'zsh login settings' },
];

/** %APPDATA% picks on Windows: small folders of settings people miss on a new machine. */
const APPDATA = [
  { rel: path.win32.join('Code', 'User'), role: 'appdata', label: 'VS Code settings' },
  { rel: 'JetBrains', role: 'appdata', label: 'JetBrains IDE settings' },
  { rel: 'Notepad++', role: 'appdata', label: 'Notepad++ settings' },
];

const realExists = p => { try { fs.statSync(p); return true; } catch { return false; } };
const realList = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };
const realRead = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

/** XDG user-dirs (Linux): a Documents folder named in the person's language ("Documenti") is still documents. */
function xdgDirs(home, read) {
  const out = {};
  for (const line of read(path.posix.join(home, '.config', 'user-dirs.dirs')).split('\n')) {
    const m = /^(XDG_[A-Z]+_DIR)="?\$HOME\/([^"]+)"?\s*$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * The suggested folders for this OS: [{path, role, label, exists, on}] — `on` (ticked by default) where it exists.
 * `machine`: {platform, home, env, exists(p), list(dir) → folder names, read(p) → text, dataDir, workspace}.
 */
function suggestions(machine = {}) {
  const platform = machine.platform || process.platform;
  const P = platform === 'win32' ? path.win32 : path.posix;
  const home = machine.home || os.homedir();
  const env = machine.env || process.env;
  const exists = machine.exists || realExists;
  const list = machine.list || realList;
  const read = machine.read || realRead;
  const out = [];
  const add = (p, role, label) => { if (p && !out.some(x => x.path === p)) out.push({ path: p, role, label, exists: exists(p), on: false }); };

  const xdg = platform === 'linux' ? xdgDirs(home, read) : {};
  for (const k of KNOWN) add(P.join(home, (k.xdg && xdg[k.xdg]) || k.name[platform] || k.name.linux), k.role, k.label);
  for (const name of list(home)) if (PROJECTS.test(name)) add(P.join(home, name), 'projects', `Projects (${name})`);
  for (const d of DOTFILES) add(P.join(home, ...d.rel.split('/')), d.role, d.label);
  if (platform !== 'win32') add(P.join(home, '.config'), 'config', 'App settings (~/.config, caches left out)');
  if (platform === 'win32' && env.APPDATA) for (const a of APPDATA) add(P.join(env.APPDATA, a.rel), a.role, a.label);
  if (machine.dataDir !== null) add(machine.dataDir || require('../store').DATA_DIR, 'doca-data', `${require('../branding').name('product')}'s own data`);
  if (machine.workspace !== null) add(machine.workspace || safeWorkspace(), 'doca-workspace', `${require('../branding').name('product')}'s workspace`);
  for (const x of out) x.on = x.exists;
  // A settings file or app folder this machine does not have is not worth a line; a known folder is (it says where it would be).
  return out.filter(x => x.exists || KNOWN.some(k => k.role === x.role));
}

function safeWorkspace() { try { return require('../paths').describe().find(p => p.key === 'WORKSPACE_DIR')?.value || null; } catch { return null; } }

/** The folders a run backs up: the person's list, else the suggestions ticked by default. Missing ones are left out. */
function chosen(cfgFolders, machine = {}) {
  const exists = machine.exists || realExists;
  const list = cfgFolders && cfgFolders.length ? cfgFolders : suggestions(machine).filter(s => s.on).map(s => s.path);
  return { present: list.filter(p => exists(p)), missing: list.filter(p => !exists(p)) };
}

/** A path's role on this machine's suggestions (by path), or null. */
function roleOf(p, machine = {}) { return suggestions(machine).find(s => s.path === p)?.role || null; }

/* ── Bringing a copy back on another machine ── */

/** A path as segments: '/home/al' → ['home','al']; 'C:\\Users\\al' and restic's '/C/Users/al' → ['C','Users','al']. */
function segments(p) {
  const s = String(p || '');
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(s);
  if (m) return [m[1].toUpperCase(), ...m[2].split(/[\\/]+/).filter(Boolean)];
  return s.split(/[\\/]+/).filter(Boolean);
}

const sameSeg = (a, b, ci) => (ci ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Where a path from a snapshot made on another machine lands on this one, or null when it was not under that
 * machine's home folder (it has no place here: the person chooses one). `from` and `to`: {home, platform}. A known
 * folder keeps its role across OSes (macOS Movies ↔ Videos).
 */
function mapHome(snapPath, from, to = {}) {
  const toPlatform = to.platform || process.platform;
  const P = toPlatform === 'win32' ? path.win32 : path.posix;
  const toHome = to.home || os.homedir();
  const segs = segments(snapPath), h = segments(from.home);
  if (!h.length) return null;
  // restic writes a Windows path as /C/Users/…; a home written as C:\Users\… is the same thing.
  const ci = from.platform === 'win32';
  if (segs.length < h.length || !h.every((x, i) => sameSeg(x, segs[i], ci))) return null;
  const rest = segs.slice(h.length);
  if (rest.length) {
    const k = KNOWN.find(k => sameSeg(rest[0], k.name[from.platform] || k.name.linux, ci));
    if (k) rest[0] = k.name[toPlatform] || k.name.linux;
  }
  return rest.length ? P.join(toHome, ...rest) : toHome;
}

/** A path as restic stored it, as a path on this OS: /C/Users/al → C:\Users\al on Windows; unchanged elsewhere. */
function toLocal(snapPath, platform = process.platform) {
  if (platform !== 'win32') return snapPath;
  const m = /^\/([A-Za-z])(\/.*)?$/.exec(snapPath);
  return m ? `${m[1].toUpperCase()}:${(m[2] || '\\').replace(/\//g, '\\')}` : snapPath.replace(/\//g, '\\');
}

module.exports = { suggestions, chosen, roleOf, mapHome, toLocal, segments, KNOWN };
