---
name: freecad-modelling
description: Model a part in FreeCAD from a Python script without losing an hour to its traps — where the script must live (a snap FreeCAD has its own /tmp and cannot read hidden folders), running it so a failure shows its traceback, exporting a STEP that has geometry in it and an STL that is written at all, fillets on thin plates, a modal dialog that stalls the FreeCAD MCP server. Use whenever you write or run a FreeCAD script, headless or through the FreeCAD MCP server.
triggers: [freecad, freecadcmd, freecad script, part design, step export, export stl, makefillet, cad model, modellazione freecad]
---

# Modelling in FreeCAD by script

Write the part as a Python script with every size a named parameter at the top (the printable-part skill has the
sizes that print), run it headless with the runner below, and check what it wrote before anything else uses it.
Each trap here cost a test run a quarter of an hour; each one fails *silently*, which is why they are worth knowing.

## Where the script and its files go

- **Under the home folder, in the project or the workspace** — never `/tmp`. FreeCAD from a snap has a private
  `/tmp`: a script there runs nothing and the command still exits 0; a file it writes there is not where you look.
- **Not in a hidden folder at the top of home** (`~/.cache`, `~/.local` …): the snap's AppArmor profile refuses them
  (PermissionError). `~/snap/freecad/common/` is the snap's own folder if you need a scratch place.
- Write outputs with absolute paths (`os.path.abspath`), and look at them afterwards: a size of 0, or a STEP with no
  faces, is a failed export whatever the exit code said.

## Running it so a failure is seen

`freecadcmd script.py` runs a file **twice**, reports an exception as one line ("Exception while processing file:
x.py [division by zero]") with no traceback, and **exits 0**; the script's path is in `sys.argv[1]`, not `argv[0]`.
Code after `-c` longer than ~250 characters is taken for a file name and runs nothing. Use the runner instead:

```
node <this skill's folder>/scripts/run.js parts/bracket.py [args…]
```

It runs the script once as `__main__` with `sys.argv = [script, args…]`, prints the whole traceback and exits 1 when
it raises, passes `sys.exit(n)` through, and refuses a script in `/tmp` or a hidden folder when FreeCAD is a snap.
Flags before the script: `--freecad PATH` (or `FREECAD_CMD`), `--timeout SECONDS` (600).

## Exporting

- **STEP: through a document and `Import.export`** — FreeCAD 1.1's `Part.export([shape], path)` can write a STEP with
  its header and no geometry (20 records, no face), which every later step then fails on:

  ```python
  import FreeCAD as App, Import
  doc = App.newDocument('export')
  obj = doc.addObject('Part::Feature', 'Bracket'); obj.Shape = shape; doc.recompute()
  Import.export([obj], os.path.abspath('bracket.step'))
  ```

  Check it: the file names `ADVANCED_FACE` (or `MANIFOLD_SOLID_BREP`); the technical-drawing template says "no
  geometry in <file>" when it does not.
- **STL: `mesh.write(path)`**, not `Mesh.export([mesh], path)` — a mesh from `MeshPart.meshFromShape(Shape=shape,
  LinearDeflection=0.05, AngularDeflection=0.3)` is not a document object and `Mesh.export` refuses it ("None of the
  objects can be exported to a mesh file").
- Before exporting, `shape.isValid()` and `shape.Volume > 0`; one solid per printed part (`len(shape.Solids) == 1`).

## Geometry that goes wrong quietly

- **`makeFillet` on thin plates**: a radius at or above about half the thickness returns a shape that is *not valid*
  (no exception) — a 2 mm fillet on a 3 mm plate's every edge does. Fillet only the edges you mean (select them by
  position or direction), keep the radius under half the wall, and check `isValid()` after each one.
- Booleans: `cut`/`fuse` then `removeSplitter()`; fuse many tools at once (`a.fuse([b, c, d])`) rather than one by one.
- Holes along an axis are cylinders cut through: make them a little longer than the wall (+0.2 mm each side), or a
  skin of zero thickness stays and the hole is not through.

## The FreeCAD MCP server (when the person runs FreeCAD's window)

- A **modal dialog** open in FreeCAD's window (a file dialog, an error box, a task panel's question) holds every GUI
  call: `execute_code` waits its whole budget (90 s) and fails naming "a modal dialog is open". Do not retry —
  ask the person to close it, then call `get_rpc_status` (it answers without the GUI thread) before trying again.
- Its headless run (`execute_code` without the window) writes scripts under `~/.cache`, which a snap FreeCAD cannot
  read: prefer the runner above for headless work.

## Then

The printable-part skill for sizes and print orientation, technical-drawing for the sheet (it needs the STEP),
product-video for the promo (it takes the STL), and `check_output {kind: "mesh"}` on every STL before it is handed over.
