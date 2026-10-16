'use strict';

/**
 * The craft templates (skills/technical-drawing, skills/product-video, skills/printable-part): the arithmetic that
 * carries their taste, held without FreeCAD, CADCraft, Blender or ffmpeg — a drawing's views never overlap and never
 * leave the frame whatever the part's size, a video's shots add up to exactly the duration asked — and the files the
 * agent is pointed at exist: each skill names a shipped recipe, each recipe names a script that is there.
 */
const H      = require('./helpers');   // first: it points the data folder at a temporary one
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const DRAW = path.join(ROOT, 'skills/technical-drawing/scripts/lib');
const VIDEO = path.join(ROOT, 'skills/product-video/scripts/lib');
const L = require(path.join(DRAW, 'layout'));
const { compose, entityBox } = require(path.join(DRAW, 'compose'));
const V = require(path.join(DRAW, 'views'));
const { script } = require(path.join(DRAW, 'render-cadcraft'));
const { svg } = require(path.join(DRAW, 'render-svg'));
const P = require(path.join(VIDEO, 'plan'));
void H;

// A seeded generator, so a failure names a case that can be run again.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** A made-up projection of a box-shaped part w × h × d with a ring of holes, as project.py would write it. */
function fakePart(w, h, d, holes = 4) {
  const rect = (x0, y0, x1, y1) => [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]].map(([a, b, c, e]) => ({ t: 'l', a: [a, b], b: [c, e] }));
  const hs = Array.from({ length: holes }, (_, i) => ({ c: [-w / 2 + w * (i + 1) / (holes + 1), h / 2 - Math.min(8, h / 4)], d: Math.min(3.4, w / 20), depth: d, through: i % 2 === 0 }));
  const view = (bw, bh, extra = {}) => ({ bbox: [-bw / 2, -bh / 2, bw / 2, bh / 2], visible: rect(-bw / 2, -bh / 2, bw / 2, bh / 2), hidden: [], ...extra });
  return {
    views: {
      front: view(w, h, { rel: 'front', basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], holes: hs, visible: [...rect(-w / 2, -h / 2, w / 2, h / 2), ...hs.map(x => ({ t: 'c', c: x.c, r: x.d / 2 }))] }),
      top: view(w, d, { rel: 'top' }),
      side: view(d, h, { rel: 'right' }),
      section: view(d, h, { rel: 'right', cut: { axis: 'vertical', at: 0 }, faces: [{ outer: [[-d / 2, -h / 2], [d / 2, -h / 2], [d / 2, h / 2], [-d / 2, h / 2]], holes: [] }] }),
      iso: view(w * 0.9 + d, h * 0.9 + d * 0.5, { rel: 'iso' }),
    },
  };
}

test('the views of any part never overlap, never leave the frame, at a standard scale', () => {
  const rand = rng(42);
  let cases = 0;
  for (const sheet of ['A4', 'A3', 'A2']) for (const projection of ['first', 'third']) for (let i = 0; i < 60; i++) {
    // From a washer to a door panel: 2 mm to 2 m, thin plates to cubes.
    const w = 2 + rand() ** 2 * 2000, h = 2 + rand() ** 2 * 1500, d = 0.5 + rand() ** 2 * Math.max(w, h);
    const proj = fakePart(w, h, d, Math.floor(rand() * 7));
    const spec = { sheet, projection, title: { part: `case ${i}` }, notes: ['A note.'], ...(i % 3 === 0 ? { detail: { at: proj.views.front.holes[0]?.c || [0, 0], radius: Math.min(w, h) / 8 } } : {}) };
    const c = compose(spec, proj);
    const label = `${sheet} ${projection} ${w.toFixed(1)} × ${h.toFixed(1)} × ${d.toFixed(1)}`;
    assert.deepEqual(L.overlaps(c.boxes), [], `${label}: parts of the sheet overlap`);
    for (const [name, b] of Object.entries(c.boxes)) assert.ok(L.inside(b, c.inner), `${label}: ${name} leaves the frame`);
    for (const e of c.entities) { const b = entityBox(e); if (b && e.layer !== 'FRAME') assert.ok(L.inside(b, [c.inner[0] - 0.01, c.inner[1] - 0.01, c.inner[2] + 0.01, c.inner[3] + 0.01]), `${label}: a ${e.k} reaches outside the frame`); }
    assert.deepEqual(c.report.warnings, [], `${label}: ${c.report.warnings.join('; ')}`);
    assert.ok(L.SCALES.some(s => `${L.scaleText(s)}` === c.report.scale), `${label}: ${c.report.scale} is not an ISO scale`);
    cases++;
  }
  assert.equal(cases, 360);
});

