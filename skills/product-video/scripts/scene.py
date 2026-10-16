# The product video template's Blender scene. Run headless:  blender -b --factory-startup -P scene.py -- job.json
# One shot per run, written as numbered PNG frames: "turntable" (the assembled product turning on a studio floor) or
# "assemble" (the parts spread along their axis, then coming together one by one in list order). promo.js plans the
# timing and writes the job; nothing here decides what the video says.
import json, math, os, sys

import bpy
from mathutils import Vector, Matrix, Euler

job = json.load(open(sys.argv[sys.argv.index('--') + 1]))
fps, frames = job['fps'], job['frames']
W, H = job['resolution']
DARK = job.get('style', 'dark') != 'light'


def rgb(hexstr):
    h = hexstr.lstrip('#')
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s] + [1]   # sRGB → linear


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, rough=0.42, coat=0.15):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = rgb(color)
    b.inputs['Roughness'].default_value = rough
    for k in ('Coat Weight', 'Clearcoat'):
        if k in b.inputs:
            b.inputs[k].default_value = coat
            break
    return m


def import_part(p):
    """One part as one object, in millimetres as exported: STL, OBJ, PLY, GLB/GLTF, or a plain box."""
    before = set(bpy.data.objects)
    if p.get('box'):
        bpy.ops.mesh.primitive_cube_add(size=1)
        o = bpy.context.active_object
        o.scale = [v for v in p['box']]
        o.location = [v / 2 for v in p['box']]
        bpy.ops.object.transform_apply(location=True, scale=True)
    else:
        path = p['path']
        ext = os.path.splitext(path)[1].lower()
        if ext == '.stl':
            bpy.ops.wm.stl_import(filepath=path)
        elif ext == '.obj':
            bpy.ops.wm.obj_import(filepath=path)
        elif ext == '.ply':
            bpy.ops.wm.ply_import(filepath=path)
        elif ext in ('.glb', '.gltf'):
            bpy.ops.import_scene.gltf(filepath=path)
        else:
            raise SystemExit(f'Cannot import {path}: STL, OBJ, PLY, GLB or GLTF')
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in bpy.data.objects:
        o.select_set(o in new)
    bpy.context.view_layer.objects.active = new[0]
    if len(new) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.parent = None
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    rot = p.get('rotation') or [0, 0, 0]
    o.rotation_euler = Euler([math.radians(a) for a in rot], 'XYZ')
    o.location = Vector(p.get('offset') or [0, 0, 0])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    o.name = p.get('name', 'part')
    # Smooth what is curved, keep what is flat crisp (a printed part's edges are sharp).
    for poly in o.data.polygons:
        poly.use_smooth = False
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(30))
    except Exception:
        pass
    o.data.materials.clear()
    o.data.materials.append(material(o.name, p.get('color', '#d9dce0'), rough=p.get('roughness', 0.42)))
    return o


def area_light(name, loc, power, size, color, target):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy, d.size, d.color = power, size, color
    o = bpy.data.objects.new(name, d)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


clear()
scene = bpy.context.scene
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = W, H, 100
scene.render.fps = fps
scene.frame_start, scene.frame_end = 1, frames
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(job['out_dir'], '')
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
if job.get('engine') == 'cycles':
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = job.get('samples', 96)
    scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type == kind for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == kind
                    scene.cycles.device = 'GPU'
                    break
            except Exception:
                continue
    except Exception:
        pass
else:
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    ee = scene.eevee
    ee.taa_render_samples = job.get('samples', 48)
    for attr, val in (('use_raytracing', True), ('use_shadows', True), ('use_gtao', True)):
        if hasattr(ee, attr):
            setattr(ee, attr, val)
scene.view_settings.view_transform = 'AgX' if 'AgX' in [v.identifier for v in type(scene.view_settings).bl_rna.properties['view_transform'].enum_items] else 'Filmic'
try:
    scene.view_settings.look = 'AgX - Medium High Contrast' if DARK else 'AgX - Base Contrast'
