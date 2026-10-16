# Orthographic views of a solid, for the technical-drawing template. Runs inside FreeCAD (freecadcmd / FreeCADCmd /
# freecad.cmd): it reads a part (STEP, IGES, BREP; STL is meshed back into faces), projects the views drawing.js asks
# for with TechDraw's hidden-line removal, and writes plain JSON — lines, arcs, circles and polylines in each view's own
# 2D frame (millimetres, x right, y up), the holes it found, and the section's cut faces. No drawing is made here.
#
#   freecadcmd -c "import sys; sys.argv=['project.py', 'job.json']; exec(open('project.py').read())"
#
# job.json: {"part": path, "out": path, "views": [{"name", "dir": [x,y,z], "up": [x,y,z], "cut"?: {"normal", "at"}}]}
import json, math, sys

import FreeCAD as App
import Part
import TechDraw

V = App.Vector


def load(path):
    low = path.lower()
    if low.endswith(('.stl', '.obj', '.ply', '.3mf')):
        import Mesh
        m = Mesh.Mesh(path)
        s = Part.Shape()
        s.makeShapeFromMesh(m.Topology, 0.05)
        s = s.removeSplitter()
        try:
            s = Part.Solid(Part.Shell(s.Faces))
        except Exception:
            pass
        return s
    s = Part.Shape()
    s.read(path)
    return s


def frame(d, up):
    """The rotation that puts a viewer looking from `d` (towards -d) with `up` on screen at +Z looking down, +Y up."""
    d = V(*d).normalize()
    u = V(*up)
    u = (u - d * u.dot(d))
    if u.Length < 1e-9:
        u = V(0, 0, 1) if abs(d.z) < 0.9 else V(0, 1, 0)
        u = (u - d * u.dot(d))
    u.normalize()
    r = u.cross(d)
    m = App.Matrix(r.x, r.y, r.z, 0, u.x, u.y, u.z, 0, d.x, d.y, d.z, 0, 0, 0, 0, 1)
    return m, [[r.x, r.y, r.z], [u.x, u.y, u.z], [d.x, d.y, d.z]]


def pt(p):
    return [round(p.x, 4), round(p.y, 4)]


def edge_json(e):
    c = e.Curve
    if isinstance(c, Part.Line) or isinstance(c, Part.LineSegment) or c.__class__.__name__ in ('Line', 'LineSegment'):
        return {'t': 'l', 'a': pt(e.Vertexes[0].Point), 'b': pt(e.Vertexes[-1].Point)}
    if c.__class__.__name__ == 'Circle' and abs(abs(c.Axis.z) - 1) < 1e-6:
        ctr = [round(c.Center.x, 4), round(c.Center.y, 4)]
        if e.isClosed() or len(e.Vertexes) == 1:
            return {'t': 'c', 'c': ctr, 'r': round(c.Radius, 4)}
        p0, p1 = e.FirstParameter, e.LastParameter
        return {'t': 'a', 'c': ctr, 'r': round(c.Radius, 4), 'p': [pt(e.valueAt(p0)), pt(e.valueAt((p0 + p1) / 2)), pt(e.valueAt(p1))]}
    pts = e.discretize(Deflection=0.02)
    return {'t': 'p', 'pts': [pt(p) for p in pts]}


def edges(compounds, idx):
    out = []
    for i in idx:
        c = compounds[i]
        if c is None or c.isNull():
            continue
        for e in c.Edges:
            if e.Length < 1e-6:
                continue
            out.append(edge_json(e))
    return out


def loop(w):
    """A closed wire as points in order (the wire walks its own edges, each the right way round)."""
    pts = [pt(p) for p in w.discretize(Deflection=0.02)]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def cut_faces(shape, normal, at, m):
    """The faces where plane normal·p = at cuts the solid, as outer loops with holes, in the view frame."""
    faces = []
    try:
        wires = shape.slice(V(*normal), at)
    except Exception:
        wires = []
    if not wires:
        return faces
    try:
        made = Part.makeFace(wires, 'Part::FaceMakerBullseye')
        fs = made.Faces
    except Exception:
        fs = []
    for f in fs:
        f = f.copy()
        f.transformShape(m)
        faces.append({'outer': loop(f.OuterWire), 'holes': [loop(w) for w in f.Wires if not w.isSame(f.OuterWire)]})
    return faces


def holes(shape, d, m, bb):
    """Cylindrical holes whose axis runs along the view direction: centre (view frame), diameter, depth, through."""
    d = V(*d).normalize()
    found = {}
    # A hole is a whole cylinder — its faces on one axis add up to a full turn; a pocket's rounded corner is a quarter.
    turn = {}
    for f in shape.Faces:
        s = f.Surface
        if s.__class__.__name__ == 'Cylinder':
            k = (round(s.Center.x, 2), round(s.Center.y, 2), round(s.Center.z, 2), round(s.Radius, 3))
            u0, u1, _, _ = f.ParameterRange
            turn[k] = turn.get(k, 0) + (u1 - u0)
    for f in shape.Faces:
        s = f.Surface
        if s.__class__.__name__ != 'Cylinder':
            continue
        ax = V(s.Axis).normalize()
        if abs(abs(ax.dot(d)) - 1) > 1e-4:
            continue
        u0, u1, v0, v1 = f.ParameterRange
        p = f.valueAt((u0 + u1) / 2, (v0 + v1) / 2)
        n = f.normalAt((u0 + u1) / 2, (v0 + v1) / 2)
        to_axis = (s.Center + ax * (p - s.Center).dot(ax)) - p
        if to_axis.Length < 1e-9 or n.dot(to_axis) <= 0:
            continue                                  # a boss, not a hole
        k = (round(s.Center.x, 2), round(s.Center.y, 2), round(s.Center.z, 2), round(s.Radius, 3))
        if turn.get(k, 0) < 2 * math.pi * 0.98:
            continue                                  # part of a turn: a rounded corner or a slot's end
        ext = [(v.Point - s.Center).dot(ax) for v in f.Vertexes] or [0]
        depth = max(ext) - min(ext)
        c = m.multVec(s.Center)
        key = (round(c.x, 2), round(c.y, 2), round(s.Radius * 2, 3))
        prev = found.get(key)
        if prev is None or depth > prev['depth']:
            # Through when no material sits on the axis anywhere across the part's depth.
            span = abs(bb.XMax - bb.XMin) * abs(d.x) + abs(bb.YMax - bb.YMin) * abs(d.y) + abs(bb.ZMax - bb.ZMin) * abs(d.z)
            base = s.Center + ax * ((s.Center - bb.Center).dot(ax) * -1)
            thru = True
            for k in range(41):
                q = base + ax * (-span / 2 + span * k / 40)
                if shape.isInside(q, 1e-6, False):
                    thru = False
                    break
            found[key] = {'c': [key[0], key[1]], 'd': key[2], 'depth': round(depth, 3), 'through': thru}
    return sorted(found.values(), key=lambda h: (h['d'], h['c'][1], h['c'][0]))


