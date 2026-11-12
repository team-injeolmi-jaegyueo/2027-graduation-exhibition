# 로봇 원본(robot.blend)의 뼈대·애니메이션을 그대로 쓰고, 로봇 파츠를 동물의 숲 느낌 인간(남성) 파츠로 바꾼다.
# 실행: Blender -b robot.blend --python build_human.py -- <out.blend> <out.glb>
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
OUT_BLEND, OUT_GLB = argv[0], argv[1]

# ---------- 색상 (sRGB hex → linear) ----------
def lin(h):
    h = h.lstrip("#")
    def c(v):
        v = int(v, 16) / 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c(h[0:2]), c(h[2:4]), c(h[4:6]), 1.0)

PALETTE = {
    "HM_Skin": ("#FCDCC8", 0.6), "HM_SkinNose": ("#F6BFA6", 0.6), "HM_Blush": ("#F7A39A", 0.7),
    "HM_Hair": ("#6B3E26", 0.5), "HM_Brow": ("#4A2A1A", 0.6), "HM_Eye": ("#2B1E1A", 0.25),
    "HM_EyeHighlight": ("#FFFFFF", 0.3), "HM_Mouth": ("#7A2F2A", 0.5),
    "HM_Shirt": ("#F07F5A", 0.7), "HM_Cream": ("#FFF1DA", 0.7), "HM_Shorts": ("#A8774E", 0.75),
    "HM_ShortsCuff": ("#C49466", 0.75), "HM_Shoe": ("#FFF4E4", 0.55), "HM_Sole": ("#7A4A2E", 0.6),
}
MATS = {}
for name, (hexc, rough) in PALETTE.items():
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = lin(hexc)
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = lin(hexc)
    m.use_fake_user = True  # 로봇 데이터 정리(purge) 중 지워지지 않게
    MATS[name] = m

def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def lerp(a, b, t):
    return a + (b - a) * t

# ---------- 기본 도형 (하나의 bmesh에 여러 재질로 합침) ----------
class Part:
    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def ellipsoid(self, center, radii, mat, segs=32, rings=20, func=None):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=1.0)
        idx = self.mi(mat)
        for v in r["verts"]:
            n = v.co.normalized()
            s = func(n) if func else 1.0
            v.co = Vector((center[0] + n.x * radii[0] * s, center[1] + n.y * radii[1] * s, center[2] + n.z * radii[2] * s))
        for f in {f for v in r["verts"] for f in v.link_faces}:
            f.material_index = idx
            f.smooth = True

    def tube(self, pts, radii, mat, segs=24, sy=1.0, closed=False, cap=True, up=(0, 0, 1)):
        """경로를 따라 원(타원) 단면을 이어 붙인 관. 끝은 막는다."""
        idx = self.mi(mat)
        pts = [Vector(p) for p in pts]
        n = len(pts)
        tangents = []
        for i in range(n):
            if closed:
                t = pts[(i + 1) % n] - pts[i - 1]
            else:
                t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tangents.append(t.normalized())
        ref = Vector(up)
        if abs(ref.dot(tangents[0])) > 0.95:
            ref = Vector((0, 1, 0))
        u = tangents[0].cross(ref).normalized()
        rings = []
        for i in range(n):
            if i > 0:  # 평행 이동 프레임
                u = (u - tangents[i] * u.dot(tangents[i])).normalized()
            w = tangents[i].cross(u).normalized()
            ring = []
            for k in range(segs):
                a = 2 * math.pi * k / segs
                ring.append(self.bm.verts.new(pts[i] + u * radii[i] * math.cos(a) + w * radii[i] * sy * math.sin(a)))
            rings.append(ring)
        faces = []
        last = n if closed else n - 1
        for i in range(last):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for k in range(segs):
                faces.append(self.bm.faces.new((r0[k], r0[(k + 1) % segs], r1[(k + 1) % segs], r1[k])))
        if cap and not closed:
            for ring, p in ((rings[0], pts[0]), (rings[-1], pts[-1])):
                c = self.bm.verts.new(p)
                for k in range(segs):
                    faces.append(self.bm.faces.new((ring[k], ring[(k + 1) % segs], c)))
        for f in faces:
            f.material_index = idx
            f.smooth = True

    def lathe_z(self, center_xy, profile, mat, segs=32, sy=1.0):
        """z축 프로필 [(z, r)]를 회전시킨 몸통형 도형."""
        pts = [(center_xy[0], center_xy[1], z) for z, _ in profile]
        rad = [max(r, 1e-4) for _, r in profile]
        self.tube(pts, rad, mat, segs=segs, sy=sy, up=(0, 1, 0))

    def to_object(self, name, data_name=None, subsurf=1, decal=False, solidify=None):
        if decal:  # 얼굴 위 얇은 면: 모든 면이 바깥(머리 중심 반대)을 보게 한다
            for f in self.bm.faces:
                f.normal_update()
                if f.normal.dot(f.calc_center_median() - HC) < 0:
                    f.normal_flip()
        else:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-6)
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(data_name or name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MATS[m])
        ob = bpy.data.objects.new(name, me)
        HUMAN_COLL.objects.link(ob)
        if solidify:
            sm = ob.modifiers.new("Solidify", "SOLIDIFY")
            sm.thickness = solidify
            sm.offset = -1
        if subsurf:
            mod = ob.modifiers.new("Subdivision", "SUBSURF")
            mod.levels = subsurf
            mod.render_levels = subsurf
        return ob

