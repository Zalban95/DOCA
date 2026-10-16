---
name: video-from-code
description: Make videos and motion graphics from code with Remotion (React components rendered to MP4) — say its licence first and ask once, install it inside the project or an agents' computer, never into the hub, render, and show the result. Names the open alternatives (ffmpeg, Blender, a recorded HTML animation) for when the licence does not suit.
triggers: [remotion, video from code, motion graphics, animated video, explainer video, intro video, render a video, video con codice, animazione, grafica animata, video animato]
---

# Videos from code with Remotion

Remotion writes a video as React components — each frame is a page, rendered by a headless Chromium and joined by
ffmpeg into an MP4 or WebM. It suits titles, explainers, data that moves, captions, the same video in many versions.
It is a suggestion, never a requirement: the person's own tool wins, and Field → MCP → "Software for a job" (Motion
graphics and effects) lists the others side by side. A promo of a 3D-modelled product (parts turning and coming
together) is the product-video skill's template, with Blender.

## 1. The licence, first — and ask once

Before installing anything, say it plainly, in the person's language:

- Remotion is **free for individuals and for companies of up to 3 people** (and for non-profits).
- **A company of 4 or more people needs a paid Remotion Company licence.**
- The terms are Remotion's own and can change: https://www.remotion.dev/license is the source.

Then ask once which applies to them (or whether they would rather use an open alternative, below), and keep the
answer with `memory_write` (for example `remotion licence: individual, free — asked 2026-10-14`). Next time,
`memory_search` for "remotion" first and do not ask again unless their situation changed. Never decide for them that
a company "probably" fits, and never buy or accept a licence on their behalf.

## 2. Where it runs: the project, or an agents' computer — never the hub

Remotion is an npm package that belongs to one project, like any dependency. Install it **inside the project's
folder** with npm, never globally and never into the folder this hub itself runs from.

- **In a project** (`project` with `info` says where its root is): a new video project is
  `npx create-video@latest <name>` in the folder the person chose; an existing React project gets
  `npm install remotion @remotion/cli` there. Add its commands to the project (`project` `run` then runs `render` by
  name), so the next render needs no thinking.
- **In an agents' computer** (the `computer` tool), when the person does not want it on this machine or the render is
  heavy: the same commands through `mcp__computer-<id>__shell`; the video comes back with `computer` `get`.

**What rendering needs.** A Chromium and ffmpeg. Remotion fetches its own Chrome Headless Shell the first time it
renders (`npx remotion browser ensure` does it ahead of time) and ships its own ffmpeg — so nothing system-wide is
needed. If the download is blocked, say so; the System tools row `ffmpeg` is there for the ffmpeg-only route below.

## 3. Make it

1. Agree what the video says, how long (seconds × frame rate = frames), its size (1920×1080, 1080×1920 for a phone,
   1080×1080) — one short question when it is not clear.
2. Write the composition: one component per scene, timing from `useCurrentFrame()` and `interpolate()` / `spring()`,
   scenes in `<Sequence>`; text, colours and data as props, so a second version is a different input, not new code.
3. Preview a still before the whole thing: `npx remotion still <id> --frame=<n> out.png`, and show it with
   `show_media`. Fix what is wrong before spending a full render.
4. Render: `npx remotion render <id> out/video.mp4` (in the background for anything long: follow it with `shell_job`).
5. Show the result with `show_media`; say its length, size and where the file is.
6. When it worked, keep it: `recipe save_last` for the render, so the next version is one call.

## When Remotion does not suit — the open alternatives

- **ffmpeg** (System tools row `ffmpeg`; `install_propose {kind: "tool", id: "ffmpeg"}` when it is missing): cuts,
  joins, titles and captions burned in (`drawtext`, `subtitles`), a slideshow from pictures, format changes. Enough for
  most simple edits, with no licence question.
- **Blender**: 3D motion, camera moves, product shots — scripted with its Python, rendered headless
  (`blender -b scene.blend -a`).
- **A plain HTML/CSS (or canvas) animation, recorded**: write the page, open it in an agents' computer
  (`mcp__computer-<id>__browser_open`), and record the screen with `mcp__computer-<id>__record_start` and
  `mcp__computer-<id>__record_stop`; the recording comes back as an attachment. Trim it with ffmpeg.

Say which you chose and why in one line, and keep the person's preference in memory like the licence answer.
