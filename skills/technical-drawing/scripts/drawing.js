#!/usr/bin/env node
'use strict';

/**
 * The technical-drawing template: a part in, a dimensioned sheet out (PDF and DXF), laid out so nothing overlaps.
 *
 *   node drawing.js SPEC.json                        a spec (see ../SKILL.md); { "sheets": [ … ] } for several
 *   node drawing.js --part P.step --out D.pdf [--title "Back tray"] [--project …] [--material …] [--sheet A3]
 *   flags: --freecad PATH  --cadcraft PATH  --keep (leave the work folder)  --svg (also write the SVG preview)
 *
 * FreeCAD projects the views (project.py); lib/compose.js lays the sheet out and plans the dimensions; CADCraft draws
 * it with real dimension objects and exports the PDF. Without CADCraft the same sheet is written as SVG and printed
 * to PDF by a Chromium, if one is here. Prints a JSON report: what was placed, what was left out, any warning.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const tools = require('./lib/tools');
const { compose } = require('./lib/compose');
const { script } = require('./lib/render-cadcraft');
const { svg } = require('./lib/render-svg');

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else out._.push(a);
  }
  return out;
}

function readSpec(a) {
  if (a._[0]) {
    const file = path.resolve(a._[0]);
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { spec, base: path.dirname(file) };
  }
  if (!a.part || !a.out) throw new Error('Give a spec file, or --part and --out.');
  const title = Object.fromEntries(['part', 'project', 'material', 'finish', 'drawn', 'number', 'revision'].filter(k => a[k === 'part' ? 'title' : k]).map(k => [k, a[k === 'part' ? 'title' : k]]));
  return { spec: { part: a.part, out: a.out, sheet: a.sheet, projection: a.projection, title }, base: process.cwd() };
}

function project(sheetSpec, work, a) {
  const fc = tools.freecad(a.freecad);
  if (!fc) throw new Error('FreeCAD is not installed here (its command line, freecadcmd, projects the views). Install FreeCAD 1.0 or later, or pass --freecad PATH.');
  fs.copyFileSync(path.join(__dirname, 'project.py'), path.join(work, 'project.py'));
  const views = sheetSpec.views || ['front', 'top', 'side', 'section', 'iso'];
  const job = {
    part: sheetSpec.part, out: path.join(work, 'views.json'), front: sheetSpec.front || 'auto', up: sheetSpec.up || 'auto',
    views: views.map(n => n === 'section'
      ? { name: 'section', cut: { axis: (sheetSpec.section && sheetSpec.section.axis) || 'vertical', at: (sheetSpec.section && sheetSpec.section.at) ?? 'auto' } }
      : { name: n, rel: n === 'side' ? (sheetSpec.side || 'right') : n }),
  };
  fs.writeFileSync(path.join(work, 'job.json'), JSON.stringify(job, null, 1));
  const code = `import sys; sys.argv=['project.py', ${JSON.stringify(path.join(work, 'job.json'))}]; exec(open(${JSON.stringify(path.join(work, 'project.py'))}).read())`;
  try {
    execFileSync(fc, ['-c', code], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
  } catch (e) {
    throw new Error(`FreeCAD could not project ${sheetSpec.part}: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-4).join(' | ')}`);
  }
  if (!fs.existsSync(job.out)) throw new Error(`FreeCAD ran but wrote no views (is ${work} writable by it? A snap FreeCAD cannot read or write /tmp).`);
  return JSON.parse(fs.readFileSync(job.out, 'utf8'));
}

function viaChrome(svgFile, pdf, sheet, a) {
  const exe = tools.chrome(a.chrome);
  if (!exe) return false;
  const html = svgFile.replace(/\.svg$/, '.html');
  fs.writeFileSync(html, `<!doctype html><style>@page{size:${sheet[0]}mm ${sheet[1]}mm;margin:0}html,body{margin:0}img{display:block;width:${sheet[0]}mm;height:${sheet[1]}mm}</style><img src="${path.basename(svgFile)}">`);
  execFileSync(exe, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, 'file://' + html], { stdio: 'ignore', timeout: 120000 });
  return fs.existsSync(pdf);
}

function oneSheet(sheetSpec, base, a, n, total) {
  const out = path.resolve(base, sheetSpec.out || 'drawing.pdf');
  sheetSpec = { ...sheetSpec, part: path.resolve(base, sheetSpec.part) };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const work = path.join(path.dirname(out), `.${path.basename(out, '.pdf')}-drawing`);
  fs.mkdirSync(work, { recursive: true });
  const proj = project(sheetSpec, work, a);
  const font = sheetSpec.font || tools.sansFont();
  const c = compose(sheetSpec, proj, { sheetNo: n, sheets: total });
  const report = { pdf: out, part: sheetSpec.part, ...c.report };
  const cad = tools.cadcraft(a.cadcraft);
  if (a.svg || !cad) fs.writeFileSync(out.replace(/\.pdf$/i, '.svg'), svg(c.entities, { sheet: c.sheet }));
  if (cad) {
    const scr = path.join(work, 'sheet.scr');
    fs.writeFileSync(scr, script(c.entities, { sheet: c.sheet, paper: (sheetSpec.sheet || 'A3').toUpperCase(), landscape: (sheetSpec.orientation || 'landscape') !== 'portrait', pdf: out, font, styles: c.styles }));
    const dxf = out.replace(/\.pdf$/i, '.dxf');
    execFileSync(cad, ['run', '--metric', '--script-file', scr, '--save', dxf], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
    report.dxf = dxf;
    report.drawn_with = 'CADCraft';
  } else {
    report.svg = out.replace(/\.pdf$/i, '.svg');
    report.drawn_with = 'SVG (CADCraft is not installed)';
    if (!viaChrome(report.svg, out, c.sheet, a)) { report.pdf = null; report.warnings.push('No CADCraft and no Chromium here: the sheet is the SVG only.'); }
  }
  if (!a.keep) fs.rmSync(work, { recursive: true, force: true });
  return report;
}

function main() {
  const a = args(process.argv.slice(2));
  const { spec, base } = readSpec(a);
  const list = Array.isArray(spec.sheets)
    ? spec.sheets.map((s, i) => ({ ...spec, ...s, sheets: undefined, out: s.out || String(spec.out || 'drawing.pdf').replace(/(\.pdf)?$/i, `-${i + 1}.pdf`),
      title: { ...(spec.title || {}), ...(s.title || {}) } }))
    : [spec];
  const reports = list.map((s, i) => oneSheet(s, base, a, i + 1, list.length));
  const result = { sheets: reports };
  if (list.length > 1 && spec.out && reports.every(r => r.pdf)) {
    const merged = path.resolve(base, spec.out);
    const unite = tools.which('pdfunite') || tools.which('qpdf');
    if (unite) {
      execFileSync(unite, path.basename(unite).startsWith('qpdf') ? ['--empty', '--pages', ...reports.map(r => r.pdf), '--', merged] : [...reports.map(r => r.pdf), merged]);
      result.merged = merged;
    } else result.note = 'Each sheet is its own PDF (no pdfunite or qpdf here to join them).';
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

try { main(); } catch (e) { process.stderr.write(`drawing: ${e.message}\n`); process.exit(1); }
