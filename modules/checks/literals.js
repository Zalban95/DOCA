'use strict';

/**
 * A value typed twice (checks/, `{literals: "<spec or template>"}`; parametric projects): a number or a text in a spec
 * equal to a parameter's value that is not a `${…}` — the drawing that measures 200 while the part is built from
 * tab_w. Change the parameter and the spec stays behind; no other check would see it. The parameters are the nearest
 * project.params.json at or above the spec. Numbers 0 and ±1 are left out (every spec has them), and a number inside a
 * text only when it has two digits or more.
 */
const fs = require('fs');
const path = require('path');

function normalize(c) { return { literals: String(c.literals).slice(0, 500) }; }

function paramsNear(abs) {
  const pf = require('../params/file');
  for (let d = path.dirname(abs); ; d = path.dirname(d)) {
    const f = pf.read(d);
    if (f.exists) return f.doc ? pf.effective(f.doc) : null;
    if (path.dirname(d) === d) return null;
  }
}

/** [{at, value, param}] for every leaf that repeats a parameter's value. */
function find(spec, values) {
  const nums = Object.entries(values).filter(([, v]) => typeof v === 'number' && ![0, 1, -1].includes(v));
  const texts = Object.entries(values).filter(([, v]) => typeof v === 'string' && v.trim().length >= 3);
  const out = [];
  const walk = (v, at) => {
    if (typeof v === 'number') { for (const [n, x] of nums) if (v === x) out.push({ at, value: v, param: n }); return; }
    if (typeof v === 'string') {
      if (v.includes('${')) return;
      for (const [n, x] of texts) if (v === x || v.includes(x)) out.push({ at, value: x, param: n });
      for (const [n, x] of nums) {
        if (String(Math.abs(x)).replace('.', '').length < 2) continue;
        const re = new RegExp(`(^|[^\\d.])${String(x).replace('.', '\\.')}(?![\\d]|\\.\\d)`);
        if (re.test(v)) out.push({ at, value: x, param: n });
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
  };
  walk(spec, '');
  return out;
}

async function check(c, abs) {
  let spec;
  try { spec = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return { ok: false, why: `not JSON: ${e.message}` }; }
  const values = paramsNear(abs);
  if (!values) return { ok: false, why: `no ${require('../params/file').NAME} at or above it to compare with` };
  const hits = find(spec, values);
  if (!hits.length) return { ok: true, why: 'no parameter\'s value is typed into it' };
  return { ok: false, why: `${hits.length} value${hits.length === 1 ? '' : 's'} typed in instead of the parameter: `
    + `${hits.slice(0, 10).map(h => `${h.at || '(top)'} = ${JSON.stringify(h.value)} (\${${h.param}})`).join('; ')}${hits.length > 10 ? '; …' : ''}` };
}

module.exports = { normalize, check, find };
