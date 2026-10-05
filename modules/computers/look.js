'use strict';

/**
 * A look at a computer's screen (TODO H5.6; docs/experiments/vision-pass.md). Some screens have no accessibility tree
 * worth reading — a canvas app, a remote desktop, a game, an image — and browser_snapshot finds nothing to number.
 * `computer_look` takes the screen as it is and has it read by one of the hive's readers (modules/vision: a vision
 * model, a Roboflow detector, Tesseract's text, OpenCV template matching), answering with what is there and where —
 * pixel coordinates for desktop_click. An experiment (`experiments.visionPass`); the reader is the owner's to choose
 * and to replace. What it reads is a screen others wrote, so the answer reaches the agent framed (harness/untrusted.js).
 */
const vision = require('../vision');

const on = () => require('../experiments').on('visionPass') && vision.anyReady();

/** Kept for the measurement (bin/experiments/vision-pass.js): a vision model asked about a PNG. */
async function ask(png, question, s) {
  const r = await vision.BACKENDS.model.read(png, question, { ...vision.settings(), ...(s || {}) });
  return r.text;
}

async function look({ computer, question, how, template }) {
  if (!on()) return 'Error: the vision pass is an experiment that is off, or no reader is set up (Settings → Developer; Settings → Harness → Vision).';
  if (!String(question || '').trim() && !template) return 'Error: say what to look for.';
  const png = await require('./index').screen(String(computer || ''));
  try { return vision.say(await vision.read(png, question, { how: how || 'auto', template })); }
  catch (e) { return `Error: ${e.message}`; }
}

const settings = () => vision.settings();

module.exports = { on, ask, look, settings, SYSTEM: vision.SYSTEM };