test('the scale is the largest that fits, and a part too big for the sheet is said, not squeezed', () => {
  const small = L.layout({ views: { front: { bbox: [-10, -10, 10, 10] } }, sheet: L.sheetSize('A3') });
  assert.equal(small.scale, 10, 'a 20 mm part on A3 is drawn at 10:1');
  const plate = compose({ sheet: 'A3' }, fakePart(207, 172, 13));
  assert.equal(plate.report.scale, '1:1', 'a 207 × 172 mm plate fits A3 at 1:1 once the top view gives way');
  assert.match(plate.report.left_out.join(' '), /top: left out/);
  const asked = compose({ sheet: 'A3', views: ['front', 'top', 'side', 'section', 'iso'] }, fakePart(207, 172, 13));
  assert.ok(asked.report.views.includes('top'), 'a top view asked for by name stays');
  assert.throws(() => L.layout({ views: { front: { bbox: [0, 0, 1e7, 1e7] } } }), /does not fit/);
});

test('free cells hold the extra views without touching the others', () => {
  const lay = L.layout({ views: { front: { bbox: [-100, -60, 100, 60], margins: { t: 10, b: 20, l: 10, r: 10 } } }, pack: true });
  assert.ok(lay.free.length > 0);
  const area = [lay.area.x0, lay.area.y0, lay.area.x1, lay.area.y1];
  for (const f of lay.free) {
    assert.ok(L.inside(f.box, area));
    assert.deepEqual(L.overlaps({ f: f.box, front: lay.views.front.box }), []);
  }
  const iso = L.bestCell([-50, -50, 50, 50], lay.free, { max: 1, pictorial: true });
  assert.ok(iso && iso.scale <= 1);
  assert.deepEqual(L.overlaps({ iso: iso.box, front: lay.views.front.box }), []);
});

test('geometry helpers: an arc goes the way its middle point says; clipping keeps what is inside; a hatch starts inside', () => {
  const a = V.arcOf({ c: [0, 0], r: 1, p: [[1, 0], [0, 1], [-1, 0]] });
  assert.deepEqual([Math.round(a.a0), Math.round(a.a1)], [0, 180]);
  const b = V.arcOf({ c: [0, 0], r: 1, p: [[-1, 0], [0, 1], [1, 0]] });
  assert.deepEqual([Math.round(b.a0), Math.round(b.a1)], [0, 180], 'the same arc walked the other way');
  const parts = V.clipToCircle([[-10, 0], [10, 0]], [0, 0], 5);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0].map(p => p.map(Math.round)), [[-5, 0], [5, 0]]);
  const ring = V.seedOf([[0, 0], [10, 0], [10, 10], [0, 10]], [[[2, 2], [8, 2], [8, 8], [2, 8]]]);
  assert.ok(ring && !(ring[0] > 2 && ring[0] < 8 && ring[1] > 2 && ring[1] < 8), 'the seed is in the ring, not the hole');
});

test('both renders take the same sheet: a CADCraft script of commands, and an SVG', () => {
  const c = compose({ sheet: 'A3', title: { part: 'Bracket' }, dimensions: [{ view: 'front', p1: [-20, 0], p2: [20, 0] }, { view: 'front', center: [0, 0], d: 6 }] }, fakePart(120, 80, 10, 3));
  const scr = script(c.entities, { sheet: c.sheet, paper: 'A3', pdf: 'out.pdf', font: 'DejaVu Sans', styles: c.styles }).trim().split('\n');
  for (const line of scr) assert.match(line, /^[a-z.\-_]+ \{.*\}$/, `not a command: ${line}`);
  assert.ok(scr.some(l => l.startsWith('dimlinear ')) && scr.some(l => l.startsWith('dimdiameter ')) && scr.some(l => l.startsWith('hatch ')));
  assert.match(scr.find(l => l.startsWith('dimstyle ')), /"DIMLFAC":/, 'dimensions measure the part, not the paper');
  assert.match(scr[scr.length - 1], /^exportpdf /);
  const s = svg(c.entities, { sheet: c.sheet });
  assert.match(s, /^<svg [^>]*viewBox="0 0 420 297"/);
  assert.match(s, /BRACKET/);
});