# ---------- 로봇 파츠 제거, 뼈대·애니메이션 유지 ----------
rig = bpy.data.objects["Robot_Rig"]
robot_coll = bpy.data.collections["Robot"]
for ob in list(robot_coll.objects):
    if ob.name != "Robot_Root":
        bpy.data.objects.remove(ob, do_unlink=True)
ref_coll = bpy.data.collections.get("Turnaround_References")
if ref_coll:
    for ob in list(ref_coll.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.collections.remove(ref_coll)
for ob in list(bpy.data.objects):
    if ob.type == "CAMERA" and ob.name.startswith(("ArmReview_", "Audit_", "Rig_")):
        bpy.data.objects.remove(ob, do_unlink=True)

robot_coll.name = "Human"
HUMAN_COLL = robot_coll
rig.name = "Human_Rig"
rig.data.name = "Human_Rig"
bpy.data.objects["Robot_Root"].name = "Human_Root"
bpy.data.orphans_purge(do_recursive=True)

RIG_Z = rig.matrix_world.translation.z  # 뼈 로컬 → 월드 (-0.055)

def parent_to_bone(ob, bone_name):
    bone = rig.data.bones[bone_name]
    pm = rig.matrix_world @ bone.matrix_local @ Matrix.Translation((0, bone.length, 0))
    ob.parent = rig
    ob.parent_type = "BONE"
    ob.parent_bone = bone_name
    ob.matrix_parent_inverse = pm.inverted()
    ob.matrix_basis = Matrix.Identity(4)

# ---------- 치수 (월드 좌표, 정면 = -Y, rest = T자 포즈) ----------
HC = Vector((0.0, 0.0, 0.82))      # 머리 중심
HR = Vector((0.36, 0.32, 0.32))    # 머리 반지름
ARM_Z = 0.5 + RIG_Z                # 팔 높이 (0.445)

def face_point(x, z, off):
    """머리 타원체 앞면 위 (x, z) 지점 + 법선 방향 off."""
    dx, dz = (x - HC.x) / HR.x, (z - HC.z) / HR.z
    q = max(1e-6, 1 - dx * dx - dz * dz)
    y = HC.y - HR.y * math.sqrt(q)
    p = Vector((x, y, z))
    n = Vector(((x - HC.x) / HR.x ** 2, (y - HC.y) / HR.y ** 2, (z - HC.z) / HR.z ** 2)).normalized()
    return p + n * off

def decal_disk(part, mat, nr=5, ns=28):
    """중심 + 동심원 원판. (a, b) ∈ 단위원 좌표를 돌려준다."""
    idx = part.mi(mat)
    bm = part.bm
    coords = [(0.0, 0.0)]
    for i in range(1, nr + 1):
        r = i / nr
        for k in range(ns):
            a = 2 * math.pi * k / ns
            coords.append((r * math.cos(a), r * math.sin(a)))
    verts = [bm.verts.new((0, 0, 0)) for _ in coords]
    for k in range(ns):
        f = bm.faces.new((verts[0], verts[1 + (k + 1) % ns], verts[1 + k]))
        f.material_index = idx
    for i in range(1, nr):
        b0, b1 = 1 + (i - 1) * ns, 1 + i * ns
        for k in range(ns):
            f = bm.faces.new((verts[b0 + k], verts[b0 + (k + 1) % ns], verts[b1 + (k + 1) % ns], verts[b1 + k]))
            f.material_index = idx
    return verts, coords

def decal_strip(part, mat, nu=17, nv=5):
    """(u, v) ∈ [-1,1]×[0,1] 띠 격자."""
    idx = part.mi(mat)
    bm = part.bm
    coords = [(-1 + 2 * i / (nu - 1), j / (nv - 1)) for j in range(nv) for i in range(nu)]
    verts = [bm.verts.new((0, 0, 0)) for _ in coords]
    for j in range(nv - 1):
        for i in range(nu - 1):
            a = j * nu + i
            f = bm.faces.new((verts[a], verts[a + 1], verts[a + nu + 1], verts[a + nu]))
            f.material_index = idx
    return verts, coords

def place(verts, coords, fn, off):
    for v, c in zip(verts, coords):
        x, z = fn(*c)
        v.co = face_point(x, z, off)

# ========== 머리 (head 뼈) ==========
p = Part()
p.ellipsoid(HC, HR, "HM_Skin", segs=48, rings=32)
p.ellipsoid(face_point(0.0, 0.745, -0.004), (0.021, 0.017, 0.017), "HM_SkinNose", segs=20, rings=12)  # 코
ob = p.to_object("Head", "Head_Human")
parent_to_bone(ob, "head")

p = Part()  # 귀: 긴 머리·단발일 때 숨길 수 있게 따로 둔다
for s in (1, -1):
    p.ellipsoid((s * 0.352, 0.01, 0.745), (0.035, 0.045, 0.055), "HM_Skin", segs=20, rings=12)
ob = p.to_object("Ears", "Ears_Human")
parent_to_bone(ob, "head")

# 머리카락: 머리보다 살짝 큰 타원체를 얼굴 부분만 안쪽으로 밀어 넣어 머리 모양을 만든다.
# 머리 모양은 5종이며 웹에서는 하나만 보이게 한다. 기본은 Hair_Short.
def make_hair_scale(front_edge, side, back, thick=1.075, puff=0.035, flare=0.0):
    def f(n):
        front = smoothstep(0.1, 0.45, -n.y)
        backw = smoothstep(0.0, 0.7, n.y)
        edge = lerp(lerp(side, back, backw), front_edge(n.x), front)
        t = smoothstep(-0.045, 0.045, n.z - edge)
        lower = max(0.0, -n.z)
        return 0.9 + (thick - 0.9) * t + puff * max(0.0, n.z) * t + flare * lower * lower * t
    return f

HAIR_STYLES = {
    # 이름: (앞머리 경계, 옆 경계, 뒤 경계, 두께, 정수리 볼륨, 아래쪽 퍼짐)
    "Short":    (lambda x: 0.37 + 0.065 * math.cos(x * 10.5), -0.12, -0.62, 1.075, 0.035, 0.0),   # 짧은 앞머리
    "Buzz":     (lambda x: 0.58 + 0.02 * math.cos(x * 6.0), 0.05, -0.45, 1.03, 0.0, 0.0),          # 아주 짧은 머리
    "SidePart": (lambda x: 0.62 - 0.22 * smoothstep(-0.2, 0.6, x), -0.1, -0.6, 1.08, 0.05, 0.0),  # 이마 보이는 옆 가르마
    "Bob":      (lambda x: 0.40 + 0.03 * math.cos(x * 14.0), -0.72, -0.78, 1.08, 0.03, 0.18),     # 단발
    "Long":     (lambda x: 0.42 + 0.04 * math.cos(x * 9.0), -0.8, -0.85, 1.075, 0.03, 0.15),       # 긴 머리
}

def hair_curtain(part, z_top=0.66, z_bot=0.36, ang=math.radians(112), nu=48, nv=14):
    """긴 머리: 뒤·옆으로 어깨까지 내려오는 머리카락 면."""
    idx = part.mi("HM_Hair")
    bm = part.bm
    rows = []
    for j in range(nv):
        v = j / (nv - 1)
        row = []
        for i in range(nu):
            u = -ang + 2 * ang * i / (nu - 1)
            z = lerp(z_top, z_bot, v) + v * 0.02 * math.cos(u * 8)
            rx, ry = lerp(0.345, 0.385, v), lerp(0.305, 0.31, v)
            row.append(bm.verts.new((HC.x + math.sin(u) * rx, HC.y + math.cos(u) * ry, z)))
        rows.append(row)
    for j in range(nv - 1):
        for i in range(nu - 1):
            f = bm.faces.new((rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], rows[j][i + 1]))
            f.material_index = idx
            f.smooth = True

