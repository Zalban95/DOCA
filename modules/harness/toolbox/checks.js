'use strict';

/**
 * check_output: the agent looks at its own work before calling it done (modules/checks; improvement B, 2026-10-16) —
 * the same readers a plan contract's check uses, so what passes here passes when the step is marked done. It only
 * reads: a file under the allowed roots, through programs the hub knows (ffprobe, ffmpeg, tesseract, poppler,
 * Ghostscript) by argv. Not in approval.FREE — it starts processes — so Manual mode asks as for any tool.
 */
const { resolvePath, cwd } = require('./common');

const KINDS = ['video', 'pdf', 'mesh', 'image'];

module.exports = [
  {
    name: 'check_output',
    description: 'Check a piece of work as a person would look at it, before you say it is done — a video, a PDF drawing, a 3D model or a picture. '
      + 'video: length, size and frame rate, no blank stretch (a title card must carry readable text), no text drawn twice or over other text; '
      + 'pdf: page count, words that must be on it, no text over text, no line through a word, nothing off the sheet; '
      + 'mesh (STL, OBJ, GLB, STEP): size against maxSize, closed (watertight), how many parts; image: not blank, words on it. '
      + 'It says what failed and where (the second, the page and millimetres, the edge count), and what it could not verify. '
      + 'Put the same check in the plan step\'s contract (check: {video: "<path>", duration: 20}) so the step can only be marked done when it holds.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        path: { type: 'string', description: 'The file: absolute, or relative to the conversation\'s project folder (else the agent workspace).' },
        duration: { type: 'number', description: 'video: seconds it should last.' },
        width: { type: 'integer', description: 'video or image: pixels wide.' },
        height: { type: 'integer', description: 'video or image: pixels high.' },
        fps: { type: 'number', description: 'video: frames per second.' },
        frames: { type: 'integer', description: 'video: how many frames to read text on (default 16, at most 40).' },
        pages: { type: 'integer', description: 'pdf: how many pages.' },
        contains: { type: 'array', items: { type: 'string' }, description: 'pdf or image: words that must be on it (a dimension, a title block field).' },
        noOverlap: { type: 'boolean', description: 'pdf: false to skip the layout look (on by default).' },
        notBlank: { type: 'boolean', description: 'image: false to skip the blank look (on by default).' },
        maxSize: { type: 'array', items: { type: 'number' }, description: 'mesh: [x, y, z] it must fit in, in the file\'s units (a print bed, in mm).' },
        watertight: { type: 'boolean', description: 'mesh: true when it must be closed (a print).' },
        minParts: { type: 'integer', description: 'mesh: at least this many separate parts.' },
        maxParts: { type: 'integer', description: 'mesh: at most this many separate parts (1 for a single print).' },
      },
      required: ['kind', 'path'],
    },
    run: async (args = {}, ctx = {}) => {
      if (!KINDS.includes(args.kind)) return `Error: kind is one of ${KINDS.join(', ')}.`;
      if (!args.path) return 'Error: check_output needs path.';
      const abs = resolvePath(args.path, ctx);   // the allowed roots, as read_file
      const checks = require('../../checks');
      const { kind, path: _p, ...rest } = args;
      let spec;
      try { spec = checks.normalize({ ...rest, [kind]: abs }); } catch (e) { return `Error: ${e.message}`; }
      const r = await checks.run(spec, { cwd: cwd(ctx) });
      return r.ok ? `Holds — ${r.why}` : `Does not hold — ${r.why}. Fix what it names and check again; a step whose contract carries this check cannot be marked done until it holds.`;
    },
  },
];
