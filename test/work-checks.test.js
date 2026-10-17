'use strict';

/**
 * Mechanical checks of the work itself (modules/checks; improvement B, 2026-10-16) and how far a job is
 * (harness/plan-progress.js). The fixtures are made here: a 3D model written as bytes, PDFs written by hand, videos and
 * pictures drawn by ffmpeg — a good one of each and one with the flaw a real run shipped (a blank title card, doubled
 * text, text over text and off the sheet, a mesh that is not closed). The readers that need ffmpeg, tesseract or
 * poppler skip where those are not installed; the mesh, the progress and the "say what you could not verify" paths
 * always run.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const H      = require('./helpers');   // first: it points the settings at a temporary folder
const fs     = require('node:fs');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');
const checks = require('../modules/checks');
const bin    = require('../modules/checks/bin');
const pc     = require('../modules/harness/plan-contracts');

test.after(() => H.stop());

const DIR = path.join(H.tmp, 'work-checks');
fs.mkdirSync(DIR, { recursive: true });
const at = f => path.join(DIR, f);

// ── 3D models, as bytes ────────────────────────────────────────────────────────────────────────────────────────────
const CUBE = (s, o = [0, 0, 0]) => {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(p => p.map((c, i) => c * s[i] + o[i]));
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.map(t => t.map(i => v[i]));
};
function stl(tris) {
  const b = Buffer.alloc(84 + tris.length * 50);
  b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, j) => p.forEach((c, k) => b.writeFloatLE(c, 84 + i * 50 + 12 + j * 12 + k * 4))));
  return b;
}

test('mesh: size against the bed, closed or not, how many parts — read in Node', async () => {
  fs.writeFileSync(at('box.stl'), stl(CUBE([200, 140, 14])));
  fs.writeFileSync(at('open.stl'), stl(CUBE([200, 140, 14]).slice(0, 10)));          // the top left off
  fs.writeFileSync(at('two.stl'), stl([...CUBE([50, 50, 5]), ...CUBE([50, 50, 5], [80, 0, 0])]));
  fs.writeFileSync(at('big.stl'), stl(CUBE([260, 100, 10])));
  let r = await checks.run({ mesh: at('box.stl'), maxSize: [220, 220, 250], watertight: true, maxParts: 1 });
  assert.equal(r.ok, true, r.why);
  assert.match(r.why, /200 × 140 × 14, 12 triangles, 1 part, closed/);
  r = await checks.run({ mesh: at('open.stl'), watertight: true });
  assert.equal(r.ok, false);
  assert.match(r.why, /not closed: 4 edges belong to one face only/);
  r = await checks.run({ mesh: at('two.stl'), maxParts: 1 });
  assert.match(r.why, /2 separate parts, more than 1/);
  r = await checks.run({ mesh: at('big.stl'), maxSize: [220, 220, 250] });
  assert.match(r.why, /larger than 220 × 220 × 250 however it is turned/);
  r = await checks.run({ mesh: at('box.stl'), maxSize: [140, 220, 250] });
  assert.equal(r.ok, true, 'it fits turned');
  assert.match(r.why, /fits 140 × 220 × 250 only turned/);
  // OBJ and STEP: the same box, and a STEP says what it cannot tell
  fs.writeFileSync(at('box.obj'), 'v 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\nv 0 0 10\nv 10 0 10\nv 10 10 10\nv 0 10 10\n'
    + 'f 1 3 2\nf 1 4 3\nf 5 6 7\nf 5 7 8\nf 1 2 6\nf 1 6 5\nf 2 3 7\nf 2 7 6\nf 3 4 8\nf 3 8 7\nf 4 1 5\nf 4 5 8\n');
  assert.match((await checks.run({ mesh: at('box.obj'), watertight: true })).why, /10 × 10 × 10, 12 triangles, 1 part, closed/);
  fs.writeFileSync(at('part.step'), "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\n#2=CARTESIAN_POINT('',(120.,80.,6.));\n#3=MANIFOLD_SOLID_BREP('',#9);\nENDSEC;\nEND-ISO-10303-21;\n");
  r = await checks.run({ mesh: at('part.step'), maxSize: [220, 220, 250] });
  assert.equal(r.ok, true, r.why);
  assert.match(r.why, /120 × 80 × 6 \(from the points it lists\), 1 solid/);
  // Asked to be closed, a STEP cannot show it here: the requirement does not hold (checks/verdict.js).
  r = await checks.run({ mesh: at('part.step'), maxSize: [220, 220, 250], watertight: true });
  assert.equal(r.ok, false, r.why);
  assert.match(r.why, /could not verify whether it is closed — a STEP solid is read as points here; check the STL exported from it instead/);
});

test('a check reads only the work: not there, outside the roots, settings — each said', async () => {
  assert.match((await checks.run({ mesh: at('nothing.stl') })).why, /is not there/);
  // The protected keys folder is outside on every OS (paths.PROTECTED_DIRS).
  assert.match((await checks.run({ image: path.join(require('../modules/paths').PROTECTED_DIRS[0], 'cover.png') })).why, /outside the folders a check may read/);
  assert.throws(() => pc.split({ title: 'x', check: { mesh: 'a.stl', maxSize: [1, 2] } }), /maxSize is \[x, y, z\]/);
  assert.throws(() => pc.split({ title: 'x', check: { video: 'a.mp4', duration: -1 } }), /duration is a number/);
  assert.deepEqual(pc.split({ title: 'Promo', check: { video: 'promo.mp4', duration: 20, junk: 1 } }).contract.check, { video: 'promo.mp4', duration: 20 }, 'only its own fields are kept');
});

test('a reader that is missing is named, never passed over', async () => {
  const keep = process.env.PATH;
  fs.writeFileSync(at('clip.mp4'), 'not really a video');
  process.env.PATH = path.join(DIR, 'no-programs-here');
  bin.reset();
  try {
    const r = await checks.run({ video: at('clip.mp4'), duration: 20 });
    assert.equal(r.ok, false);
    assert.match(r.why, /ffprobe is not on this machine \(Settings → System → System tools → ffmpeg\)/);
    assert.match((await checks.run({ pdf: at('clip.mp4') })).why, /pdftotext is not on this machine/);
  } finally { process.env.PATH = keep; bin.reset(); }
});

// ── PDFs, written by hand ──────────────────────────────────────────────────────────────────────────────────────────
function pdf(ops, [w, h] = [595, 842]) {
  const esc = t => t.replace(/[()\\]/g, m => `\\${m}`);
  const stream = ops.map(o => (o.text ? `BT /F1 ${o.size || 14} Tf ${o.x} ${o.y} Td (${esc(o.text)}) Tj ET` : `${o.line[0]} ${o.line[1]} m ${o.line[2]} ${o.line[3]} l S`)).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const off = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return off; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
const POPPLER = !!(bin.find('pdftotext') && bin.find('pdftoppm'));

test('pdf: pages, words, and a layout with nothing over anything or off the sheet', { skip: !POPPLER && 'poppler is not installed here' }, async () => {
  fs.writeFileSync(at('good.pdf'), pdf([{ text: 'BACK PLATE', x: 60, y: 760 }, { text: 'Width 201 mm', x: 60, y: 720 }, { line: [60, 690, 400, 690] }]));
  fs.writeFileSync(at('bad.pdf'), pdf([{ text: 'BACK PLATE', x: 60, y: 760 }, { text: 'Overlapping', x: 60, y: 500 }, { text: 'notes here', x: 75, y: 502 },
    { text: 'CUT OFF AT THE EDGE', x: 520, y: 400 }, { text: 'Crossed', x: 60, y: 300, size: 24 }, { line: [50, 307, 200, 307] }, { line: [300, 100, 595, 100] }]));
  let r = await checks.run({ pdf: at('good.pdf'), pages: 1, contains: ['201', 'back plate'] });
  assert.equal(r.ok, true, r.why);
  r = await checks.run({ pdf: at('good.pdf'), pages: 2, contains: ['Title block'] });
  assert.match(r.why, /it has 1 page, not 2/);
  assert.match(r.why, /it does not show "Title block"/);
  r = await checks.run({ pdf: at('bad.pdf') });
  assert.equal(r.ok, false);
  assert.match(r.why, /text is drawn over other text in \d+ place/);
  assert.match(r.why, /"notes" over "Overlapping"|"Overlapping" over "notes"/);
  assert.match(r.why, /text runs off the page — "/);
  assert.match(r.why, /the drawing runs off the sheet at the right/);
  if (bin.find('gs')) assert.match(r.why, /a drawn line runs through 1 word — "Crossed"/);
  assert.equal((await checks.run({ pdf: at('bad.pdf'), noOverlap: false })).ok, true, 'the layout look can be left out');
});

// ── Videos and pictures, drawn by ffmpeg ───────────────────────────────────────────────────────────────────────────
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Helvetica.ttc', 'C:/Windows/Fonts/arialbd.ttf'].find(f => fs.existsSync(f));
const text = (t, x, y, size = 44, color = 'white') => `drawtext=${FONT ? `fontfile='${FONT.replace(/:/g, '\\:')}':` : ''}text='${t}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}`;
function draw(file, filters, seconds, colour = '0x1c2228') {
  execFileSync(bin.find('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=640x360:d=${seconds}:r=10`, '-vf', filters, '-pix_fmt', 'yuv420p', file]);
}
let DRAWN = false;
try {
  if (bin.find('ffmpeg') && bin.find('ffprobe')) {
    draw(at('good.mp4'), `${text('BRACKET KIT', 40, 80)},${text('two printed parts', 40, 170, 32)},drawbox=x=420:y=230:w=160:h=90:color=white@0.8:t=4`, 4);
    draw(at('card.mp4'), 'null', 2.5, '0x7c7c7c');
    draw(at('doubled.mp4'), `${text('PRINT TWO PARTS', 30, 70)},${text('PRINT TWO PARTS', 110, 190)}`, 2.5);
    execFileSync(bin.find('ffmpeg'), ['-v', 'error', '-y', '-i', at('card.mp4'), '-i', at('doubled.mp4'), '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', at('bad.mp4')]);
    execFileSync(bin.find('ffmpeg'), ['-v', 'error', '-y', '-i', at('good.mp4'), '-frames:v', '1', at('good.png')]);
    // A word drawn over a caption, and the same caption fading (a quarter strength): only the first is text over text.
    const sized = (file, filters) => execFileSync(bin.find('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1c2228:s=1280x720:d=2:r=10', '-vf', filters, '-pix_fmt', 'yuv420p', file]);
    sized(at('over.mp4'), `${text('FRONT FRAME four screws clamp the edges', 60, 300, 40)},${text('ZQXWV', 455, 304, 40)}`);
    sized(at('fade.mp4'), text('FRONT FRAME four screws clamp the edges', 60, 300, 40, 'white@0.25'));
    execFileSync(bin.find('ffmpeg'), ['-v', 'error', '-y', '-i', at('card.mp4'), '-frames:v', '1', at('blank.png')]);
    DRAWN = true;
  }
} catch { /* an ffmpeg without drawtext: the video tests skip */ }

