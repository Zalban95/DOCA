---
name: technical-drawing
description: Make a clean, dimensioned technical drawing (PDF + DXF) of a part from its STEP or STL — standard sheet, title block, notes, hole table, front/side/section/isometric views and a detail, laid out so nothing overlaps. Use when the person asks for drawings, blueprints, a drawing sheet, dimensions or a PDF of a part they designed or printed.
triggers: [technical drawing, drawing sheet, blueprint, dimensioned drawing, dimensions, title block, section view, disegno tecnico, tavola, quote]
recipes: [technical-drawing]
---

# Technical drawings from a part

A template does the drafting: you give it the part and a few facts, it lays the sheet out and draws it. Do not draw
views, dimension lines or title blocks by hand — that is where drawings go wrong (views on top of each other, leaders
off the sheet, a missing title block). Your job is the spec: what the part is called, what matters about it, and the
few dimensions only you know matter.

## What it needs (check once)

- **FreeCAD** 1.0 or later (its command line projects the views). Missing: `install_propose {kind: "tool"}` if System
  tools has a row for it, else ask the person to install it.
- **CADCraft** (the Craft App Suite's drafting app; skills/craft-apps) draws the sheet with real dimension objects and
  exports the PDF. Missing: the template still makes the sheet as SVG (and as PDF when a Chromium is here) and says
  so — offer CADCraft for the proper CAD file.
- The part as **STEP** (best: real circles, holes found and tabled) or STL (works; curved edges become facets and
  holes are not tabled). Model in FreeCAD, build123d or CADCraft and export STEP alongside the STL.

## Doing it

1. Write the spec next to the part (paths in it are relative to the spec file). Keep it in the project or the
   workspace, not `/tmp` (a snap FreeCAD cannot see it).
2. Run it: `recipe {action: "run", id: "technical-drawing", values: {spec: "<the spec file>"}}` — or the same command
   with `shell`: `node <this skill's folder>/scripts/drawing.js <spec>`.
3. Read the report it prints: `scale`, `views` placed, "left_out" (with why) and `warnings`. A warning is a defect:
   fix the spec (a larger `sheet`, fewer `dimensions` on one side) and run again.
4. Look at it before you hand it over: `show_media` the PDF. Then say what is on each sheet in one line each.

## The spec

```json
{
  "part": "parts/bracket.step",
  "out": "drawings/bracket.pdf",
  "sheet": "A3",
  "projection": "first",
  "title": { "part": "Bracket", "project": "Example assembly", "material": "PETG", "number": "D-001", "revision": "A", "drawn": "<the person's name, if they want it>" },
  "notes": ["Print flat face down, no supports.", "M3 hex nuts in the traps."],
  "dimensions": [
    { "view": "front", "p1": [-60, 40, 0], "p2": [60, 40, 0], "side": "top" },
    { "view": "detail", "p1": [46, 76, 0], "p2": [54, 76, 0] }
  ],
  "detail": { "at": [50, 76, 0], "radius": 9, "label": "B" }
}
```

- Only `part` and `out` are required. Several parts: `{"out": "all.pdf", "title": {...shared...}, "sheets": [{part, out, title}, ...]}`
  — each sheet is numbered n / m and they are joined into `out`.
- `sheet` A4–A0 (`orientation` landscape by default); `scale` is chosen for you (ISO 1:1, 1:2, 2:1 …) — set it only
  when the person asks for one. `projection` `first` (ISO, Europe) or `third` (ASME, US).
- Views: `front` looks along the part's thinnest side unless `front` names an axis (`"+z"`, `"-y"` …) with `up`.
  By default front, side, a section and an isometric view; the top view is added when there is room for it at the
  same scale. `views: ["front", "top", "side", "section", "iso"]` chooses them yourself.
- `section`: `{ "axis": "vertical" | "horizontal", "at": <mm along the front view> }`; without `at` it cuts through the
  hole nearest the middle. `hidden`: `front` (default), `all` or `none`.
- What is dimensioned without asking: overall size, depth, and the holes' positions; holes are tagged H1, H2 … and
  listed with size and depth (or THRU). Add the dimensions that carry the design — a hole's spacing, a slot, a
  clearance — in `dimensions`: points in the part's own coordinates (3 numbers) or the view's (2), `side` optional;
  a diameter is `{ "view", "center", "d" }`. Put them in the `detail` view when they are small.
- `tolerance` (default ISO 2768-m), `units`, `font` (default the OS's sans).

## Checklist before handing it over

- Every view is labelled; the section's cutting line has arrows and letters; the detail's circle is on the front view.
- The title block says the part, the project, the material, the scale, the date and the sheet number.
- Nothing overlaps and nothing leaves the frame (the report says so).
- The few dimensions that make the part work are there, not only the overall size.
- The DXF beside the PDF opens in CADCraft or any CAD program, for changes.
