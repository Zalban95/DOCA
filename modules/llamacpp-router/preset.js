'use strict';

/**
 * A llama.cpp router's preset file (its `--models-preset`), edited from the panel (asked 2026-10-12: "let the llama
 * settings be reachable from the panel"). The router serves each `[section]` as a model; `[*]` is what every model
 * shares. Only the keys in KEYS are read into the form and written, each checked by its shape — a preset's key is a
 * llama-server argument, and an open list would let a form start anything — and every other line, comments included,
 * stays as it was. A save keeps the file it replaced beside it (`.bak-<time>`, the last five).
 */
const fs = require('fs');
const path = require('path');

const num = (min, max) => v => /^-?\d+$/.test(v) && +v >= min && +v <= max;
const oneOf = (...xs) => v => xs.includes(v);
const gguf = v => /\.gguf$/i.test(v) && path.isAbsolute(v) && fs.existsSync(v);
const KEYS = {
  'model': { check: gguf, label: 'Model file', hint: 'The .gguf file this model runs (a full path on this machine).' },
  'mmproj': { check: gguf, label: 'Vision projector', hint: 'The model\'s mmproj .gguf, so it reads pictures. Empty: it reads none.' },
  'ctx-size': { check: num(512, 4194304), label: 'Context size', hint: 'Tokens the model holds at once. More costs graphics memory: the cache per token depends on the model and the cache type.' },
  'cache-type-k': { check: oneOf('f32', 'f16', 'bf16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'iq4_nl'), label: 'Cache type (K)', hint: 'How the context cache is stored: q8_0 halves f16\'s memory at almost no loss; q4_0 halves it again with some.' },
  'cache-type-v': { check: oneOf('f32', 'f16', 'bf16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'iq4_nl'), label: 'Cache type (V)', hint: 'As the K cache, for the values; usually the same.' },
  'n-gpu-layers': { check: v => v === 'auto' || num(0, 999)(v), label: 'GPU layers', hint: 'How many layers go on the graphics cards: 999 all, 0 none, auto as llama.cpp decides.' },
  'fit': { check: oneOf('on', 'off'), label: 'Spill to RAM', hint: 'on: llama.cpp keeps on the cards what fits and the rest in RAM (slower by what spills); off: everything on the cards or it fails.' },
  'split-mode': { check: oneOf('none', 'layer', 'row'), label: 'Split across cards', hint: 'layer: whole layers per card (the usual); row: each layer split; none: one card.' },
  'parallel': { check: num(1, 32), label: 'Parallel requests', hint: 'Requests answered at once; each holds its own share of the context.' },
  'sleep-idle-seconds': { check: num(-1, 604800), label: 'Sleep after (seconds idle)', hint: 'Frees the cards after this long with no request, and loads again on the next one. -1 never.' },
  'load-on-startup': { check: oneOf('true', 'false'), label: 'Load when the router starts', hint: 'Load this model as soon as the router starts, rather than at its first request.' },
  'flash-attn': { check: oneOf('on', 'off', 'auto'), label: 'Flash attention', hint: 'Faster attention where the card supports it; needed for a quantized V cache.' },
  'jinja': { check: oneOf('true', 'false'), label: 'Its own chat template', hint: 'Use the GGUF\'s chat template (--jinja): what makes tool calls work for most models.' },
  'reasoning-format': { check: oneOf('none', 'deepseek', 'auto'), label: 'Thinking format', hint: 'How a thinking model\'s reasoning is returned: deepseek keeps it apart from the answer.' },
};

/** The preset file: the setting, else the running router's --models-preset (Linux), else null. */
function find() {
  const set = require('../settings-schema').value('llamacpp.routerPreset');
  if (set) return set;
  if (process.platform !== 'linux') return null;
  try {
    for (const pid of fs.readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
      let argv;
      try { argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); } catch { continue; }
      if (!/llama-server$/.test(argv[0] || '')) continue;
      const i = argv.indexOf('--models-preset');
      if (i >= 0 && argv[i + 1]) return argv[i + 1];
    }
  } catch { /* no /proc */ }
  return null;
}

const KEY_LINE = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/;
const SECTION = /^\s*\[([^\]]+)\]\s*$/;

/** {sections: [{name, values: {key: value}, others: [keys not in the form]}]} */
function parse(text) {
  const sections = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.match(SECTION);
    if (s) { cur = { name: s[1].trim(), values: {}, others: [] }; sections.push(cur); continue; }
    if (!cur || /^\s*[;#]/.test(line)) continue;
    const k = line.match(KEY_LINE);
    if (!k) continue;
    if (KEYS[k[1]]) cur.values[k[1]] = k[2]; else cur.others.push(k[1]);
  }
  return { sections };
}

/** The text with `values` set in `section` (an empty value removes the key); throws on a key or value it does not take. */
function edit(text, section, values) {
  for (const [k, v] of Object.entries(values || {})) {
    if (!KEYS[k]) throw Object.assign(new Error(`${k} is not a setting this form changes.`), { status: 400 });
    if (v !== '' && v != null && !KEYS[k].check(String(v).trim())) throw Object.assign(new Error(`${KEYS[k].label}: "${v}" is not a value it takes${k === 'model' || k === 'mmproj' ? ' (a .gguf file that exists here, as a full path)' : ''}.`), { status: 400 });
  }
  const lines = String(text).split(/\r?\n/);
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].match(SECTION);
    if (!s) continue;
    if (start >= 0) { end = i; break; }
    if (s[1].trim() === section) start = i;
  }
  if (start < 0) throw Object.assign(new Error(`The preset has no [${section}].`), { status: 404 });
  const body = lines.slice(start + 1, end);
  const todo = { ...values };
  if (todo.mmproj) todo['no-mmproj'] = null;   // a projector named: the "no projector" line goes
  const out = [];
  for (const line of body) {
    const k = !/^\s*[;#]/.test(line) && line.match(KEY_LINE);
    if (k && k[1] in todo) {
      const v = todo[k[1]]; delete todo[k[1]];
      if (v !== '' && v != null) out.push(`${k[1].padEnd(16)} = ${String(v).trim()}`);
      continue;
    }
    out.push(line);
  }
  let tail = out.length; while (tail > 0 && !out[tail - 1].trim()) tail--;
  const added = Object.entries(todo).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k.padEnd(16)} = ${String(v).trim()}`);
  const next = [...out.slice(0, tail), ...added, ...out.slice(tail)];
  return [...lines.slice(0, start + 1), ...next, ...lines.slice(end)].join('\n');
}

/** Reads the file and its sections, for the form. */
function read(file = find()) {
  if (!file) return { file: null, why: 'No llama.cpp router with a preset file was found running here. Name its file in the setting llamacpp.routerPreset.' };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { file, why: `Cannot read it: ${e.message}` }; }
  return { file, ...parse(text), keys: Object.fromEntries(Object.entries(KEYS).map(([k, d]) => [k, { label: d.label, hint: d.hint }])) };
}

/** Writes `values` into `section`, keeping the replaced file beside it. */
function save(section, values, file = find()) {
  if (!file) throw Object.assign(new Error('No preset file: name it in llamacpp.routerPreset.'), { status: 404 });
  const before = fs.readFileSync(file, 'utf8');
  const after = edit(before, section, values);
  if (after === before) return { file, changed: false };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  fs.writeFileSync(`${file}.bak-${stamp}`, before);
  const dir = path.dirname(file), base = path.basename(file);
  const old = fs.readdirSync(dir).filter(f => f.startsWith(`${base}.bak-`)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 5))) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* kept */ } }
  fs.writeFileSync(file, after);
  return { file, changed: true, backup: `${file}.bak-${stamp}` };
}

module.exports = { KEYS, find, parse, edit, read, save };
