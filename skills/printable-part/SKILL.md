---
name: printable-part
description: A short checklist for designing a part to 3D-print (FDM) — walls, clearances for M3 screws, nuts and heat-set inserts, keyholes, cable slots, bed fit, orientation without supports, exporting STL and STEP. Use when the person asks for a printable part, a bracket, a mount, an enclosure or anything to print.
triggers: [3d print, printable, stl, bracket, mount, enclosure, fdm, stampa 3d]
---

# A part that prints the first time

Design in a parametric tool (FreeCAD, build123d, CADCraft for 2D) with every size a named parameter at the top, so a
change is one number. Then go down this list before you export. Scripting FreeCAD: read the freecad-modelling skill
first — where the script must live, running it so a failure shows, and the exports that fail silently.

## Sizes that work on an ordinary FDM printer (0.4 mm nozzle)

- **Walls** ≥ 1.6 mm (4 perimeters); 2.5–3 mm where a screw bites or a load hangs. Floors and roofs ≥ 1.2 mm.
- **Fit**: a part inside a pocket 0.25–0.5 mm clearance per side; a sliding fit 0.3 mm; press fit 0.1 mm.
- **M3**: clearance hole Ø3.4; self-tapping pilot Ø2.5, 8 mm deep in ≥ 3 mm wall around it; countersink Ø6.4 × 90°;
  hex nut trap 5.7 across flats + 0.2, 2.6 deep; heat-set insert hole Ø4.0–4.2 (M3 × 5.7 insert), boss Ø7–8.
- **Keyholes** for hanging: entry Ø9 for a screw head up to Ø8, slot 4.5 for a Ø3.5–4 shank, travel ≥ 8, and a ledge
  ≥ 2 mm behind the slot so the head has something to sit on. Two keyholes ≥ 100 mm apart, level.
- **Cable slots**: USB-C plug body ~12.5 × 7 mm — slot ≥ 14 × 8; leave room for the bend (a right-angle adapter helps).
- **Overhangs** ≤ 45°, bridges ≤ 20 mm; holes on vertical walls become teardrops or are printed flat.
- **Bed fit**: the footprint plus a 5 mm margin inside the bed (220 × 220 on most); split a part that does not fit and
  join it with screws or a dovetail.
- **Fillets** on outside corners (R1–R3) look better and print better; leave the bed edge sharp or chamfer 0.5 mm.

## Orientation

- Largest flat face on the bed; no supports if the list above holds. Holes for screws vertical when you can.
- Load across the layers, not pulling them apart (a bracket's arm along the bed, not standing up).

## Before handing it over

- The solid is valid and closed; the parts do not collide in the assembly; screw holes line up across parts.
- Export **STL** for the slicer (fine tolerance: 0.05 mm) and **STEP** for anyone who edits it; name them by part.
  From FreeCAD: STEP through a document and `Import.export`, STL with `mesh.write` (freecad-modelling says why).
- Parts that hold something (a tablet, a board, a fan): `check_output {kind: "fit"}` with the parts and a box for the
  held thing — it measures overlap and the clearance on each side in mm; aim at the **Fit** sizes above.
- Say how to print each part: orientation, layer height, perimeters, infill, material, supports (none, ideally).
- For drawings of it use the technical-drawing skill; for a video of it, the product-video skill.