AXES = {'+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0), '-y': (0, -1, 0), '+z': (0, 0, 1), '-z': (0, 0, -1)}


def front_frame(bb, front, up):
    """The front view: looking from `front` (an axis like "+z", a vector, or "auto": along the part's thinnest side,
    so a plate shows its face), with `up` on screen."""
    size = [bb.XLength, bb.YLength, bb.ZLength]
    if front in (None, '', 'auto'):
        a = size.index(min(size))
        front = ['+x', '-y', '+z'][a]
    f = V(*AXES[front]) if isinstance(front, str) else V(*front)
    if up in (None, '', 'auto'):
        up = (0, 0, 1) if abs(f.z) < 0.9 else (0, 1, 0)
    u = V(*AXES[up]) if isinstance(up, str) else V(*up)
    f.normalize()
    u = u - f * u.dot(f)
    u.normalize()
    return f, u, u.cross(f)


def rel_frame(rel, F, U, R):
    """A standard view from the front's frame: where the viewer stands, and which way is up on screen."""
    iso = (F + R + U)
    return {'front': (F, U), 'rear': (-F, U), 'top': (U, -F), 'bottom': (-U, F), 'right': (R, U), 'left': (-R, U),
            'iso': (iso.normalize(), U)}[rel]


def auto_cut(holes, lo, hi, key):
    """Through the hole nearest the middle when one is near it, else through the middle."""
    mid = (lo + hi) / 2
    near = sorted((abs(h['c'][key] - mid), h['c'][key]) for h in holes)
    return near[0][1] if near and near[0][0] <= 0.3 * (hi - lo) else mid


def main(job_path):
    job = json.load(open(job_path))
    shape = load(job['part'])
    bb = shape.BoundBox
    F, U, R = front_frame(bb, job.get('front'), job.get('up'))
    out = {'bbox': [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax], 'volume': round(shape.Volume, 3),
           'front': [[F.x, F.y, F.z], [U.x, U.y, U.z], [R.x, R.y, R.z]], 'views': {}}
    front_holes, front_bbox = [], None
    for v in job['views']:
        cut = v.get('cut')
        rel = v.get('rel', v['name'])
        if cut:
            rel = 'top' if cut.get('axis') == 'horizontal' else 'right'
        d, up = rel_frame(rel, F, U, R)
        m, basis = frame([d.x, d.y, d.z], [up.x, up.y, up.z])
        part = shape
        if cut:
            n = U if cut.get('axis') == 'horizontal' else R
            at = cut.get('at', 'auto')
            if at in (None, 'auto'):
                key = 1 if cut.get('axis') == 'horizontal' else 0
                fb = front_bbox or [0, 0, 0, 0]
                at = auto_cut(front_holes, fb[key], fb[key + 2], key)
            big = 4 * max(bb.DiagonalLength, 1)
            # Keep the half behind the cutting plane, seen from in front of it.
            box = Part.makeBox(big, big, big)
            box.translate(V(-big / 2, -big / 2, -big))
            m_n, _ = frame([n.x, n.y, n.z], [0, 0, 1] if abs(n.z) < 0.9 else [0, 1, 0])
            box.transformShape(m_n.inverse())
            box.translate(n * at)
            part = shape.common(box)
            cut = {'axis': cut.get('axis', 'vertical'), 'at': round(at, 4), 'normal': [n.x, n.y, n.z]}
        rot = part.copy()
        rot.transformShape(m)                       # a rotation keeps lines and circles analytic
        comp = TechDraw.projectEx(rot, V(0, 0, 1))
        rbb = App.BoundBox()
        for i in (0, 3):
            if comp[i] is not None and not comp[i].isNull() and comp[i].Edges:
                rbb.add(comp[i].BoundBox)
        view = {'rel': rel, 'basis': basis, 'bbox': [rbb.XMin, rbb.YMin, rbb.XMax, rbb.YMax],
                'visible': edges(comp, [0, 3]), 'hidden': [] if rel == 'iso' else edges(comp, [5, 8])}
        if cut:
            view['cut'] = cut
            view['faces'] = cut_faces(shape, cut['normal'], cut['at'], m)
        if v.get('holes') or rel == 'front':
            view['holes'] = holes(shape, [d.x, d.y, d.z], m, bb)
        if rel == 'front' and not cut:
            front_holes, front_bbox = view['holes'], view['bbox']
        out['views'][v['name']] = view
    json.dump(out, open(job['out'], 'w'))


main(sys.argv[1] if len(sys.argv) > 1 else 'job.json')
