'use strict';

/**
 * The host's GPUs, whoever made them (TODO H1.4; hive.md §7 "up to what the hardware can do"). One list in the
 * shape the sidebar and the device feed already draw — {name, temp, util, memUsed, memTotal, …, vendor, source}
 * — from whichever tool this machine has:
 *
 *   NVIDIA   nvidia-smi (every OS)
 *   AMD      rocm-smi --json (Linux)
 *   Apple    ioreg's IOAccelerator statistics (no sudo): utilisation and the memory in use, out of unified memory
 *   Intel    sysfs on Linux: the current clock (utilisation needs intel_gpu_top, which needs root)
 *   Windows  the adapters by name and memory (Win32_VideoController), when there is no nvidia-smi
 *
 * A reading a tool does not give is null, never 0 — the sidebar draws "—" for it.
 */
const fs = require('fs');
const os = require('os');
const shell = require('./shell');

const num = v => { const s = String(v ?? '').trim(); if (!s || /n\/?a|not supported|unknown/i.test(s)) return null; const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
const run = (file, args, timeout = 4000) => new Promise(resolve =>
  require('child_process').execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout) => resolve(err ? null : String(stdout))));

async function nvidia() {
  const out = await run('nvidia-smi', ['--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,power.limit,fan.speed,clocks.sm,utilization.memory,clocks.mem,pstate', '--format=csv,noheader,nounits']);
  if (!out) return null;
  return out.trim().split('\n').filter(Boolean).map(l => {
    const p = l.split(',').map(s => s.trim());
    return { name: p[0], temp: p[1], util: p[2], memUsed: p[3], memTotal: p[4], powerDraw: num(p[5]), powerLimit: num(p[6]), fan: num(p[7]),
      clockSm: num(p[8]), memUtil: num(p[9]), clockMem: num(p[10]), pstate: p[11] && !/n\/?a/i.test(p[11]) ? p[11] : null, vendor: 'nvidia', source: 'nvidia-smi' };
  });
}

/** rocm-smi's JSON: one object per card, keys worded per version — matched loosely. */
function parseRocm(text) {
  let doc; try { doc = JSON.parse(text); } catch { return null; }
  const pick = (o, re) => { const k = Object.keys(o).find(x => re.test(x)); return k ? o[k] : null; };
  return Object.entries(doc).filter(([k]) => /^card\d+$/i.test(k)).map(([, c]) => {
    const total = num(pick(c, /VRAM Total Memory \(B\)/i)), used = num(pick(c, /VRAM Total Used Memory \(B\)/i));
    return { name: pick(c, /Card (series|model)|Device Name|Marketing Name/i) || 'AMD GPU', temp: num(pick(c, /Temperature.*(edge|junction)/i)), util: num(pick(c, /GPU use \(%\)/i)),
      memUsed: used != null ? Math.round(used / 1048576) : null, memTotal: total != null ? Math.round(total / 1048576) : null,
      powerDraw: num(pick(c, /(Average|Current).*Power \(W\)/i)), fan: num(pick(c, /Fan speed \(%\)/i)), clockSm: num(String(pick(c, /sclk clock speed/i) || '').replace(/[^\d.]/g, '')),
      vendor: 'amd', source: 'rocm-smi' };
  });
}
async function amd() { const out = await run('rocm-smi', ['--showproductname', '--showtemp', '--showuse', '--showmeminfo', 'vram', '--showpower', '--showfan', '--showclocks', '--json']); return out ? parseRocm(out) : null; }

/** ioreg's PerformanceStatistics for the Apple GPU: "Device Utilization %" and "In use system memory" (bytes). */
function parseIoreg(text, totalBytes = os.totalmem()) {
  const util = /"Device Utilization %"\s*=\s*(\d+)/.exec(text), inUse = /"In use system memory"\s*=\s*(\d+)/.exec(text);
  const model = /"model"\s*=\s*<?"([^"]+)"/.exec(text) || /"IOGLBundleName"\s*=\s*"([^"]+)"/.exec(text);
  if (!util && !inUse) return null;
  return [{ name: model ? model[1].replace(/^AGX\w*$/, 'Apple GPU') : 'Apple GPU', temp: null, util: util ? Number(util[1]) : null,
    memUsed: inUse ? Math.round(Number(inUse[1]) / 1048576) : null, memTotal: Math.round(totalBytes / 1048576), unified: true, vendor: 'apple', source: 'ioreg' }];
}
async function apple() { if (process.platform !== 'darwin') return null; const out = await run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']); return out ? parseIoreg(out) : null; }

function intel() {
  if (process.platform !== 'linux') return null;
  const out = [];
  let cards = [];
  try { cards = fs.readdirSync('/sys/class/drm').filter(n => /^card\d+$/.test(n)); } catch { return null; }
  for (const c of cards) {
    const dev = `/sys/class/drm/${c}/device`;
    try {
      if (fs.readFileSync(`${dev}/vendor`, 'utf8').trim() !== '0x8086') continue;
      const freq = (() => { try { return num(fs.readFileSync(`/sys/class/drm/${c}/gt_cur_freq_mhz`, 'utf8')); } catch { return null; } })();
      out.push({ name: 'Intel graphics', temp: null, util: null, memUsed: null, memTotal: null, clockSm: freq, vendor: 'intel', source: 'sysfs' });
    } catch { /* not a GPU device */ }
  }
  return out.length ? out : null;
}

let _winCache = null;
async function windowsAdapters() {
  if (process.platform !== 'win32') return null;
  if (_winCache && Date.now() - _winCache.at < 600000) return _winCache.list;
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'], 8000);
  let list = null;
  try { list = [].concat(JSON.parse(out)).filter(a => a?.Name && !/Basic Display|Remote Display/i.test(a.Name))
    .map(a => ({ name: a.Name, temp: null, util: null, memUsed: null, memTotal: a.AdapterRAM ? Math.round(a.AdapterRAM / 1048576) : null, vendor: /nvidia/i.test(a.Name) ? 'nvidia' : /amd|radeon/i.test(a.Name) ? 'amd' : /intel/i.test(a.Name) ? 'intel' : 'other', source: 'Win32_VideoController' })); } catch { list = null; }
  _winCache = { at: Date.now(), list };
  return list;
}

/** Every GPU this host can tell about; null when none. NVIDIA first, then whatever else is there. */
async function read() {
  const nv = shell.which('nvidia-smi') ? await nvidia() : null;
  const others = [shell.which('rocm-smi') ? await amd() : null, await apple(), intel()].filter(Boolean).flat();
  const all = [...(nv || []), ...others];
  if (all.length) return all;
  return windowsAdapters();
}

module.exports = { read, parseRocm, parseIoreg };