test('a promo is exactly as long as asked, and every part has its moment inside its shot', () => {
  for (const duration of [8, 15, 20, 31]) for (const fps of [24, 30, 60]) for (const n of [1, 2, 3, 6]) {
    const spec = { duration, fps, parts: Array.from({ length: n }, (_, i) => ({ path: `p${i}.stl` })) };
    const sh = P.shots(spec);
    const end = sh.list[sh.list.length - 1];
    assert.ok(Math.abs(end.start + end.seconds - duration) < 1 / fps + 1e-9, `${duration} s at ${fps} fps, ${n} parts: ends at ${end.start + end.seconds}`);
    assert.equal(sh.list.some(s => s.shot === 'assemble'), n > 1, 'one part has nothing to assemble');
    for (const s of sh.list) assert.ok(Number.isInteger(Math.round(s.seconds * fps)) && s.seconds > sh.fade * 2, `${s.shot} is too short to fade in and out`);
    const asm = sh.list.find(s => s.shot === 'assemble');
    if (!asm) continue;
    const { moves, captions } = P.schedule(n, asm.seconds);
    assert.equal(moves.length, n - 1);
    for (const [a, b] of moves) assert.ok(a >= 0 && b > a && b <= asm.seconds);
    captions.forEach(([a, b], i) => {
      assert.ok(a >= 0 && b > a && b <= asm.seconds, `caption ${i} sits inside the shot`);
      if (i) assert.ok(a >= captions[i - 1][1], `captions ${i - 1} and ${i} do not fade through each other`);
    });
  }
});

