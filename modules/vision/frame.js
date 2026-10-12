'use strict';

/**
 * A vision model sees a picture at the size its own encoder takes, and answers positions in that picture — not in the
 * screen's pixels (2026-10-12: two models put a button of an 824×1800 screenshot at y≈960, its real centre 1730). So the
 * reader sends a picture of a size it states — shrunk by a whole factor until its longer side is at most
 * `vision.maxSide` — tells the model that size, and scales every position in the answer back by the same factor.
 */
const png = () => require('../machines/png');

/** {png, k, width, height, screen: {width, height}}: the picture to send, and the factor its positions are scaled by. */
function frame(buf, maxSide) {
  let img = null;
  try { img = png().fromPng(buf); } catch { img = null; }
  if (!img) return { png: buf, k: 1, width: null, height: null, screen: null };
  const screen = { width: img.width, height: img.height };
  const k = Math.max(1, Math.ceil(Math.max(img.width, img.height) / Math.max(256, maxSide || 1024)));
  if (k === 1) return { png: buf, k, width: img.width, height: img.height, screen };
  const small = png().shrink(img, Math.floor(img.width / k));
  return { png: png().encode(small), k, width: small.width, height: small.height, screen };
}

/** The question with the picture's size, so positions are measured in it. */
const ask = (question, f) => f.width ? `${question}\n\n(The picture is ${f.width}×${f.height} pixels; give positions in it.)` : question;

/** The answer with its positions in the screen's own pixels: "x,y" pairs and "x = …, y = …". */
function back(text, f) {
  if (!f.k || f.k === 1) return text;
  let moved = 0;
  const s = n => { moved++; return String(Math.round(Number(n) * f.k)); };
  const out = String(text)
    .replace(/(\(|\b)(\d{1,4})\s*,\s*(\d{1,4})(\)|\b)/g, (_, a, x, y, b) => `${a}${s(x)}, ${s(y)}${b}`)
    .replace(/\b([xy])(\s*(?:=|:|≈)\s*)(\d{1,4})\b/gi, (_, axis, op, n) => `${axis}${op}${s(n)}`);
  return moved ? `${out}\n(Positions are in the screen's own pixels, ${f.screen.width}×${f.screen.height}.)` : out;
}

module.exports = { frame, ask, back };