test('video: its facts, a blank card, doubled text — said with the second and the place', { skip: !DRAWN && 'ffmpeg with drawtext is not installed here' }, async () => {
  let r = await checks.run({ video: at('good.mp4'), duration: 4, width: 640, height: 360, fps: 10, frames: 4 });
  assert.equal(r.ok, true, r.why);
  assert.match(r.why, /4\.0 s, 640×360, 10 fps/);
  r = await checks.run({ video: at('good.mp4'), duration: 20, width: 1920, fps: 30, frames: 2 });
  assert.match(r.why, /lasts 4\.0 s, not 20\.0 s; it is 640 wide, not 1920; it runs at 10 fps, not 30/);
  r = await checks.run({ video: at('bad.mp4'), frames: 6 });
  assert.equal(r.ok, false);
  assert.match(r.why, /0\.0 s–2\.5 s shows almost nothing \(contrast \d/);
  if (bin.find('tesseract')) assert.match(r.why, /the words "PRINT TWO" appear twice — at \(\d+,\d+\) and again \d+ px right, \d+ px down/);
  else assert.match(r.why, /not verified: its text — tesseract is not on this machine/);
});

test('video: text over text is said; a caption fading out is not mistaken for it', { skip: (!DRAWN || !bin.find('tesseract')) && 'ffmpeg with drawtext, or tesseract, is not installed here' }, async () => {
  const over = await checks.run({ video: at('over.mp4'), frames: 2 });
  assert.equal(over.ok, false, over.why);
  assert.match(over.why, /text is drawn over other text at \(\d+,\d+\) px/);
  const fade = await checks.run({ video: at('fade.mp4'), frames: 2 });
  assert.equal(fade.ok, true, fade.why);
});

test('image: blank or not, and the words on it', { skip: !DRAWN && 'ffmpeg with drawtext is not installed here' }, async () => {
  assert.match((await checks.run({ image: at('blank.png') })).why, /shows almost nothing/);
  const r = await checks.run({ image: at('good.png'), width: 640, contains: bin.find('tesseract') ? ['BRACKET'] : undefined });
  assert.equal(r.ok, true, r.why);
});

// ── One rule: asked for and not verifiable fails; looked at by default and not verifiable is said ─────────────────
/** PATH with every reader the checks use except `hide`, as links in a folder of their own. */
function without(hide) {
  const d = fs.mkdtempSync(path.join(DIR, 'path-'));
  for (const name of Object.keys(bin.ROW)) { const p = bin.find(name); if (p && !hide.includes(name)) fs.symlinkSync(p, path.join(d, name)); }
  return d;
}
async function hidden(hide, fn) {
  bin.reset();
  const dir = without(hide), keep = process.env.PATH;
  process.env.PATH = dir;
  bin.reset();
  try { return await fn(); } finally { process.env.PATH = keep; bin.reset(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const LINKS = process.platform !== 'win32';

test('pdf: what was asked and could not be verified fails, naming what to install; a default look only says so', { skip: (!POPPLER && 'poppler is not installed here') || (!LINKS && 'linked programs need a POSIX host') }, async () => {
  fs.writeFileSync(at('lines.pdf'), pdf([{ line: [60, 690, 400, 690] }, { line: [60, 600, 400, 600] }]));   // text drawn as lines: no text layer
  fs.writeFileSync(at('plain.pdf'), pdf([{ text: 'Part A', x: 60, y: 760 }]));
  await hidden(['tesseract', 'gs'], async () => {
    let r = await checks.run({ pdf: at('lines.pdf'), contains: ['A-100'] });
    assert.equal(r.ok, false, r.why);
    assert.match(r.why, /could not verify its text: it has no text layer, and reading the drawn text needs tesseract is not on this machine \(Settings → System → System tools → tesseract\)/);
    r = await checks.run({ pdf: at('lines.pdf') });
    assert.equal(r.ok, true, `no words were asked for: ${r.why}`);
    assert.match(r.why, /not verified: its text/);
    r = await checks.run({ pdf: at('plain.pdf') });
    assert.equal(r.ok, true, r.why);
    assert.match(r.why, /not verified: lines through text — gs is not on this machine/);
    r = await checks.run({ pdf: at('plain.pdf'), noOverlap: true });
    assert.equal(r.ok, false, 'asked outright, the layout look must be made');
    assert.match(r.why, /could not verify lines through text — gs is not on this machine \(Settings → System → System tools → ghostscript\)/);
  });
});

test('image: words asked for with no tesseract fail the same way', { skip: (!DRAWN && 'ffmpeg with drawtext is not installed here') || (!LINKS && 'linked programs need a POSIX host') }, async () => {
  await hidden(['tesseract'], async () => {
    const r = await checks.run({ image: at('good.png'), contains: ['BRACKET'] });
    assert.equal(r.ok, false);
    assert.match(r.why, /could not verify its words — tesseract is not on this machine/);
    assert.equal((await checks.run({ image: at('good.png') })).ok, true, 'nothing asked that needs it');
  });
});

// ── A plan held to these checks, and how far it is ─────────────────────────────────────────────────────────────────
test('a plan step with a mesh check stays open until it holds; its progress is counted from the plan', async () => {
  await H.start();
  const org = require('../modules/harness/organization');
  const tools = require('../modules/harness/tools');
  const progress = require('../modules/harness/plan-progress');
  const work = org.create({ title: 'A printable bracket' });
  await tools.call('work_plan', { action: 'draft', title: 'A bracket', steps: ['Model it', 'Export the print', 'Write it up', 'Drop the old idea'],
    contracts: [{}, { done: 'the STL is closed and fits the bed', check: { mesh: at('bracket.stl'), maxSize: [220, 220, 250], watertight: true } }, {}, {}] }, [], { sessionId: work.id });
  const step = (n, state = 'done') => tools.call('work_plan', { action: 'progress', step: n, state }, [], { sessionId: work.id });
  await step(1);
  await step(2, 'running');
  let p = progress.of(org.plan(work.id, { action: 'read' }));
  assert.deepEqual({ done: p.done, total: p.total, percent: p.percent, running: p.running.step }, { done: 1, total: 4, percent: 25, running: 2 });

  fs.writeFileSync(at('bracket.stl'), stl(CUBE([200, 140, 14]).slice(0, 10)));
  const refused = JSON.parse(await step(2));
  assert.equal(refused.done, false);
  assert.match(refused.check, /not closed/);
  p = progress.of(org.plan(work.id, { action: 'read' }));
  assert.equal(p.failing.step, 2, 'the failing check is kept, with why');
  assert.match(p.failing.why, /not closed/);

  fs.writeFileSync(at('bracket.stl'), stl(CUBE([200, 140, 14])));
  await step(2);
  org.plan(work.id, { action: 'cancel', step: 4, why: 'not needed' });
  p = progress.of(org.plan(work.id, { action: 'read' }));
  assert.deepEqual({ done: p.done, total: p.total, percent: p.percent, checked: p.checked, failing: p.failing }, { done: 2, total: 3, percent: 67, checked: 1, failing: null }, 'a cancelled step is left out; the checked one counts');

  // The same numbers everywhere: the route the status column reads, the chat tab's view, a device's mission row.
  const res = await H.api(null, 'GET', '/api/harness/progress');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const jobs = res.body.jobs;
  const row = jobs.find(j => j.id === work.id);
  assert.ok(row, 'listed while under way');
  assert.equal(row.progress.percent, 67);
  assert.equal(org.view({ id: work.id }).progress.percent, 67);
  const device = require('../modules/harness/workview').payloadOf(org.session(work.id));
  assert.deepEqual(device.progress, { done: 2, total: 3, percent: 67 });
  assert.deepEqual(device.plan.map(i => i.state), ['done', 'done', 'queued']);
});

test('progress is mechanical: no plan, no number; every step cancelled, none', () => {
  const { of } = require('../modules/harness/plan-progress');
  assert.equal(of(null), null);
  assert.equal(of({ steps: [] }), null);
  assert.equal(of({ steps: ['a'], progress: { 1: 'cancelled' } }), null);
  assert.equal(of({ steps: ['a', 'b'], progress: { 1: 'done', 2: 'done' }, fulfilledAt: 'x' }).fulfilled, true);
});