test('the edit is one filter graph: every shot, a crossfade between each, the exact duration', () => {
  const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'promo-'));
  try {
    const spec = { duration: 20, title: 'A: "quoted" title', subtitle: 'sub', details: ['one', 'two'], end: 'End', end_lines: ['x'], parts: [{ path: 'a.stl', name: 'A' }, { path: 'b.stl', name: 'B', note: 'n' }] };
    const argv = require(path.join(VIDEO, 'edit')).args(spec, { work, turnDir: '/r/turn', asmDir: '/r/asm', out: '/r/out.mp4', fonts: { bold: '/f/b.ttf', regular: '/f/r.ttf' } });
    const graph = fs.readFileSync(argv[argv.indexOf('-filter_complex_script') + 1], 'utf8');
    assert.equal((graph.match(/xfade=/g) || []).length, 3);
    assert.equal(argv[argv.lastIndexOf('-t') + 1], '20', 'the output is cut at the duration');
    assert.ok(argv.includes(path.join('/r/asm', '0225.png')), 'the end card is the assembly\'s last frame');
    assert.equal(fs.readFileSync(path.join(work, 'title.txt'), 'utf8'), 'A: "quoted" title', 'text goes through a file, unescaped');
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test('the skills name shipped recipes, and the recipes name scripts that are there', () => {
  const store = require('../modules/recipes/store');
  const named = [];
  for (const name of ['technical-drawing', 'product-video', 'printable-part']) {
    const text = fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');   // a Windows checkout
    const meta = text.match(/^---\n([\s\S]*?)\n---/)[1];
    assert.match(meta, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(meta, /^description: .{40,}$/m);
    for (const id of (meta.match(/^recipes: \[(.*)\]$/m)?.[1] || '').split(',').map(s => s.trim()).filter(Boolean)) named.push(id);
  }
  assert.deepEqual(named.sort(), ['product-video', 'technical-drawing']);
  for (const id of named) {
    const r = store.get(id);
    assert.ok(r && r.shipped, `${id} ships with the hub`);
    store.normalize(r);   // a valid recipe
    const script = r.steps[0].args.command.match(/"([^"]+\.js)"/)[1];
    assert.ok(fs.existsSync(script), `${id} runs ${script}`);
  }
  assert.ok(store.list().some(r => r.id === 'technical-drawing'), 'shipped recipes are listed');
  assert.throws(() => store.remove('technical-drawing'), /ships with the hub/);
  const craft = fs.readFileSync(path.join(ROOT, 'skills/craft-apps/SKILL.md'), 'utf8');
  for (const s of ['technical-drawing', 'product-video', 'printable-part']) assert.ok(craft.includes(s), `craft-apps points to ${s}`);
});

test('a request for drawings or a promo finds its skill', () => {
  const { matcher } = require('../modules/harness/skill-match');
  const search = (q, list) => { const m = matcher(q); return list.map(s => ({ ...s, score: m(s) })).filter(s => s.score > 0).sort((a, b) => b.score - a.score); };
  const skills = ['technical-drawing', 'product-video', 'printable-part'].map(name => {
    const text = fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    return { name, description: text.match(/^description: (.*)$/m)[1], body: text.split('\n---\n').slice(1).join('\n') };
  });
  const top = q => search(q, skills)[0]?.name;
  assert.equal(top('pdf drawings with dimensions of the bracket'), 'technical-drawing');
  assert.equal(top('a 20 second promo video of the parts'), 'product-video');
  assert.equal(top('design a printable bracket for M3 screws'), 'printable-part');
});

// The render is a background job of the hub's (harness/jobs.js), never a process of its own that detaches: shell_job
// lists it, its pid is the render's, and shell_job stop ends it, Blender with it, and the marker says it was stopped
// (CONSTITUTION §1, V11). A stand-in Blender that only sleeps; POSIX, since it is a shell script.
test('a promo render runs as the job that started it, and stopping the job stops the render', { skip: process.platform === 'win32' && 'a stand-in Blender script needs a POSIX shell' }, async () => {
  const jobs = require('../modules/harness/jobs');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'promo-job-'));
  const sleeper = path.join(dir, 'blender');
  const pidFile = path.join(dir, 'blender.pid');
  fs.writeFileSync(sleeper, `#!/bin/sh\necho $$ > ${JSON.stringify(pidFile)}\nexec sleep 60\n`);
  fs.chmodSync(sleeper, 0o755);
  fs.writeFileSync(path.join(dir, 'a.stl'), 'solid a\nendsolid a\n');
  const font = path.join(dir, 'f.ttf'); fs.writeFileSync(font, '');
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, JSON.stringify({ out: 'v.mp4', duration: 6, font_bold: font, font_regular: font, parts: [{ path: 'a.stl', name: 'Part A' }] }));
  const script = path.join(ROOT, 'skills/product-video/scripts/promo.js');
  const job = jobs.start(`"${process.execPath}" "${script}" start "${spec}" --blender "${sleeper}" --ffmpeg "${sleeper}"`, { cwd: dir });
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    const until = Date.now() + 10000;
    while (!fs.existsSync(pidFile) && Date.now() < until) await H.sleep(100);
    assert.ok(fs.existsSync(pidFile), 'the stand-in Blender started');
    const status = JSON.parse(fs.readFileSync(path.join(dir, 'v.mp4.status.json'), 'utf8'));
    assert.equal(status.state, 'running');
    assert.equal(jobs.get(job.id).state, 'running', 'still running as the job: start did not hand it to a detached process and return');
    const blenderPid = Number(fs.readFileSync(pidFile, 'utf8'));
    jobs.stop(job.id);
    const gone = Date.now() + 10000;
    while ((alive(blenderPid) || !fs.existsSync(path.join(dir, 'v.mp4.done.json'))) && Date.now() < gone) await H.sleep(100);
    assert.ok(!alive(blenderPid), 'Blender went with the job');
    const marker = JSON.parse(fs.readFileSync(path.join(dir, 'v.mp4.done.json'), 'utf8'));
    assert.equal(marker.ok, false);
    assert.match(marker.error, /stopped/);
  } finally { try { jobs.stop(job.id); } catch { /* ended */ } fs.rmSync(dir, { recursive: true, force: true }); }
});

// Round 1 of the test of 2026-10-16: start run in the foreground (shell without background: true) waited 100 s on a
// render of minutes and timed out. Outside a background job it now refuses at once with the exact call to make.
test('promo.js start outside a background job refuses, printing the exact call; as a job it starts', async () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'promo-fg-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.stl'), 'solid a\nendsolid a\n');
    const spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, JSON.stringify({ out: 'v.mp4', duration: 6, parts: [{ path: 'a.stl', name: 'Part A' }] }));
    const script = path.join(ROOT, 'skills/product-video/scripts/promo.js');
    const { DOCA_JOB, ...env } = process.env;
    const r = spawnSync(process.execPath, [script, 'start', spec], { env, encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 3, 'refused, at once');
    assert.match(r.stderr, /Not started: a render takes minutes, so it runs only as a background job/);
    const shellCall = r.stderr.match(/^ {2}shell (\{.*\})$/m);
    assert.ok(shellCall, 'the exact shell call is printed');
    assert.deepEqual(JSON.parse(shellCall[1]), { command: `node ${JSON.stringify(script)} start ${JSON.stringify(spec)}`, background: true });
    assert.match(r.stderr, /recipe \{"action":"run","id":"product-video","values":\{"spec":/);
    assert.ok(!fs.existsSync(path.join(dir, 'v.mp4.status.json')), 'nothing was started');
    // The hub's jobs say so to what they run, so the recipe and shell {background: true} are let through.
    const job = require('../modules/harness/jobs').start(`"${process.execPath}" -e "process.stdout.write(process.env.DOCA_JOB || 'none')"`, { cwd: dir });
    const until = Date.now() + 10000;
    let seen = '';
    while (Date.now() < until && !(seen = require('../modules/harness/jobs').output(job.id))) await H.sleep(100);
    assert.equal(seen, job.id, 'a background job carries DOCA_JOB');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the product-video recipe starts the render as a background job', () => {
  const r = require('../modules/recipes/store').get('product-video');
  assert.equal(r.steps[0].tool, 'shell');
  assert.equal(r.steps[0].args.background, true);
  assert.match(r.steps[0].check.contains, /Started background job/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'skills/product-video/scripts/promo.js'), 'utf8'), /detached: true/);
});

