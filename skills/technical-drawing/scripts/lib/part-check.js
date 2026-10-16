'use strict';

/**
 * Is there a part in the file at all? A STEP file can be written with its header and product records and no shape —
 * FreeCAD 1.1's Part.export did it in round 1 (2026-10-16), and the drawing then failed in projection, which sent the
 * agent looking at the wrong step. Read before FreeCAD runs: a STEP file names its faces and solids as entities
 * (ADVANCED_FACE, MANIFOLD_SOLID_BREP …); one with none of them has nothing to draw. project.py checks the same after
 * loading (any format), so a file FreeCAD cannot read as a shape is said the same way.
 */
const fs = require('fs');
const path = require('path');

const GEOMETRY = /\b(ADVANCED_FACE|FACE_SURFACE|MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS|FACETED_BREP|SHELL_BASED_SURFACE_MODEL|EDGE_CURVE|POLY_LOOP)\s*\(/i;
const HOW = 'export it from a FreeCAD document — doc = App.newDocument(); obj = doc.addObject("Part::Feature", "Part"); '
  + 'obj.Shape = shape; doc.recompute(); import Import; Import.export([obj], path) — and run again';

/** Scans the file in chunks and stops at the first face or solid; a few MB is read only when there is none. */
function stepHasGeometry(file) {
  const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(1 << 20);
  let tail = '', entities = 0;
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) {
      const s = tail + buf.toString('latin1', 0, n);
      if (GEOMETRY.test(s)) return { geometry: true };
      entities += (s.match(/^\s*#\d+\s*=/gm) || []).length;
      tail = s.slice(-64);
    }
  } finally { fs.closeSync(fd); }
  return { geometry: false, entities };
}

/** Throws "no geometry in <file>" with what to do, when the part file is missing, empty or a STEP with no shape. */
function assertPart(file) {
  const name = path.basename(file);
  if (!fs.existsSync(file)) throw new Error(`no part at ${file}`);
  if (!fs.statSync(file).size) throw new Error(`no geometry in ${name}: the file is empty — ${HOW}`);
  if (/\.(step|stp)$/i.test(file)) {
    const r = stepHasGeometry(file);
    if (!r.geometry) throw new Error(`no geometry in ${name}: the STEP file has its header and ${r.entities} record(s) but no face or solid, so it was exported empty (FreeCAD's Part.export can write such a file) — ${HOW}`);
  }
}

module.exports = { assertPart, stepHasGeometry, HOW };
