#!/usr/bin/env node
'use strict';

/**
 * Make an image with ComfyUI from its API, without opening its page: node comfy-image.js --prompt "…" --out file.png
 *
 * Sends a text-to-image workflow (a checkpoint, a positive and a negative prompt, a sampler, a VAE decode, a save) to
 * POST /prompt, waits for GET /history/<id> to list its output, and writes the image from GET /view. One that fails
 * says ComfyUI's own error — a missing checkpoint names the ones it has. Exit 0 with the file written, 1 otherwise.
 *
 * flags: --url (default http://127.0.0.1:8188, or COMFYUI_URL), --prompt, --negative, --width 1024, --height 1024,
 *        --steps 25, --cfg 6, --seed (random), --sampler euler, --scheduler normal, --checkpoint (default: the first it
 *        has), --workflow FILE (an API-format workflow of your own, exported with "Save (API)"; the flags fill nodes
 *        whose class is CheckpointLoaderSimple, CLIPTextEncode, EmptyLatentImage and KSampler), --timeout 600 (seconds)
 */
const fs = require('fs');
const path = require('path');

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return o;
}

const ask = async (base, p, init) => {
  const r = await fetch(new URL(p, base), init);
  const t = await r.text();
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${t.slice(0, 600)}`);
  try { return JSON.parse(t); } catch { return t; }
};

/** The default graph: checkpoint → two text encodes → empty latent → KSampler → VAE decode → save. */
function graph(o, checkpoint) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: o.prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: o.negative || '', clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: +o.width || 1024, height: +o.height || 1024, batch_size: 1 } },
    5: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
      seed: o.seed !== undefined ? +o.seed : Math.floor(Math.random() * 2 ** 32), steps: +o.steps || 25, cfg: +o.cfg || 6,
      sampler_name: o.sampler || 'euler', scheduler: o.scheduler || 'normal', denoise: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'doca' } },
  };
}

/** A workflow of the person's own, with the flags put into its nodes by class. */
function fill(wf, o, checkpoint) {
  const texts = Object.values(wf).filter(n => n.class_type === 'CLIPTextEncode');
  for (const n of Object.values(wf)) {
    if (n.class_type === 'CheckpointLoaderSimple' && o.checkpoint) n.inputs.ckpt_name = checkpoint;
    if (n.class_type === 'EmptyLatentImage') { if (o.width) n.inputs.width = +o.width; if (o.height) n.inputs.height = +o.height; }
    if (n.class_type === 'KSampler') { if (o.seed !== undefined) n.inputs.seed = +o.seed; if (o.steps) n.inputs.steps = +o.steps; if (o.cfg) n.inputs.cfg = +o.cfg; }
  }
  if (o.prompt && texts[0]) texts[0].inputs.text = o.prompt;
  if (o.negative && texts[1]) texts[1].inputs.text = o.negative;
  return wf;
}

async function main() {
  const o = args(process.argv.slice(2));
  const base = o.url || process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
  if (!o.prompt && !o.workflow) throw new Error('Say what to draw: --prompt "…" (or --workflow FILE).');
  if (!o.out) throw new Error('Say where to write it: --out FILE.png');
  const have = await ask(base, '/models/checkpoints').catch(() => []);
  const checkpoint = o.checkpoint || have[0];
  if (!o.workflow && !checkpoint) throw new Error(`ComfyUI at ${base} has no checkpoint: put one in its models/checkpoints folder (Field → Models), or pass --workflow.`);
  if (o.checkpoint && Array.isArray(have) && have.length && !have.includes(o.checkpoint)) throw new Error(`No checkpoint "${o.checkpoint}". It has: ${have.join(', ')}`);
  const wf = o.workflow ? fill(JSON.parse(fs.readFileSync(o.workflow, 'utf8')), o, checkpoint) : graph(o, checkpoint);
  const sent = await ask(base, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'doca-make-images' }) });
  if (sent.node_errors && Object.keys(sent.node_errors).length) throw new Error(`ComfyUI refused the workflow: ${JSON.stringify(sent.node_errors).slice(0, 800)}`);
  const id = sent.prompt_id, until = Date.now() + (+o.timeout || 600) * 1000;
  for (;;) {
    if (Date.now() > until) throw new Error(`No image after ${+o.timeout || 600} s (prompt ${id}): ComfyUI may still be working — its queue is at ${base}/queue.`);
    await new Promise(r => setTimeout(r, 1000));
    const h = (await ask(base, `/history/${id}`))[id];
    if (!h) continue;
    if (h.status?.status_str === 'error') throw new Error(`ComfyUI failed: ${JSON.stringify(h.status.messages || '').slice(0, 800)}`);
    const img = Object.values(h.outputs || {}).flatMap(n => n.images || [])[0];
    if (!img) { if (h.status?.completed) throw new Error('The workflow finished without an image (does it end in a SaveImage node?).'); continue; }
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
    const r = await fetch(new URL(`/view?${q}`, base));
    if (!r.ok) throw new Error(`/view: HTTP ${r.status}`);
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, Buffer.from(await r.arrayBuffer()));
    console.log(`Wrote ${path.resolve(o.out)} (${checkpoint || 'its own workflow'}, prompt ${id}).`);
    return;
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