// Each craft skill checks its own output (check_output) and shows a plan contract with the same check; the contract in
// the skill is a valid one (plan-contracts.split keeps only a check's own fields, so a typo would vanish there).
test('the craft skills check their output, and their contract examples are valid checks', () => {
  const pc = require('../modules/harness/plan-contracts');
  for (const [name, kind] of [['product-video', 'video'], ['technical-drawing', 'pdf']]) {
    const text = fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    assert.match(text, new RegExp(`check_output \\{kind: "${kind}"`), `${name} runs check_output`);
    const example = text.match(/```json\n(\{ "done": [^\n]+\})\n```/);
    assert.ok(example, `${name} shows a plan contract`);
    const c = JSON.parse(example[1]);
    assert.deepEqual(pc.split({ title: 'x', ...c }).contract.check, c.check, `${name}'s contract check is kept whole`);
  }
});

// End to end where the programs are: the product-video template's own cut (lib/edit.js, ffmpeg) over frames standing in
// for Blender's, then the video check its skill names — the template's output holds the contract it advertises.
const findV = require(path.join(ROOT, 'skills/product-video/scripts/lib/find'));
const FFMPEG = require('../modules/checks/bin').find('ffmpeg') && require('../modules/checks/bin').find('ffprobe');
let FONTS = null;
try { FONTS = findV.fonts({}); } catch { /* no system font: skipped */ }
test('a promo cut by the template holds its video check', { skip: (!FFMPEG && 'ffmpeg is not installed here') || (!FONTS && 'no font for the cards here') }, async t => {
  const ffmpeg = require('../modules/checks/bin').find('ffmpeg');
  const { execFileSync } = require('node:child_process');
  const work = fs.mkdtempSync(path.join(H.tmp, 'promo-e2e-'));
  try {
    const spec = { duration: 6, fps: 10, resolution: [640, 360], title: 'Bracket Kit', subtitle: 'Two printed parts', end: 'Print it.',
      parts: [{ path: 'a.stl', name: 'Part A' }, { path: 'b.stl', name: 'Part B' }] };
    const plan = P.shots(spec), seg = Object.fromEntries(plan.list.map(s => [s.shot, s]));
    const dirs = {};
    for (const [shot, src] of [['turntable', 'testsrc'], ['assemble', 'testsrc2']]) {
      dirs[shot] = path.join(work, shot); fs.mkdirSync(dirs[shot]);
      execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `${src}=size=640x360:rate=10`, '-frames:v', String(seg[shot].frames), path.join(dirs[shot], '%04d.png')]);
    }
    const out = path.join(work, 'promo.mp4');
    const argv = require(path.join(VIDEO, 'edit')).args(spec, { work, turnDir: dirs.turntable, asmDir: dirs.assemble, out, fonts: FONTS });
    try { execFileSync(ffmpeg, argv, { stdio: 'pipe' }); }
    catch (e) { if (/drawtext|No such filter/.test(String(e.stderr))) return t.skip('this ffmpeg has no drawtext'); throw e; }   // an ffmpeg without drawtext cannot cut the cards
    const r = await require('../modules/checks').run({ video: out, duration: 6, width: 640, height: 360, fps: 10, frames: 4 });
    assert.equal(r.ok, true, r.why);
    assert.match(r.why, /6\.0 s, 640×360, 10 fps/);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});