for style, (fe, side, back, thick, puff, flare) in HAIR_STYLES.items():
    p = Part()
    p.ellipsoid(HC, HR, "HM_Hair", segs=72, rings=48, func=make_hair_scale(fe, side, back, thick, puff, flare))
    if style == "Long":
        hair_curtain(p)
    ob = p.to_object(f"Hair_{style}", f"Hair_{style}_Human", solidify=0.025 if style == "Long" else None)
    ob["hair_style"] = style
    parent_to_bone(ob, "head")

# 삐친 머리(antenna 뼈를 그대로 사용 → Pose_Antenna_Sway로 흔들림)
p = Part()
ab = rig.data.bones["antenna"]
base = rig.matrix_world @ ab.head_local
path = [base + Vector(d) for d in ((-0.03, 0, -0.035), (0.0, 0, 0.0), (0.03, 0, 0.055), (0.075, 0, 0.09), (0.12, 0, 0.085), (0.145, 0, 0.06))]
p.tube(path, [0.03, 0.03, 0.026, 0.019, 0.011, 0.003], "HM_Hair", segs=16, sy=0.55, up=(0, 1, 0))
ob = p.to_object("HairTuft", "HairTuft_Human")  # Hair_Short 전용
parent_to_bone(ob, "antenna")

# 볼터치·눈썹 (표정 없음)
p = Part()
for s in (1, -1):
    v, c = decal_disk(p, "HM_Blush")
    place(v, c, lambda a, b, s=s: (s * 0.2 + a * 0.046, 0.70 + b * 0.027), 0.0025)
