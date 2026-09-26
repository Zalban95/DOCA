// A guard model's own process (modules/harness/guard/runtime.js). It loads
// transformers.js from DOCA's data folder and answers JSON lines on stdin:
//   { id, model: <folder>, dtype, texts: [..] } -> { id, results: [{ label, score }] } | { id, error }
// A separate process so a model's memory, and any crash, stay out of the panel.
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline';

const runtime = process.argv[2];
const require = createRequire(path.join(runtime, 'package.json'));
const { pipeline, env } = await import(require.resolve('@huggingface/transformers'));
env.allowRemoteModels = false;
const loaded = new Map();

async function classifier(dir, dtype) {
  const key = `${dir}|${dtype}`;
  if (!loaded.has(key)) {
    env.localModelPath = path.dirname(dir) + path.sep;
    loaded.set(key, pipeline('text-classification', path.basename(dir), dtype ? { dtype } : {}));
  }
  return loaded.get(key);
}

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  try {
    const clf = await classifier(m.model, m.dtype);
    const results = [];
    for (const t of m.texts) { const [r] = await clf(t, { truncation: true }); results.push(r); }
    process.stdout.write(JSON.stringify({ id: m.id, results }) + '\n');
  } catch (e) { process.stdout.write(JSON.stringify({ id: m.id, error: String(e.message || e).slice(0, 300) }) + '\n'); }
});
process.stdout.write(JSON.stringify({ ready: true }) + '\n');