except Exception:
    pass

# The parts, in millimetres, under one root scaled so the assembly is 1 unit across.
parts = [import_part(p) for p in job['parts']]
lo = Vector([min(min((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for o in parts) for i in range(3)])
hi = Vector([max(max((o.matrix_world @ Vector(c))[i] for c in o.bound_box) for o in parts) for i in range(3)])
size = max(hi - lo)
root = bpy.data.objects.new('assembly', None)
scene.collection.objects.link(root)
centre = (lo + hi) / 2
for o in parts:
    o.location -= centre
    o.parent = root
root.scale = [1 / size] * 3
root.rotation_euler = Euler([math.radians(a) for a in job.get('rotate', [0, 0, 0])], 'XYZ')
bpy.context.view_layer.update()


def world_box(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


# Exploded positions for the assembly shot: along the parts' own axis, each part a step further than the one before.
axis = Vector(job.get('explode_axis', [0, 0, 1])).normalized()
ext = (hi - lo)


def step_along(a):
    return (abs(a.x) * ext.x + abs(a.y) * ext.y + abs(a.z) * ext.z) / size * 1.2 + job.get('spread', 0.26)


step = step_along(axis)
home = [o.location.copy() for o in parts]


def route(i):
    """Where part i travels from, as points (mm, the assembly's frame) ending before its place: a part's own "via"
    (offsets from its place, in order), else its own "axis" (and "distance"), else the shared explode axis — each part
    a step further than the one before it that comes the same way, so a one-axis spec moves exactly as it always did."""
    p, h = job['parts'][i], home[i]
    if p.get('via'):
        return [h + Vector(v) for v in p['via']]
    a = Vector(p['axis']).normalized() if p.get('axis') else axis
    k = sum(1 for j in range(1, i + 1) if not job['parts'][j].get('via')
            and (Vector(job['parts'][j]['axis']).normalized() if job['parts'][j].get('axis') else axis).dot(a) > 0.999)
    d = p['distance'] if p.get('distance') is not None else step_along(a) * k * size
    return [h + a * d]


routes = [[] if i == 0 else route(i) for i in range(len(parts))]
if job['shot'] == 'assemble':                       # framed and floored as spread out, its widest moment
    for o, h, r in zip(parts, home, routes):
        o.location = r[0] if r else h
bpy.context.view_layer.update()
root.location.z -= world_box(parts)[0].z            # stand it on the floor at z = 0
bpy.context.view_layer.update()
blo, bhi = world_box(parts)

# Studio: a floor that meets the world's colour at the horizon, three area lights.
bg = rgb(job.get('background', '#0b0d10' if DARK else '#e3e6ea'))
world = bpy.data.worlds.new('studio')
world.use_nodes = True
# The camera sees the backdrop's colour; the light it gives the product is a quarter of that, or a light studio
# washes a light part out to nothing.
nt = world.node_tree
seen, lit = nt.nodes['Background'], nt.nodes.new('ShaderNodeBackground')
seen.inputs['Color'].default_value = lit.inputs['Color'].default_value = bg
seen.inputs['Strength'].default_value, lit.inputs['Strength'].default_value = 1.0, 0.25
mix, path_ = nt.nodes.new('ShaderNodeMixShader'), nt.nodes.new('ShaderNodeLightPath')
nt.links.new(path_.outputs['Is Camera Ray'], mix.inputs['Fac'])
nt.links.new(lit.outputs['Background'], mix.inputs[1])
nt.links.new(seen.outputs['Background'], mix.inputs[2])
nt.links.new(mix.outputs['Shader'], nt.nodes['World Output'].inputs['Surface'])
scene.world = world
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
floor = bpy.context.active_object
fm = material('floor', job.get('floor', '#0c0d10' if DARK else '#d5d9de'), rough=0.5 if DARK else 0.75, coat=0)
floor.data.materials.append(fm)

c = (blo + bhi) / 2
r = (bhi - blo).length / 2
key = area_light('key', (c.x + 2.2 * r + 1.2, c.y - 2.0 * r - 1.4, c.z + 2.2 * r + 1.6), 420 if DARK else 520, 2.2, (1.0, 0.95, 0.88), c)
fill = area_light('fill', (c.x - 2.6 * r - 1.4, c.y - 1.2 * r - 0.8, c.z + 1.0 * r + 0.8), 120 if DARK else 300, 3.0, (0.86, 0.92, 1.0), c)
rim = area_light('rim', (c.x - 0.6 * r, c.y + 2.6 * r + 1.6, c.z + 1.6 * r + 1.2), 650 if DARK else 380, 1.4, (1, 1, 1), c)

# Camera: framing the whole bounding sphere at the elevation asked for.
cam_d = bpy.data.cameras.new('cam')
cam_d.lens = job.get('lens', 55)
cam = bpy.data.objects.new('cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
fov = 2 * math.atan(cam_d.sensor_width / 2 / cam_d.lens) * min(1, H / W)
dist = r / math.sin(fov / 2) * job.get('margin', 1.12)
elev = math.radians(job.get('elevation', 22))
target = cam.constraints.new('TRACK_TO')
aim = bpy.data.objects.new('aim', None)
scene.collection.objects.link(aim)
aim.location = c
target.target, target.track_axis, target.up_axis = aim, 'TRACK_NEGATIVE_Z', 'UP_Y'


def place_cam(azimuth, d=dist):
    a = math.radians(azimuth)
    cam.location = (c.x + d * math.cos(elev) * math.sin(a), c.y - d * math.cos(elev) * math.cos(a), c.z + d * math.sin(elev))


az0 = job.get('azimuth', -28)
if job['shot'] == 'turntable':
    place_cam(az0)
    turn = math.radians(job.get('turn_degrees', 270))
    base = root.rotation_euler.copy()
    # The world turns, not the camera, at an even speed: a turntable that eases looks like it stalls.
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    # Centred on the way it was placed, so the side it was set up to show faces the camera mid-shot.
    for f, t in ((1, -0.5), (frames, 0.5)):
        root.rotation_euler = Euler((base.x, base.y, base.z + turn * t), 'XYZ')
        root.keyframe_insert('rotation_euler', frame=f)
else:
    # Spread along the axis, then each part after the first settles onto its place in turn (promo.js's schedule).
    for i, (o, h) in enumerate(zip(parts, home)):
        if i == 0:
            continue
        s0, s1 = job['moves'][i - 1]
        pts = routes[i] + [h]
        # Its waypoints evenly over its move, the place last; Bézier keys: it eases in and settles.
        for n, at in enumerate(pts):
            o.location = at
            t = s0 + (s1 - s0) * n / (len(pts) - 1)
            o.keyframe_insert('location', frame=max(1, int(round(t * fps)) + 1))
    # Seen from where the parts' axis runs across the picture rather than straight at the lens, or the spread
    # reads as depth and the parts hide each other: about 60° off the axis, on the side nearest the asked azimuth.
    # With parts coming different ways, the axis is the way of the longest move.
    moves = [(r[0] - h) for r, h in zip(routes, home) if r]
    own = any(p.get('axis') or p.get('via') for p in job['parts'])
    main = max(moves, key=lambda v: v.length).normalized() if own and moves else axis
    wa = root.matrix_world.to_quaternion() @ main          # the axis as the world sees it (rotation only)
    if 'azimuth' not in job and Vector((wa.x, wa.y)).length > 0.35:
        along = math.degrees(math.atan2(wa.x, -wa.y))
        az0 = min((along + 60, along - 60), key=lambda a: abs(((a - az0 + 180) % 360) - 180))
    # A slow push in while it comes together.
    place_cam(az0 - 14, dist * 1.08)
    cam.keyframe_insert('location', frame=1)
    place_cam(az0 + 10, dist * 0.86)
    cam.keyframe_insert('location', frame=frames)

bpy.ops.render.render(animation=True)
