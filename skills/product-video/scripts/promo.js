#!/usr/bin/env node
'use strict';

/**
 * The product video template: parts in, a promo out — title card, turntable, the parts coming together, end card.
 *
 *   node promo.js start SPEC.json     renders it, printing as it goes — start it as a background job (shell with
 *                                      background: true), so it is seen, stopped and waited for like any other job
 *   node promo.js wait SPEC.json [--timeout 1800]   waits for it: exit 0 done, 1 failed, 2 still running
 *   node promo.js status SPEC.json    one look: running, done or failed, and how far
 *   node promo.js plan SPEC.json      the shots and timings, rendering nothing
 *   flags: --blender PATH  --ffmpeg PATH  --fresh (render the shots again even when their frames are complete)
 *
 * It does not detach itself: a render the hub's jobs do not know of would run unseen — no Stop, no machine reading
 * naming it (CONSTITUTION §1, V11). The background job outlives the turn that started it; when the render ends it
 * writes <video>.done.json — {ok, video, seconds, …} or {ok: false, error} — the marker to wait on, and shell_job
 * stop ends it and Blender with it (the marker then says it was stopped).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const P = require('./lib/plan');
const find = require('./lib/find');
const { args: editArgs } = require('./lib/edit');

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) o[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; else o._.push(a); }
  return o;
}

function load(file) {
  const abs = path.resolve(file), base = path.dirname(abs);
  const spec = JSON.parse(fs.readFileSync(abs, 'utf8'));
  spec.out = path.resolve(base, spec.out || 'promo.mp4');
  spec.parts = (spec.parts || []).map(p => (p.path ? { ...p, path: path.resolve(base, p.path) } : p));
  if (!spec.parts.length) throw new Error('A promo needs "parts": [{path, name, color?, note?, offset?}] — STL, OBJ, PLY, GLB or a {box}.');
  for (const p of spec.parts) if (p.path && !fs.existsSync(p.path)) throw new Error(`No such part: ${p.path}`);
  return { spec, specFile: abs };
}

const files = spec => ({ work: spec.out.replace(/\.[^.]+$/, '') + '.work', status: spec.out + '.status.json', marker: spec.out + '.done.json' });
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pngs = d => { try { return fs.readdirSync(d).filter(n => /^\d{4}\.png$/.test(n)).length; } catch { return 0; } };

function start(spec, o) {
  const f = files(spec);
  const st = readJson(f.status);
  if (st && st.state === 'running' && st.pid !== process.pid && alive(st.pid)) return { already: true, ...st, marker: f.marker };
  fs.mkdirSync(f.work, { recursive: true });
  fs.rmSync(f.marker, { force: true });
  logFile = path.join(f.work, 'render.log');
  fs.writeFileSync(logFile, '');
  writeJson(f.status, { state: 'running', pid: process.pid, started: new Date().toISOString(), step: 'starting' });
  say({ started: true, pid: process.pid, log: logFile, marker: f.marker, video: spec.out });
  return null;
}
let logFile = null;
const say = v => { const t = JSON.stringify(v, null, 2) + '\n'; process.stdout.write(t); if (logFile) fs.appendFileSync(logFile, t); };

function runChild(cmd, argv, step, f, expect) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    running = c;
    let tail = '';
    const keep = d => { tail = (tail + d).slice(-4000); process.stdout.write(d); if (logFile) fs.appendFileSync(logFile, d); };
    c.stdout.on('data', keep); c.stderr.on('data', keep);
    const tick = setInterval(() => { const st = readJson(f.status) || {}; writeJson(f.status, { ...st, step, ...(expect ? { frames: pngs(expect.dir), of: expect.frames } : {}) }); }, 3000);
    c.on('close', code => { clearInterval(tick); running = null; code === 0 ? resolve() : reject(new Error(`${step} failed (exit ${code}): ${tail.split('\n').filter(Boolean).slice(-3).join(' | ')}`)); });
    c.on('error', e => { clearInterval(tick); running = null; reject(e); });
  });
}
let running = null, stopping = null;
// Stopped (shell_job stop, a person's Stop): Blender goes with it, and the marker says so — never a render left running.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => {
  if (running) running.kill();
  if (stopping) { const at = new Date().toISOString(); writeJson(stopping.marker, { ok: false, error: `stopped (${sig})`, finished: at }); writeJson(stopping.status, { state: 'failed', error: `stopped (${sig})`, finished: at }); }
  process.exit(1);
});

async function run(spec, o) {
  const f = files(spec);
  stopping = f;
  const t0 = Date.now();
  const st0 = readJson(f.status) || {};
  writeJson(f.status, { ...st0, state: 'running', pid: process.pid, step: 'planning' });
  try {
    const blender = find.blender(o.blender), ffmpeg = find.ffmpeg(o.ffmpeg);
    if (!blender) throw new Error('Blender is not installed here (4.2 or later renders the shots). Install it, or pass --blender PATH.');
    if (!ffmpeg) throw new Error('ffmpeg is not installed here (it cuts the video). Install it, or pass --ffmpeg PATH.');
    const fonts = find.fonts(spec);
    const plan = P.shots(spec);
    const seg = Object.fromEntries(plan.list.map(s => [s.shot, s]));
    const parts = P.parts(spec);
    const res = P.resolution(spec.resolution);
    const common = { fps: plan.fps, resolution: res, engine: spec.engine || 'eevee', samples: spec.samples, style: spec.style || 'dark',
      parts, rotate: spec.rotate || [0, 0, 0], explode_axis: spec.explode_axis || [0, 0, 1], elevation: spec.elevation, azimuth: spec.azimuth,
      background: spec.background, floor: spec.floor, lens: spec.lens, spread: spec.spread };
    const shotsToRender = [['turntable', { turn_degrees: spec.turn_degrees || 270 }], ...(seg.assemble ? [['assemble', { moves: P.schedule(parts.length, seg.assemble.seconds).moves }]] : [])];
    const dirs = {};
    for (const [shot, more] of shotsToRender) {
      const dir = path.join(f.work, shot);
      const job = { ...common, ...more, shot, frames: seg[shot].frames, out_dir: dir };
      for (const k of Object.keys(job)) if (job[k] === undefined) delete job[k];
      // The same job and the same scene script: the frames on disk are this shot already.
      const hash = crypto.createHash('sha256').update(JSON.stringify(job)).update(fs.readFileSync(path.join(__dirname, 'scene.py'))).digest('hex').slice(0, 16);
      dirs[shot] = dir;
      const done = readJson(path.join(dir, 'job.json'));
      if (!o.fresh && done && done.hash === hash && pngs(dir) >= job.frames) continue;   // the same shot, already rendered
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const jobFile = path.join(f.work, `${shot}.job.json`);
      writeJson(jobFile, job);
      await runChild(blender, ['-b', '--factory-startup', '-noaudio', '-P', path.join(__dirname, 'scene.py'), '--', jobFile], `rendering ${shot}`, f, { dir, frames: job.frames });
      // Blender numbers frames from 1 with four digits; check they are all there before cutting.
      if (pngs(dir) < job.frames) throw new Error(`Blender wrote ${pngs(dir)} of ${job.frames} frames for the ${shot} shot.`);
      writeJson(path.join(dir, 'job.json'), { hash });
    }
    const argv = editArgs(spec, { work: f.work, turnDir: dirs.turntable, asmDir: dirs.assemble, out: spec.out, fonts });
    await runChild(ffmpeg, argv, 'cutting', f);
    const result = { ok: true, video: spec.out, duration: plan.duration, resolution: res, fps: plan.fps, shots: plan.list.map(s => ({ shot: s.shot, seconds: s.seconds })),
      seconds: Math.round((Date.now() - t0) / 1000), frames_kept: f.work, finished: new Date().toISOString() };
    stopping = null;
    writeJson(f.marker, result);
    writeJson(f.status, { state: 'done', pid: process.pid, finished: result.finished });
  } catch (e) {
    const result = { ok: false, error: e.message, log: path.join(f.work, 'render.log'), finished: new Date().toISOString() };
    stopping = null;
    writeJson(f.marker, result);
    writeJson(f.status, { state: 'failed', error: e.message, finished: result.finished });
    process.exitCode = 1;
  }
}

function status(spec) {
  const f = files(spec);
  const done = readJson(f.marker);
  if (done) return { state: done.ok ? 'done' : 'failed', ...done };
  const st = readJson(f.status);
  if (!st) return { state: 'not started', video: spec.out };
  if (st.state === 'running' && !alive(st.pid)) return { state: 'failed', error: 'The render stopped without finishing (the machine restarted, or it was killed). Start it again: finished shots are kept.' };
  return st;
}

async function wait(spec, o) {
  const until = Date.now() + (Number(o.timeout) || 1800) * 1000;
  for (;;) {
    const s = status(spec);
    if (s.state === 'done' || s.state === 'failed' || s.state === 'not started' || Date.now() > until) return s;
    await new Promise(r => setTimeout(r, 2000));
  }
}

async function main() {
  const o = parse(process.argv.slice(2));
  const [cmd, file] = o._;
  if (!cmd || !file) throw new Error('Usage: node promo.js start|wait|status|plan|run SPEC.json');
  const { spec } = load(file);
  let out;
  if (cmd === 'start' || cmd === 'run') { out = start(spec, o); if (!out) return run(spec, o); }   // run: its older name
  else if (cmd === 'status') out = status(spec);
  else if (cmd === 'wait') { out = await wait(spec, o); process.exitCode = out.state === 'done' ? 0 : out.state === 'failed' ? 1 : 2; }
  else if (cmd === 'plan') { const p = P.shots(spec); out = { ...p, assemble: p.list.find(s => s.shot === 'assemble') ? P.schedule(spec.parts.length, p.list.find(s => s.shot === 'assemble').seconds) : null }; }
  else throw new Error(`Unknown command "${cmd}".`);
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main().catch(e => { process.stderr.write(`promo: ${e.message}\n`); process.exit(1); });
