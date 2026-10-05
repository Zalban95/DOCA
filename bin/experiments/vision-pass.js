'use strict';

/**
 * `npm run experiment -- vision-pass` (docs/experiments/vision-pass.md): screens drawn with buttons at known places
 * (resvg, already a dependency), and the configured vision model asked for each one's centre. Reports how many land
 * within 25 px, the mean error and the seconds per question. Runs inside bin/doca-experiment.js on its throwaway copy.
 */
const SCREENS = [
  { w: 1280, h: 800, buttons: [['Sign in', 1040, 60], ['New project', 180, 300], ['Delete', 640, 700]] },
  { w: 1280, h: 800, buttons: [['Start', 70, 770], ['Settings', 1200, 400], ['OK', 640, 420]] },
];

function svg(s) {
  const btn = ([label, x, y]) => `<rect x="${x - 70}" y="${y - 20}" width="140" height="40" rx="6" fill="#2b6cb0"/><text x="${x}" y="${y + 6}" font-size="18" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${s.h}"><rect width="100%" height="100%" fill="#f4f4f4"/>${s.buttons.map(btn).join('')}</svg>`;
}

async function measure() {
  const look = require('../../modules/computers/look');
  const { provider, model } = look.settings();
  if (!model) { console.log('No vision model is set (vision.model) on this machine, so nothing can be measured.'); return 0; }
  const render = require('../../modules/api-v1/render');
  const rows = []; let found = 0, n = 0, err = 0, ms = 0;
  for (const s of SCREENS) {
    const png = Buffer.from(await render.svgToPng(svg(s), { w: s.w, h: s.h }));
    for (const [label, x, y] of s.buttons) {
      const t0 = Date.now();
      const answer = await look.ask(png, `Where is the "${label}" button? Answer with its centre as x,y pixels only.`, { provider, model });
      ms += Date.now() - t0; n++;
      const m = /(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/.exec(answer);
      const d = m ? Math.hypot(Number(m[1]) - x, Number(m[2]) - y) : Infinity;
      if (d <= 25) found++;
      if (Number.isFinite(d)) err += d;
      rows.push({ label, expected: [x, y], answer: answer.slice(0, 80), error: Number.isFinite(d) ? Math.round(d) : 'none' });
    }
  }
  console.log(JSON.stringify(rows, null, 2));
  console.log(`\n| ${new Date().toISOString().slice(0, 10)} | ${provider} / ${model} | ${found} of ${n} | ${Math.round(err / Math.max(1, n))} px | ${(ms / n / 1000).toFixed(1)} |`);
  return 0;
}

module.exports = { measure, SCREENS, svg };