ob = p.to_object("Cheeks", "Cheeks_Human", subsurf=0, decal=True)
parent_to_bone(ob, "head")

p = Part()
for s in (1, -1):
    v, c = decal_strip(p, "HM_Brow", nu=13, nv=4)
    place(v, c, lambda u, w, s=s: (s * 0.128 + u * 0.034, 0.893 + 0.008 * (1 - u * u) + (w - 0.5) * 0.013 * (1 - 0.4 * u * u)), 0.003)
ob = p.to_object("Brows", "Brows_Human", subsurf=0, decal=True)
parent_to_bone(ob, "head")

# ========== 눈 (Happy / Closed 모프, 로봇과 같은 이름) ==========
EYE_RX, EYE_RZ, EYE_Z = 0.03, 0.044, 0.79

def eye_basis(x0):
    return lambda a, b: (x0 + a * EYE_RX, EYE_Z + b * EYE_RZ)

def eye_happy(x0):  # ∩ 웃는 눈
    return lambda a, b: (x0 + a * EYE_RX * 1.3, EYE_Z - EYE_RZ * 0.35 + EYE_RZ * 0.8 * (1 - a * a) + b * EYE_RZ * 0.2)

def eye_closed(x0):  # ‿ 감은 눈
    return lambda a, b: (x0 + a * EYE_RX * 1.3, EYE_Z - EYE_RZ * 0.25 - EYE_RZ * 0.3 * (1 - a * a) + b * EYE_RZ * 0.15)

def hl_basis(x0, s):
    return lambda a, b: (x0 + s * 0.009 + a * 0.009, EYE_Z + 0.017 + b * 0.011)

def hl_hidden(x0):
    return lambda a, b: (x0, EYE_Z - EYE_RZ * 0.3)

