---
name: craft-apps
description: Make and edit creative work — images, vectors, video, photos, PDFs, motion graphics, page layouts, documents, audio, slides, CAD drawings, spreadsheets — with the open-source Craft App Suite, each app an MCP server that does what its menus do. Use when the person asks to edit a picture, cut a video, lay out a page, build slides, fix a PDF, mix audio, draw in CAD or work a spreadsheet, and one of these apps is installed or welcome.
triggers: [photocraft, vectorcraft, filmcraft, lightcraft, pdfcraft, effectcraft, designcraft, wordcraft, soundcraft, deckcraft, cadcraft, gridcraft, artcraft, craft app]
---

# The Craft App Suite

Twelve open-source desktop apps (ArtCraft, Apache-2.0, github.com/storytold), each built on one registry of hundreds of
commands that its menus, its CLI and its MCP server all call — so whatever a person can click, you can do, exactly.
They are a suggestion, never a requirement: a person or a company may prefer other tools, and their way wins (ask once
if it is not clear, then keep the answer in memory). When a person asks what to use for a job, name the choices side
by side — open or proprietary (Office, Adobe, Google's, LibreOffice, GIMP, Blender, these apps…), each said for what it
is (open source, free, paid, widely used) — and never push one; Field → MCP → "Software for a job" shows the same list
with Connect for what is here or an account, Install, or the maker's download page.

| For | App | Server (catalogue id) |
|---|---|---|
| Edit an image: layers, masks, type, filters, PSD | PhotoCraft | `photocraft` |
| Vector illustration, SVG | VectorCraft | `vectorcraft` |
| Cut, trim, grade, mix and export video | FilmCraft | `filmcraft` |
| A photo library, raw development | LightCraft | `lightcraft` |
| Read, combine, split, protect PDFs | PdfCraft | `pdfcraft` |
| Motion graphics and effects | EffectCraft | `effectcraft` |
| Page layout and publishing | DesignCraft | `designcraft` |
| Documents | WordCraft | `wordcraft` |
| Record and edit audio | SoundCraft | `soundcraft` |
| Slides | DeckCraft | `deckcraft` |
| CAD drawings | CADCraft | `cadcraft` |
| Spreadsheets and data | GridCraft | `gridcraft` |

## Getting one ready (once)

1. Is it here? `mcp_status` lists servers; the MCP tab's catalogue folds these under "Craft App Suite" and says which
   are installed (the app's CLI, `<app>-cli`, comes with the app).
2. Not installed: propose it — the person installs the app with the ArtCraft Launcher (getartcraft.com/download) or the
   app's own release, on the machine that should run it. Never download and run an installer through `shell` yourself.
3. Not added: `install_propose {kind: "mcp", id: "<app>"}` — a person's click adds it (off), with the command fixed.
4. `mcp_connect {server: "<app>", action: "start"}`, then read its tools: each is a command with typed parameters.

## Templates for the jobs that need taste

Some results are judged by their craft as much as their content, and a template carries that so it does not depend on
the model doing the work — read its skill and fill its spec instead of starting from a blank file:

- **A technical drawing** of a part (sheet, title block, views that never overlap, real dimensions in CADCraft): the
  technical-drawing skill, recipe `technical-drawing`.
- **A product promo video** (studio, turntable, the parts coming together, title and end cards), rendered in the
  background by Blender: the product-video skill, recipe `product-video`.
- **A part to 3D-print** (walls, M3 clearances, keyholes, bed fit, orientation): the printable-part skill.
- **A FreeCAD script** (headless, its exports): the freecad-modelling skill first — scripts that fail loudly, exports
  that are not empty; and `check_output {kind: "fit"}` when the parts hold something.

## Doing the work

- Work on files: open from a path, save to a path in the conversation's project or the workspace, then show the result
  with `show_media` (a picture, a video, a PDF) — the person sees it at once.
- Find the command before guessing it: the server's tools describe themselves, and `<app>-cli commands` lists every
  command id (`shell`, read-only) when a tool you need is not obvious.
- Repeat it as a recipe: a sequence that worked (sharpen, curves, export) is `recipe save_last`, so the next folder of
  images runs without the thinking.
- Headless by default: the server runs the app's engine with no window. When the person wants to watch or take over, they
  start the app with a control port (`<app> --control <port>`) and the server is added again with `mcp --connect <port>`
  (an MCP server they add in the MCP tab, as it is a command the catalogue does not hold) — then your commands move the
  open app on their screen.
- Several apps in one job (a poster: PhotoCraft for the image, DesignCraft for the page, PdfCraft for the print file):
  hand each its own step and pass files between them; a long one goes to a work chat.
