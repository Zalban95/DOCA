---
name: product-video
description: Make a polished product promo video from 3D parts (STL, OBJ, PLY, GLB) — studio lighting, a turntable shot, the parts coming together one by one with their names, title and end cards, crossfades, an exact duration — rendered by Blender as a background job so it survives the turn. Use when the person asks for a promo, a product video, a turntable, an assembly or exploded animation, or a showcase of something they designed.
triggers: [promo video, product video, turntable, exploded view, assembly animation, showcase video, render video, video promozionale]
recipes: [product-video]
---

# A product video from parts

A template does the directing: a dark (or light) studio, three-point light, the product turning, the parts settling
into place in the order you list them — each named in a caption — a title card and an end card in one style, cut to
the second. You write the spec: the parts, their names and colours, and the words. Do not build a Blender scene by
hand for this; that is where these videos turn plain or glitchy. (Motion graphics with no 3D model — titles, an
explainer, data that moves — are the video-from-code skill.)

## What it needs (check once)

- **Blender** 4.2 or later (headless) and **ffmpeg** (with drawtext, as every usual build has). Missing: propose them
  with `install_propose {kind: "tool"}` when System tools has a row, else ask the person.
- The parts as files: STL, OBJ, PLY, GLB/GLTF — the same files that get printed. A thing the parts hold (a tablet, a
  board) can be a plain box: `{"box": [w, d, h], "offset": [...]}` in millimetres.

## Doing it

1. Write the spec beside the parts (paths are relative to the spec file).
2. Check the plan: `node <this skill's folder>/scripts/promo.js plan <spec>` — the shots and when each part moves.
3. Start it: `recipe {action: "run", id: "product-video", values: {spec: "<the spec file>"}}` — or `shell` with
   `background: true` and `node <…>/promo.js start <spec>`. Either way it is a background job: it returns at once with
   the job id, keeps going after the turn ends, and `shell_job` sees it (status, output, stop). Never start the
   render any other way — a render no job holds runs unseen and nobody can stop it.
4. Wait: `node <…>/promo.js wait <spec> --timeout 1500` (exit 0 done, 1 failed, 2 still running — then call it again),
   `promo.js status <spec>`, or `shell_job status`. At 1080p with EEVEE expect a few minutes on a GPU. To stop it,
   `shell_job stop` with its id: Blender goes with it and the marker says it was stopped.
5. Look at it before you hand it over: take a frame every 2 s (`ffmpeg -ss <t> -i <video> -frames:v 1 <png>`) and look
   at them; then `show_media` the video. A wrong colour or a caption that says the wrong thing is a spec change and
   a run again — shots already rendered with the same scene are kept, so changing only words re-cuts in seconds.

## The spec

```json
{
  "out": "video/promo_1080p.mp4",
  "title": "Tablet Wall Mount",
  "subtitle": "Two printed parts for a 200 × 125 × 8 mm tablet",
  "details": ["3 mm walls", "M3 screws", "USB-C slot"],
  "end": "Print it. Screw it. Hang it.",
  "end_lines": ["STL + STEP + drawings", "PETG or PLA · no supports"],
  "duration": 20, "resolution": "1080p", "style": "dark", "accent": "#ff7a2f",
  "rotate": [62, 0, 0],
  "parts": [
    { "path": "print/back_tray.stl", "name": "Back tray", "note": "keyholes · USB-C slot", "color": "#d6d9de" },
    { "box": [200, 125, 8], "offset": [-100, -62.5, 3], "name": "Your tablet", "color": "#1d2228" },
    { "path": "print/bezel.stl", "offset": [0, 0, 13], "name": "Front bezel", "note": "5 mm lip", "color": "#ff7a2f" }
  ]
}
```

- **Parts in assembly order**: the first stays, each next one settles onto it. Their files may be in print
  orientation — `offset` (mm) and `rotation` (degrees XYZ) put each where it sits in the assembled product. The
  parts come together along "explode_axis" (default the parts' own +Z).
- `rotate` turns the whole product for the camera (a wall mount tilted toward the viewer: `[60, 0, 0]`). The camera
  frames it by itself; `elevation`, `azimuth`, `lens` only when asked.
- `style` `dark` or `light`; `accent` is the one colour of the cards, captions and highlights — give the hero part the
  same one. Default colours follow the list order: light grey, the accent, blue, green.
- `duration` (s, exact), `resolution` `720p` | `1080p` | `4k` | `square` | `vertical` | `[w, h]`, `fps` (30).
- `engine` `eevee` (default, quick) or `cycles` (slower, finer light; `samples`). "turn_degrees" (270).
- "turntable_caption" / "turntable_note" caption the turntable; "font_bold" / "font_regular" choose the cards' faces
  (default: Lato, else DejaVu Sans or Liberation Sans on Linux, Arial on macOS, Segoe UI on Windows).

## Checklist before handing it over

- The duration is what was asked (the marker says it); the first and last frames fade from and to black.
- Every part is named as it arrives, in the person's words, and the names match the drawings.
- The product fills the frame on the turntable; no part passes through another as it settles.
- The text is readable on a phone: short title, a subtitle, at most five details.
- Leave no render running: `promo.js status` says done or failed. The frames stay in `<video>.work` so a word change
  re-cuts quickly; delete that folder when the person is happy.
