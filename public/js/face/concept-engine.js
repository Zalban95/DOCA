/* Concepts the face can show (asked 2026-10-05): when the voice is about to say a word that names something — snow,
   fire, music, a heart — the dots gather into its silhouette, in a colour that carries its meaning (cold blue, hot
   red), for a moment, then flow back into the face. The library is data (face/concepts/*.js, FACE_CONCEPTS: a glyph,
   a colour and the words in English and Italian); a glyph is drawn on a small hidden canvas and its pixels become the
   dots' seats, so any emoji or symbol the device can draw is a shape, with no artwork to make. */
const _faceGlyphCache = new Map();
let _faceConceptWords = null;

/** A glyph's silhouette as [x, y] seats in face units (about -0.9…0.9), or null when this device cannot draw it. */
function faceGlyphPoints(glyph, n = 260) {
  if (_faceGlyphCache.has(glyph)) return _faceGlyphCache.get(glyph);
  let pts = null;
  try {
    const S = 96, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.font = `${Math.round(S * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol","Noto Sans Symbols 2",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.fillText(glyph, S / 2, S / 2 + S * 0.04);
    const px = g.getImageData(0, 0, S, S).data, all = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (px[(y * S + x) * 4 + 3] > 110) all.push([x, y]);
    if (all.length >= 40) {
      const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
      const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
      // An even grid over the silhouette (random picks clump and leave holes), thinned to about n seats.
      const stride = Math.max(1, Math.floor(Math.sqrt(all.length / n)));
      const grid = all.filter(p => p[0] % stride === 0 && p[1] % stride === 0);
      const rnd = _faceRand(glyph.codePointAt(0));
      for (let i = grid.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [grid[i], grid[j]] = [grid[j], grid[i]]; }
      pts = Array.from({ length: n }, (_, i) => { const p = grid[i % grid.length]; return [(p[0] - mx) / span * 1.7, (p[1] - my) / span * 1.7]; });
    }
  } catch { /* no canvas here: no shape */ }
  _faceGlyphCache.set(glyph, pts);
  return pts;
}

/** The first concept `text` names (whole words, any case or accent), or null. */
function faceConceptFor(text) {
  if (typeof FACE_CONCEPTS === 'undefined' || !text) return null;
  if (!_faceConceptWords) {
    _faceConceptWords = new Map();
    for (const c of FACE_CONCEPTS) for (const w of [...(c.words?.en || []), ...(c.words?.it || [])]) if (!_faceConceptWords.has(w)) _faceConceptWords.set(w, c);
  }
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = norm(String(text)).split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  let weak = null;   // a time word ("tomorrow") shows only when nothing more concrete is named
  for (let i = 0; i < words.length; i++) {
    const three = i + 2 < words.length ? `${words[i]} ${words[i + 1]} ${words[i + 2]}` : null;
    const two = i + 1 < words.length ? `${words[i]} ${words[i + 1]}` : null;   // "ice cream" before "ice"
    const hit = (three && _faceConceptWords.get(three)) || (two && _faceConceptWords.get(two)) || _faceConceptWords.get(words[i]) || _faceConceptWords.get(words[i].replace(/'s$/, ''));
    if (hit && !hit.weak) return hit;
    if (hit) weak = weak || hit;
  }
  return weak;
}

/** About to say `text` (for `sec` seconds): the faces on this page show the concept it names, if any. */
function faceConceptSay(text, sec = 2) {
  const c = faceConceptFor(text);
  if (!c) return null;
  const pts = faceGlyphPoints(c.glyph);
  if (!pts) return null;
  const ms = Math.max(2600, Math.min(4500, sec * 1200));   // long enough for the image to land (asked 2026-10-06)
  // A face whose spec switched concepts off (Settings → Voice → The face) stays itself.
  for (const f of [typeof _faceCorner !== 'undefined' && _faceCorner?.face, typeof _assistant !== 'undefined' && _assistant?.face])
    if (f?.shape && f.spec?.concepts !== false) f.shape(pts, c.color, ms);
  return c;
}
