---
name: make-images
description: Make a picture from a description on this hub's own image service, ComfyUI, through its API — no page opened, the file written where it is needed and shown. Which service (ComfyUI, the suggested one; Stable Diffusion WebUI is the older alternative), what it needs (a checkpoint), the script that runs a text-to-image workflow or a person's own exported workflow, and how to get better pictures than the starter model gives. Use whenever someone asks to generate, draw or render an image, an illustration, a texture, a concept or a mock-up from words.
triggers: [generate an image, make an image, make a picture, draw, illustration, render an image, text to image, comfyui, stable diffusion, concept art, mockup, texture, genera un'immagine, disegna]
---

# Making images

The hub's image service is **ComfyUI** (a Services row, Field → Models → Inference Services): actively developed, it
runs the current open models (Flux, Qwen-Image, SDXL and newer) and every job is a workflow in JSON, so what worked runs
again exactly. **Stable Diffusion WebUI** (AUTOMATIC1111, the `sdwebui` row) is the older alternative: in maintenance
since its last release in July 2024, with no Flux or newer models — use it only when it is what the person runs.

## 1. Is it there

- `GET <comfyui>/system_stats` answers: it runs (default address `http://127.0.0.1:8188`).
- Not running: start it as a service (`hub_command`, or the Services tab's ▶). Not installed: `install_propose`
  `{kind: "service", id: "comfyui"}` — a person's click installs it.
- `GET <comfyui>/models/checkpoints` lists its models. Empty: it can serve but draw nothing — a model is needed first.

## 2. Make the picture

```
node skills/make-images/scripts/comfy-image.js --prompt "<what to draw>" --negative "<what to avoid>" \
  --width 1024 --height 1024 --steps 25 --out <where it belongs>/image.png
```

It sends a text-to-image workflow, waits for ComfyUI to finish, writes the file and prints where. A refusal says
ComfyUI's own words (a missing checkpoint names the ones it has). Then `show_media` the file.

- **Size**: an SD 1.5 model draws best at 512×512, SDXL and newer at about 1024×1024; other shapes keep the same area.
- **A person's own workflow** (exported from ComfyUI with "Save (API)"): `--workflow file.json`; the flags fill its
  checkpoint loader, text encoders, latent size and sampler.
- **Same picture again**: pass the `--seed` the person liked.

## 3. Better pictures

The starter checkpoint of an install is often an old SD 1.5 model — soft and generic. A newer model (an SDXL, Flux or
Qwen-Image family checkpoint) is far better and several gigabytes: which one, and its licence, are the person's choice.
Say so once, suggest one that fits the card (`machine_fit` says how much GPU memory there is), and put it in ComfyUI's
`models/checkpoints` folder only after they agree. A model whose loader is not CheckpointLoaderSimple (Flux's separate
UNet, CLIP and VAE files) needs its own workflow: export one from ComfyUI's templates and pass `--workflow`.

## 4. Keep what worked

A prompt and settings the person liked, for a kind of picture they will ask for again (product shots, icons, textures),
are a recipe (`recipe` save_last) — with the seed when they want the same look.