def make_eye(side, x0):
    p = Part()
    ev, ec = decal_disk(p, "HM_Eye", nr=6, ns=32)
    hv, hc = decal_disk(p, "HM_EyeHighlight", nr=2, ns=16)
    place(ev, ec, eye_basis(x0), 0.004)
    place(hv, hc, hl_basis(x0, 1 if x0 > 0 else -1), 0.0065)
    ob = p.to_object(f"Eye_{side}", f"Eye_{side}_FaceMorph", subsurf=0, decal=True)
    me = ob.data
    ne = len(ec)
    def co_list(fe, fh, off_h):
        out = [face_point(*fe(*c), 0.004) for c in ec]
        out += [face_point(*fh(*c), off_h) for c in hc]
        return out
    ob.shape_key_add(name="Basis")
    for kname, fe in (("Happy", eye_happy(x0)), ("Closed", eye_closed(x0))):
        kb = ob.shape_key_add(name=kname, from_mix=False)
        for i, co in enumerate(co_list(fe, hl_hidden(x0), 0.0035)):
            kb.data[i].co = co
    parent_to_bone(ob, "head")
    return ob

eyes = [make_eye("L", 0.125), make_eye("R", -0.125)]

# ========== 입 (OpenSmile 모프) ==========
MOUTH_Z, MOUTH_W = 0.678, 0.034
p = Part()
mv, mc = decal_strip(p, "HM_Mouth", nu=21, nv=6)
smile = lambda u, w: (u * MOUTH_W, MOUTH_Z - 0.011 * (1 - u * u) + (w - 0.5) * 0.009 * (1 - 0.6 * u * u))
openm = lambda u, w: (u * MOUTH_W * 1.15, MOUTH_Z + 0.006 - (1 - w) * 0.042 * math.sqrt(max(0.0, 1 - u * u)))
place(mv, mc, smile, 0.004)
mouth = p.to_object("Mouth", "Mouth_FaceMorph", subsurf=0, decal=True)
mouth.shape_key_add(name="Basis")
kb = mouth.shape_key_add(name="OpenSmile", from_mix=False)
for i, c in enumerate(mc):
    kb.data[i].co = face_point(*openm(*c), 0.004)
parent_to_bone(mouth, "head")

# 로봇과 같은 드라이버: head 뼈 커스텀 속성(eyes_happy, blink, mouth_open)
def add_driver(ob, key, expr, props):
    fc = ob.data.shape_keys.key_blocks[key].driver_add("value")
    d = fc.driver
    d.type = "SCRIPTED"
    d.expression = expr
    for pr in props:
        var = d.variables.new()
        var.name = pr
        var.type = "SINGLE_PROP"
        var.targets[0].id = rig
        var.targets[0].data_path = f'pose.bones["head"]["{pr}"]'

for e in eyes:
    add_driver(e, "Happy", "eyes_happy*(1-blink)", ["eyes_happy", "blink"])
    add_driver(e, "Closed", "blink", ["blink"])
add_driver(mouth, "OpenSmile", "mouth_open", ["mouth_open"])

# ========== 목 / 몸통 / 골반 ==========
p = Part()
p.tube([(0, 0, 0.40), (0, 0, 0.6)], [0.055, 0.055], "HM_Skin", segs=20)
ob = p.to_object("Neck", "Neck_Human")
parent_to_bone(ob, "neck")

p = Part()  # 티셔츠
p.lathe_z((0, 0), [(0.185, 0.0), (0.187, 0.155), (0.2, 0.188), (0.23, 0.193), (0.3, 0.19), (0.38, 0.183),
                   (0.44, 0.166), (0.485, 0.135), (0.51, 0.09), (0.52, 0.0)], "HM_Shirt", segs=40, sy=0.8)
ring = [(0.078 * math.cos(2 * math.pi * k / 40), 0.064 * math.sin(2 * math.pi * k / 40), 0.505) for k in range(40)]
p.tube(ring, [0.017] * 40, "HM_Cream", segs=12, closed=True)  # 목둘레
ob = p.to_object("Torso", "Torso_Human")
parent_to_bone(ob, "spine")

