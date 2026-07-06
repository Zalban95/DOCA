'use strict';

/**
 * System stats registry + collectors.
 *
 * Single source of truth for which stats exist, their labels and defaults.
 * The Settings UI reads STATS_DEFS via GET /api/stats/defs; the sidebar
 * receives the merged enabled-map inside GET /api/status (`statsEnabled`).
 *
 * Everything is collected from /proc, /sys or one cheap exec. Rate-based
 * stats (disk I/O, network) keep a module-level previous snapshot and
 * report bytes/sec between polls (null on the first poll).
 */

const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const { loadPrefs } = require('./utils');

// ─── Definitions ──────────────────────────────────────────────────────────────

const STATS_DEFS = [
  // group: system
  { id: 'cpu',      label: 'CPU usage',                group: 'system', default: true  },
  { id: 'cpuCores', label: 'Per-core usage (dropdown)', group: 'system', default: true  },
  { id: 'cpuTemp',  label: 'CPU temperature',          group: 'system', default: true  },
  { id: 'cpuFreq',  label: 'CPU frequency',            group: 'system', default: false },
  { id: 'load',     label: 'Load average (1/5/15 min)', group: 'system', default: true  },
  { id: 'ram',      label: 'RAM usage',                group: 'system', default: true  },
  { id: 'swap',     label: 'Swap usage',               group: 'system', default: false },
  { id: 'disk',     label: 'Disk usage per mount',     group: 'system', default: false },
  { id: 'diskIO',   label: 'Disk read/write rate',     group: 'system', default: false },
  { id: 'net',      label: 'Network up/down rate',     group: 'system', default: false },
  { id: 'uptime',   label: 'Uptime',                   group: 'system', default: false },
  { id: 'procs',    label: 'Processes (count + top 5)', group: 'system', default: false },
  // group: gpu
  { id: 'gpu',      label: 'GPU core metrics (temp / util / VRAM)', group: 'gpu', default: true  },
  { id: 'gpuExtra', label: 'GPU extras (power / fan / clocks / P-state)', group: 'gpu', default: false },
];

/** Merged enabled-map: saved prefs override the defaults. */
function getStatsConfig() {
  const saved = loadPrefs().sidebarStats || {};
  const cfg = {};
  for (const d of STATS_DEFS) {
    cfg[d.id] = typeof saved[d.id] === 'boolean' ? saved[d.id] : d.default;
  }
  return cfg;
}

/** GET /api/stats/defs — definitions for the Settings toggles UI */
function handleDefs(_req, res) {
  res.json({ defs: STATS_DEFS, enabled: getStatsConfig() });
}

// ─── Collectors (cheap, /proc & /sys based) ───────────────────────────────────

/** Mean current CPU frequency in MHz, or null. */
function readCpuFreqMHz() {
  try {
    const base = '/sys/devices/system/cpu';
    const cpus = fs.readdirSync(base).filter(d => /^cpu\d+$/.test(d));
    const freqs = [];
    for (const c of cpus) {
      try {
        const kHz = parseInt(fs.readFileSync(`${base}/${c}/cpufreq/scaling_cur_freq`, 'utf8'), 10);
        if (Number.isFinite(kHz)) freqs.push(kHz / 1000);
      } catch {}
    }
    if (freqs.length) return Math.round(freqs.reduce((a, b) => a + b, 0) / freqs.length);
  } catch {}
  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const mhz = [...cpuinfo.matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map(m => parseFloat(m[1]));
    if (mhz.length) return Math.round(mhz.reduce((a, b) => a + b, 0) / mhz.length);
  } catch {}
  return null;
}

/** Swap usage in MB from /proc/meminfo, or nulls. */
function readSwap() {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const val = key => {
      const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
      return m ? parseInt(m[1], 10) : NaN;
    };
    const totalKB = val('SwapTotal');
    const freeKB  = val('SwapFree');
    if (Number.isFinite(totalKB) && Number.isFinite(freeKB)) {
      return { swapTotal: Math.round(totalKB / 1e3), swapUsed: Math.round((totalKB - freeKB) / 1e3) };
    }
  } catch {}
  return { swapTotal: null, swapUsed: null };
}

const PSEUDO_FS = /^(tmpfs|devtmpfs|squashfs|overlay|proc|sysfs|efivarfs|ramfs|cgroup2?|fuse\.\S*|none)$/;

/** Per-mount disk usage via `df -kPT` (real filesystems only). */
function readDisks() {
  return new Promise(resolve => {
    exec('df -kPT', { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const seen  = new Set();
      const disks = [];
      stdout.trim().split('\n').slice(1).forEach(line => {
        const p = line.trim().split(/\s+/);
        if (p.length < 7) return;
        const [dev, fsType, totalKB, usedKB, , pctStr, ...mountParts] = p;
        if (PSEUDO_FS.test(fsType) || dev.startsWith('/dev/loop')) return;
        if (seen.has(dev)) return;         // one entry per device (bind mounts)
        seen.add(dev);
        const total = parseInt(totalKB, 10);
        const used  = parseInt(usedKB, 10);
        if (!Number.isFinite(total) || total <= 0) return;
        disks.push({
          mount:   mountParts.join(' '),
          fs:      fsType,
          totalKB: total,
          usedKB:  used,
          pct:     parseInt(pctStr, 10) || Math.round((used / total) * 100),
        });
      });
      resolve(disks.sort((a, b) => b.totalKB - a.totalKB));
    });
  });
}

