'use strict';

/**
 * A reader made for one question — where on the screen is X — with a model trained to point at things on screens (a
 * GUI grounding model; asked 2026-10-12: "the right tools for the right job unless it is inconvenient by time"). It is
 * `vision.locatorProvider` / `vision.locatorModel`, asked with `vision.locatorPrompt` ({what} is the thing to find),
 * since each such model is trained on its own instruction; the answer's first x,y is the point, scaled back to the
 * screen's own pixels (frame.js). Measured: Holo1.5 7B at Q4_K_M pointed at five controls of a phone screenshot in
 * 0.2–0.5 s each, on or within 30 px of each; a 27B general model took 32 s for one. Nothing here names a model.
 */
const sc = () => require('../settings-schema');

/** "where is the Sign in button?" → true: a question about a position, which auto sends here (vision.locateWhen where). */
const WHERE = /\b(where|locate|position|coordinates?|click|tap|press|point (?:at|to)|find the)\b|\bdove\b|\bclicca\b/i;
const asksWhere = q => WHERE.test(String(q || ''));

/** The thing to find, without the question's own words around it ("where is the X?" → "the X"). */
function what(question) {
  return String(question || '').trim()
    .replace(/^(please\s+)?(where\s+(is|are)|locate|find|click( on)?|tap( on)?|press|point (at|to))\s+/i, '')
    .replace(/[?.!]+$/, '').slice(0, 300) || String(question || '').slice(0, 300);
}

/** The first x,y an answer gives: Click(x, y), [x, y], (x, y), Point(x, y) or "x = …, y = …". */
function pointOf(text) {
  const t = String(text || '');
  const pair = t.match(/[[(]\s*(\d{1,5}(?:\.\d+)?)\s*,\s*(\d{1,5}(?:\.\d+)?)\s*[\])]/) || t.match(/\b(\d{1,5})\s*,\s*(\d{1,5})\b/);
  if (pair) return { x: Number(pair[1]), y: Number(pair[2]) };
  const x = t.match(/\bx\s*[=:]\s*(\d{1,5})/i), y = t.match(/\by\s*[=:]\s*(\d{1,5})/i);
  return x && y ? { x: Number(x[1]), y: Number(y[1]) } : null;
}

const locate = {
  label: 'a locator (a model that points at things on screens)',
  ready: () => !!sc().value('vision.locatorModel'),
  async read(png, question, s, { person } = {}) {
    const provider = sc().value('vision.locatorProvider') || s.provider, model = sc().value('vision.locatorModel');
    if (person?.id && !require('../auth/allot').allowsModel(person, { provider, model }))
      throw Object.assign(new Error(require('../auth/allot').refusal(person, 'model', `${provider}/${model}`)), { status: 403 });
    const F = require('./frame'), f = F.frame(png, sc().value('vision.maxSide'));
    const thing = what(question);
    const prompt = String(sc().value('vision.locatorPrompt') || '{what}').replace(/\{what\}/g, thing);
    const ep = require('../harness/providers').endpoint(provider);
    const t0 = Date.now();
    const r = await fetch(`${ep.baseUrl}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}) },
      body: JSON.stringify({ model, stream: false, temperature: 0, max_tokens: 64, messages: [{ role: 'user', content: [
        { type: 'text', text: F.ask(prompt, f) }, { type: 'image_url', image_url: { url: `data:image/png;base64,${f.png.toString('base64')}` } }] }] }) })
      .catch(e => { throw Object.assign(new Error(`${ep.label}: cannot reach ${ep.baseUrl} (${e.message})`), { status: 502 }); });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`${ep.label} / ${model}: ${j.error?.message || j.error || `HTTP ${r.status}`}`), { status: 502 });
    const p = pointOf(j.choices?.[0]?.message?.content);
    if (!p) return { text: `${model} gave no position for ${thing}.`, points: [], by: model, none: true };
    const x = Math.round(p.x * f.k), y = Math.round(p.y * f.k);
    return { text: `${thing}: at ${x},${y} (screen pixels${f.screen ? `, of ${f.screen.width}×${f.screen.height}` : ''}).`,
      points: [{ label: thing, x, y }], by: `${model}, ${Date.now() - t0} ms` };
  },
};

module.exports = { locate, asksWhere, what, pointOf };