p = Part()  # 반바지 허리
p.lathe_z((0, 0), [(0.095, 0.0), (0.1, 0.12), (0.125, 0.165), (0.17, 0.178), (0.22, 0.173), (0.235, 0.0)], "HM_Shorts", segs=40, sy=0.8)
ob = p.to_object("Hips", "Hips_Human")
parent_to_bone(ob, "pelvis")

# ========== 팔 (upper_arm) · 손 (hand) ==========
def make_arm(side, s):
    p = Part()
    p.ellipsoid((s * 0.215, 0, ARM_Z), (0.08, 0.075, 0.08), "HM_Shirt", segs=28, rings=18)  # 어깨
    p.tube([(s * 0.215, 0, ARM_Z), (s * 0.3, 0, ARM_Z)], [0.08, 0.074], "HM_Shirt", segs=28, up=(0, 0, 1))  # 소매
    ring = [(s * 0.3, 0.074 * math.cos(2 * math.pi * k / 32), ARM_Z + 0.074 * math.sin(2 * math.pi * k / 32)) for k in range(32)]
    p.tube(ring, [0.012] * 32, "HM_Cream", segs=10, closed=True)  # 소매 끝단
    p.tube([(s * 0.29, 0, ARM_Z), (s * 0.4, 0, ARM_Z)], [0.047, 0.042], "HM_Skin", segs=20, up=(0, 0, 1))  # 팔
    ob = p.to_object(f"Arm_{side}", f"Arm_{side}_Human")
    parent_to_bone(ob, f"upper_arm_{side}")
    p = Part()
    p.ellipsoid((s * 0.437, 0, ARM_Z), (0.056, 0.05, 0.058), "HM_Skin", segs=24, rings=16)
    p.ellipsoid((s * 0.425, -0.045, ARM_Z + 0.02), (0.022, 0.022, 0.024), "HM_Skin", segs=16, rings=10)  # 엄지
    ob = p.to_object(f"Hand_{side}", f"Hand_{side}_Human")
    parent_to_bone(ob, f"hand_{side}")

make_arm("L", 1)
make_arm("R", -1)

# ========== 다리 (leg) : 반바지 + 다리 + 양말 + 신발 ==========
def make_leg(side, s):
    x = s * 0.105
    p = Part()
    p.tube([(x, 0, 0.205), (x, 0, 0.13)], [0.087, 0.091], "HM_Shorts", segs=28, sy=0.95)
    ring = [(x + 0.093 * math.cos(2 * math.pi * k / 32), 0.088 * math.sin(2 * math.pi * k / 32), 0.133) for k in range(32)]
    p.tube(ring, [0.013] * 32, "HM_ShortsCuff", segs=10, closed=True)
    p.tube([(x, 0, 0.14), (x, 0, 0.04)], [0.042, 0.039], "HM_Skin", segs=20)
    p.tube([(x, 0, 0.06), (x, 0, 0.02)], [0.046, 0.046], "HM_Cream", segs=20)  # 양말
    p.ellipsoid((x, -0.025, 0.012), (0.068, 0.112, 0.052), "HM_Shoe", segs=28, rings=18)
    p.ellipsoid((x, -0.025, -0.02), (0.073, 0.118, 0.02), "HM_Sole", segs=28, rings=12)
    ob = p.to_object(f"Leg_{side}", f"Leg_{side}_Human")
    parent_to_bone(ob, f"leg_{side}")

make_leg("L", 1)
make_leg("R", -1)

# ---------- 저장 · 내보내기 ----------
for m in MATS.values():
    m.use_fake_user = False
bpy.context.scene["human_model"] = "Animal-Crossing style human (male, casual). Rig, bones and actions copied from robot.blend."
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format="GLB", export_apply=True,
    export_animations=True, export_animation_mode="ACTIONS", export_morph=True,
)
# 숨긴 오브젝트는 내보낼 때 위치·모디파이어가 틀어지므로, 내보낸 뒤에 기본(Short) 외 머리 모양을 숨긴다
for ob in bpy.data.objects:
    if ob.name.startswith("Hair_") and ob.name != "Hair_Short":
        ob.hide_viewport = ob.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
print("DONE", OUT_BLEND, OUT_GLB)
