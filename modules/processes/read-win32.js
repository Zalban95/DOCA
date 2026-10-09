'use strict';

/**
 * The process table on Windows: one PowerShell call by argv (modules/shell's program and flags — `-NoProfile
 * -NonInteractive`, so no profile's banner reaches the JSON), a fixed script with nothing of ours spliced in.
 *   Get-CimInstance Win32_Process   ids, parent, name, executable, command line, start, working set, CPU time, session
 *   Get-NetTCPConnection -State Listen   the listening ports by owning process
 * Windows gives no working folder for another process, so a project is found by a path on the command line instead.
 * Never the environment.
 */
const { execFile } = require('child_process');

const SCRIPT = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime,SessionId,'
    + '@{n="Start";e={ if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } }}',
  '$l = Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess',
  '@{ procs = @($p); listen = @($l) } | ConvertTo-Json -Compress -Depth 3',
].join('; ');

/** A command line as words: double quotes group, backslashes are kept (they are paths here). */
function splitCommand(s) {
  const out = [];
  let cur = '', q = false, any = false;
  for (const ch of String(s || '')) {
    if (ch === '"') { q = !q; any = true; continue; }
    if (/\s/.test(ch) && !q) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
    cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}

/** The script's JSON into rows and pid → ports. */
function parse(json, now = Date.now()) {
  let d;
  try { d = JSON.parse(String(json || '').trim() || '{}'); } catch { d = {}; }
  const procs = [].concat(d.procs || []).filter(Boolean).map(x => {
    const args = x.CommandLine ? splitCommand(x.CommandLine) : [x.ExecutablePath || x.Name].filter(Boolean);
    return { pid: Number(x.ProcessId), ppid: Number(x.ParentProcessId), uid: null, user: null, session: x.SessionId ?? null,
      name: String(x.Name || '').replace(/\.exe$/i, ''), exe: x.ExecutablePath || null, args, cwd: null, cgroup: null,
      kernel: Number(x.ProcessId) === 0 || Number(x.ProcessId) === 4,
      cpuMs: (Number(x.KernelModeTime || 0) + Number(x.UserModeTime || 0)) / 10000,
      startedAt: x.Start ? Number(x.Start) : now, rss: Number(x.WorkingSetSize || 0) };
  });
  const listen = new Map();
  for (const c of [].concat(d.listen || []).filter(Boolean)) {
    const pid = Number(c.OwningProcess), port = Number(c.LocalPort);
    if (!pid || !port) continue;
    const list = listen.get(pid) || [];
    if (!list.includes(port)) list.push(port);
    listen.set(pid, list.sort((a, b) => a - b));
  }
  return { procs, listen };
}

let _listen = new Map();

async function read() {
  const s = require('../shell').spec();
  const file = s.name === 'powershell' ? s.file : 'powershell.exe';
  const out = await new Promise(resolve => execFile(file, ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
    { timeout: 15000, maxBuffer: 32 << 20, windowsHide: true }, (err, stdout) => resolve(err && !stdout ? '' : String(stdout))));
  const now = Date.now();
  const { procs, listen } = parse(out, now);
  _listen = listen;
  return { os: 'win32', at: now, procs };
}

/** The ports came with the table (one call). */
async function listening() { return _listen; }

const accounts = () => ({ names: new Map(), uidMin: null });

module.exports = { read, listening, accounts, parse, splitCommand, SCRIPT };