// Rate snapshots: previous readings kept in module scope between polls.
let _prevDiskIO = null; // { ts, readSectors, writeSectors }
let _prevNet    = null; // { ts, ifaces: { name: { rx, tx } } }

const WHOLE_DISK_RE = /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|xvd[a-z]+|mmcblk\d+)$/;
const VIRTUAL_IFACE_RE = /^(lo|veth.*|br-.*|docker.*|virbr.*|tun.*|tap.*)$/;

/** Aggregate disk read/write bytes-per-sec from /proc/diskstats deltas. */
function readDiskIO() {
  try {
    const now = Date.now();
    let readSectors = 0, writeSectors = 0;
    fs.readFileSync('/proc/diskstats', 'utf8').trim().split('\n').forEach(line => {
      const p = line.trim().split(/\s+/);
      if (p.length < 10 || !WHOLE_DISK_RE.test(p[2])) return;
      readSectors  += parseInt(p[5], 10) || 0;   // sectors read
      writeSectors += parseInt(p[9], 10) || 0;   // sectors written
    });
    const prev = _prevDiskIO;
    _prevDiskIO = { ts: now, readSectors, writeSectors };
    if (!prev || now <= prev.ts) return null;
    const dt = (now - prev.ts) / 1000;
    return {
      readBps:  Math.max(0, Math.round((readSectors  - prev.readSectors)  * 512 / dt)),
      writeBps: Math.max(0, Math.round((writeSectors - prev.writeSectors) * 512 / dt)),
    };
  } catch { return null; }
}

/** Per-interface rx/tx bytes-per-sec from /proc/net/dev deltas. */
function readNet() {
  try {
    const now    = Date.now();
    const ifaces = {};
    fs.readFileSync('/proc/net/dev', 'utf8').trim().split('\n').slice(2).forEach(line => {
      const [nameRaw, rest] = line.split(':');
      if (!rest) return;
      const name = nameRaw.trim();
      if (VIRTUAL_IFACE_RE.test(name)) return;
      const p = rest.trim().split(/\s+/);
      ifaces[name] = { rx: parseInt(p[0], 10) || 0, tx: parseInt(p[8], 10) || 0 };
    });
    const prev = _prevNet;
    _prevNet = { ts: now, ifaces };
    if (!prev || now <= prev.ts) return null;
    const dt = (now - prev.ts) / 1000;
    return Object.entries(ifaces)
      .filter(([name]) => prev.ifaces[name])
      .map(([name, cur]) => ({
        iface: name,
        rxBps: Math.max(0, Math.round((cur.rx - prev.ifaces[name].rx) / dt)),
        txBps: Math.max(0, Math.round((cur.tx - prev.ifaces[name].tx) / dt)),
      }));
  } catch { return null; }
}

/** Process count (numeric /proc entries) + top 5 by CPU via `ps`. */
function readProcs() {
  return new Promise(resolve => {
    let procCount = null;
    try {
      procCount = fs.readdirSync('/proc').filter(e => /^\d+$/.test(e)).length;
    } catch {}
    exec('ps -eo pid,comm,%cpu,%mem --sort=-%cpu --no-headers', { timeout: 3000 }, (err, stdout) => {
      let topProcs = [];
      if (!err && stdout) {
        topProcs = stdout.trim().split('\n').slice(0, 5).map(line => {
          const p = line.trim().split(/\s+/);
          return {
            pid:  parseInt(p[0], 10),
            name: p.slice(1, p.length - 2).join(' ').slice(0, 24),
            cpu:  parseFloat(p[p.length - 2]) || 0,
            mem:  parseFloat(p[p.length - 1]) || 0,
          };
        });
      }
      resolve({ procCount, topProcs });
    });
  });
}

/**
 * Collect the extended stats according to the enabled-map.
 * Cheap /proc reads always run; exec-based ones only when enabled.
 * @param {object} cfg - merged enabled map from getStatsConfig()
 */
async function collectExtendedStats(cfg) {
  const out = {
    load15:    Math.round(os.loadavg()[2] * 100) / 100,
    uptimeSec: Math.round(os.uptime()),
    cpuFreqMHz: cfg.cpuFreq ? readCpuFreqMHz() : null,
    ...readSwap(),
    diskIO: cfg.diskIO ? readDiskIO() : null,
    net:    cfg.net    ? readNet()    : null,
  };
  const [disks, procs] = await Promise.all([
    cfg.disk  ? readDisks() : Promise.resolve(null),
    cfg.procs ? readProcs() : Promise.resolve(null),
  ]);
  out.disks     = disks;
  out.procCount = procs ? procs.procCount : null;
  out.topProcs  = procs ? procs.topProcs  : null;
  return out;
}

module.exports = {
  STATS_DEFS,
  getStatsConfig,
  handleDefs,
  collectExtendedStats,
};
