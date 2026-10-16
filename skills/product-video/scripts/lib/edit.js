'use strict';

/**
 * The ffmpeg command that cuts the promo: the rendered frames and two stills in, the cards and captions drawn in one
 * consistent style (one accent colour, one bold and one regular face, the same margins), crossfades between the
 * shots, exactly `duration` seconds of H.264 out. Texts go through small files, so nothing a person wrote needs
 * escaping for the filter.
 */
const fs = require('fs');
const path = require('path');
const P = require('./plan');

function write(dir, name, s) { const f = path.join(dir, name); fs.writeFileSync(f, String(s)); return f; }

function args(spec, { work, turnDir, asmDir, out, fonts }) {
  const plan = P.shots(spec);
  const [W, H] = P.resolution(spec.resolution);
  const k = Math.min(W, H) / 1080;
  const dark = spec.style !== 'light';
  const accent = (spec.accent || '#ff7a2f').replace('#', '0x');
  const ink = dark ? '0xf4f6f8' : '0x14181c', soft = dark ? '0xa3abb4' : '0x59616b';
  const veil = dark ? 'black@0.55' : 'white@0.6';
  const fps = plan.fps;
  const seg = Object.fromEntries(plan.list.map(s => [s.shot, s]));
  const T = (s, f) => P.text({ ...s, font: s.bold ? fonts.bold : fonts.regular, file: write(work, f, s.text) });
  const norm = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},format=yuv420p,setsar=1`;
  const inputs = [], chains = [];
  const add = (...a) => inputs.push(...a);
  const parts = P.parts(spec);

  // Title card: the first turntable frame, blurred and veiled; the title, the accent bar, the subtitle, the details.
  const titleStill = path.join(turnDir, '0001.png');
  add('-loop', '1', '-framerate', String(fps), '-t', String(seg.title.seconds), '-i', titleStill);
  const tx = Math.round(120 * k), ty = Math.round(H * 0.36);
  const title = [
    `gblur=sigma=${Math.round(26 * k)}`, `drawbox=x=0:y=0:w=iw:h=ih:color=${veil}:t=fill`,
    T({ text: spec.title || '', bold: true, size: 92 * k, color: ink, x: tx, y: ty, from: 0.25 }, 'title.txt'),
    P.box({ x: tx, y: ty + 116 * k, w: 150 * k, h: 7 * k, color: accent, from: 0.45 }),
    ...(spec.subtitle ? [T({ text: spec.subtitle, size: 42 * k, color: ink, x: tx, y: ty + 148 * k, from: 0.6 }, 'subtitle.txt')] : []),
    ...(spec.details && spec.details.length ? [T({ text: spec.details.join('   ·   '), size: 28 * k, color: soft, x: tx, y: ty + 214 * k, from: 0.85 }, 'details.txt')] : []),
    'fade=t=in:st=0:d=0.6',
  ];
  chains.push(`[0:v]${norm},${title.join(',')}[c0]`);

  // A caption in the lower third: the accent bar, a bold name, a quieter note.
  const caption = (name, note, from, to, i) => [
    P.box({ x: 96 * k, y: H - 206 * k, w: 6 * k, h: note ? 80 * k : 52 * k, color: accent, from, to }),
    T({ text: String(name).toUpperCase(), bold: true, size: 44 * k, color: ink, x: Math.round(120 * k), y: Math.round(H - 210 * k), from, to }, `cap${i}a.txt`),
    ...(note ? [T({ text: note, size: 28 * k, color: soft, x: Math.round(120 * k), y: Math.round(H - 152 * k), from, to }, `cap${i}b.txt`)] : []),
  ];

  add('-framerate', String(fps), '-i', path.join(turnDir, '%04d.png'));
  const turnCap = spec.turntable_caption ? caption(spec.turntable_caption, spec.turntable_note, 0.6, seg.turntable.seconds - 0.6, 't') : [];
  const look = dark ? ',vignette=angle=PI/4.5' : '';
  chains.push(`[1:v]${norm}${look}${turnCap.length ? ',' + turnCap.join(',') : ''}[c1]`);

  let n = 2;
  if (seg.assemble) {
    add('-framerate', String(fps), '-i', path.join(asmDir, '%04d.png'));
    const sch = P.schedule(parts.length, seg.assemble.seconds);
    const caps = parts.flatMap((p, i) => caption(p.name, p.note, sch.captions[i][0], sch.captions[i][1], i));
    chains.push(`[2:v]${norm}${look}${caps.length ? ',' + caps.join(',') : ''}[c2]`);
    n = 3;
  }

  // End card: the last frame of the product, blurred; the end line centred, the lines under it, a fade to black.
  const lastDir = seg.assemble ? asmDir : turnDir;
  const lastFrames = (seg.assemble || seg.turntable).frames;
  add('-loop', '1', '-framerate', String(fps), '-t', String(seg.end.seconds), '-i', path.join(lastDir, `${String(lastFrames).padStart(4, '0')}.png`));
  const ey = Math.round(H * 0.38);
  const end = [
    `gblur=sigma=${Math.round(26 * k)}`, `drawbox=x=0:y=0:w=iw:h=ih:color=${veil}:t=fill`,
    T({ text: spec.end || spec.title || '', bold: true, size: 84 * k, color: ink, x: '(w-text_w)/2', y: ey, from: 0.3 }, 'end.txt'),
    P.box({ x: (W - 150 * k) / 2, y: ey + 112 * k, w: 150 * k, h: 7 * k, color: accent, from: 0.5 }),
    ...(spec.end_lines || []).map((l, i) => T({ text: l, size: (i ? 28 : 34) * k, color: i ? soft : ink, x: '(w-text_w)/2', y: Math.round(ey + (150 + i * 50) * k), from: 0.7 + i * 0.15 }, `endl${i}.txt`)),
    `fade=t=out:st=${Math.max(0, seg.end.seconds - 0.8).toFixed(3)}:d=0.8`,
  ];
  chains.push(`[${n}:v]${norm},${end.join(',')}[c${n}]`);

  // Crossfades, each starting `fade` before the previous shot ends.
  let last = 'c0';
  plan.list.slice(1).forEach((s, i) => {
    const outLabel = i === plan.list.length - 2 ? 'v' : `x${i}`;
    chains.push(`[${last}][c${i + 1}]xfade=transition=fade:duration=${plan.fade}:offset=${s.start.toFixed(4)}[${outLabel}]`);
    last = outLabel;
  });
  const graph = write(work, 'edit.ffgraph', chains.join(';\n'));
  return [ '-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex_script', graph, '-map', '[v]',
    '-t', String(plan.duration), '-r', String(fps), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(spec.crf || 18),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out ];
}

module.exports = { args };
