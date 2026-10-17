"""Builds a person GLB from a Daz Genesis 9 character, clothing, and hair.

Run headless through scripts/build-people-assets.mjs, which also writes the rig file:

    blender -b --python tools/assets/build_people.py -- <model id> <output .glb>

Steps:
  1. Import the character, the Genesis 9 eyes, lashes, and mouth, the clothing,
     and the hair with the Diffeomorphic DAZ importer.
  2. Apply the character's body and head shape. Presets drive shapes through
     formulas headless Blender does not evaluate, so the formula weights are read
     from the morph files and set on the shape keys directly. Clothing, hair, and
     eyes were fitted to the base figure, so each of their vertices moves by the
     body's shape displacement around it (inverse-distance weighted).
  3. Thin the hair to a card budget, drop transparent eye and tear films.
  4. Weight every vertex to the stature rig's segment bones (feet, shins, thighs,
     pelvis, chest, neck, head, arms). Regions come from Genesis 9's own groups;
     within a region, segments split at landmark heights with smooth blends.
     Clothing, hair, and eyes take the weights of the body around them.
  5. Mark landmark vertices (`_LANDMARK`) and record bone pivots (glTF extras)
     for the rig file; replace Daz shaders with cropped PBR materials; export.

Content comes from the local Daz libraries (DAZ_LIBRARY plus DAZ_EXTRA_LIBRARIES,
separated by the OS path separator) and never enters git.
"""

import gzip
import json
import math
import os
import sys

import addon_utils
import bmesh
import bpy
import numpy as np
from mathutils import Matrix, kdtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_feet  # noqa: E402

LIBRARIES = [
    os.environ.get("DAZ_LIBRARY", "/Users/Shared/My DAZ 3D Library"),
    *os.environ.get("DAZ_EXTRA_LIBRARIES", "/Volumes/My Book/daz/Library").split(os.pathsep),
]
G9 = "People/Genesis 9"
ANATOMY = [f"{G9}/Anatomy/Daz Originals/Base Anatomy/Genesis 9 {part}.duf" for part in ("Eyes", "Eyelashes", "Mouth")]
BROWS = f"{G9}/Anatomy/Daz Originals/Base Anatomy/Eyebrows Card"
ANATOMY.append(f"{BROWS}/Style 02/G9 Eyebrows Card Style 02.duf")

# Catalog id -> character, clothing, hair. People are barefoot: heights compare sole to crown.
PEOPLE = {
    "female-tan-dress": {
        "character": "Laura",
        "wear": [f"{G9}/Clothing/Nelmi/Marcy Outfit/Marcy Dress.duf"],
        "hair": [f"{G9}/Hair/Daz Originals/Eirgrid Hair/Eirgrid Hair G9.duf"],
        "hair_presets": [f"{G9}/Hair/Daz Originals/Eirgrid Hair/Materials 3Delight/Eirgrid 10 M Brown.duf"],
        "brows": "Brown",
    },
    "female-dark-jeans-tshirt": {
        "character": "Amala",
        "wear": [
            f"{G9}/Clothing/Nelmi/Jean Outfit/Jean Pants.duf",
            f"{G9}/Clothing/BirthStone/BS Summer Casual Outfit for Genesis 9/Summer Casual T-Shirt.duf",
        ],
        "hair": [f"{G9}/Hair/Otart/Bounce Coil Curl/Bounce Coil Curl Hair G9.duf"],
        # The jeans ship white; tint them denim blue (linear multiply).
        "wear_tints": {"Jean Pants": [0.09, 0.16, 0.34]},
        "brows": "Black",
    },
    "female-pale-shorts-croptop": {
        "character": "Kat",
        "wear": [
            f"{G9}/Clothing/Spring Capsule/CHB SC Top 3 - Simple Crop Top.duf",
            # Denim shorts, despite the product's name.
            f"{G9}/Clothing/BirthStone/BS Summer Casual Outfit for Genesis 9/Summer Casual Jeans.duf",
        ],
        "hair": [f"{G9}/Hair/Out Of Touch/OOT Spring Style Bob Hair/Spring Style Bob Hair Genesis 9.duf"],
        # Neutral hair textures take their color from a tint: light brown.
        "hair_tint": [0.42, 0.28, 0.16],
        "brows": "Brown",
    },
    "male-tan-shorts-tshirt": {
        "character": "Ty",
        "wear": [
            f"{G9}/Clothing/Daz Originals/Base Clothing/G9 Base Shirt.duf",
            f"{G9}/Clothing/Daz Originals/Base Clothing/G9 Base Shorts.duf",
        ],
        "hair": [f"{G9}/Hair/BirthStone/BS Classic Short Hair/BS Classic Short Hair for Genesis 9.duf"],
        # The product ships ginger only; darken it to a dark brown (linear multiply).
        "hair_tint": [0.22, 0.16, 0.12],
        "brows": "Black",
    },
    "male-dark-jeans-sleeveless": {
        "character": "Fabrice",
        "wear": [
            f"{G9}/Clothing/dForce Classic Tank Top Outfit/dForce Classic Tank Top for Genesis 9.duf",
            f"{G9}/Clothing/CCox/50s Rebel G9/50s Rebel Jeans G9.duf",
        ],
        "hair": [f"{G9}/Hair/Daz Originals/Faded Afro Hair/G9 Faded Afro Hair.duf"],
        "brows": "Black",
    },
    "male-pale-trousers-shirt": {
        "character": "Matt",
        "wear": [
            f"{G9}/Clothing/3DStyle/Minimalist Unisex Outfit/MUO 01 Sweater.duf",
            f"{G9}/Clothing/3DStyle/Minimalist Unisex Outfit/MUO 02 Pants.duf",
        ],
        "hair": [f"{G9}/Hair/Daz Originals/004 Multilayered Short Hair/JL Hair 004-Multilayered Short Hair.duf"],
        "hair_presets": [f"{G9}/Hair/Daz Originals/004 Multilayered Short Hair/Materials/JL Hair 004-Golden.duf"],
        "brows": "Brown",
    },
}

BODY_VERTICES = 25182
MOUTH_PRESET = f"{G9}/Materials/Daz Originals/Base Materials/G9 Mouth MAT 01.duf"
HAIR_FACE_BUDGET = 30000
# Normal and roughness maps carry less visible detail than color; cap them lower.
DETAIL_TEXTURE_LIMIT = 1024
# Surfaces with no opaque glTF equivalent: the eye's wet film and the tear line.
DROPPED_SURFACES = ("EyeMoisture", "Cornea", "Tear")
TEXTURE_LIMITS = {"Head": 2048, "default": 1024, "Eye": 512, "Eyelashes": 512, "Eyebrows": 512, "Mouth": 512, "Teeth": 512}

# Segment bones of the stature rig, in rig order. Must match scripts/person-rig.mjs.
BONES = ["root", "foot.L", "foot.R", "shin.L", "shin.R", "thigh.L", "thigh.R", "pelvis", "chest", "neck", "head", "arm.L", "arm.R"]
BONE = {name: index for index, name in enumerate(BONES)}
# Landmark ids in the `_LANDMARK` attribute. Must match scripts/person-rig.mjs.
LANDMARKS = {
    "ankle": 1,
    "knee": 2,
    "crotch": 3,
    "shoulderLeft": 4,
    "shoulderRight": 5,
    "neck": 6,
    "ear": 7,
    "wrist": 8,
    "soleEnds": 9,
    "crown": 10,
    "hipLeft": 11,
    "hipRight": 12,
}


def log(message):
    print(f"[build_people] {message}", flush=True)


def content(path):
    for root in LIBRARIES:
        full = os.path.join(root, path)
        if os.path.exists(full):
            return full
    raise FileNotFoundError(f"{path} is in none of the Daz libraries: {', '.join(LIBRARIES)}")


def smoothstep(edge0, edge1, value):
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --- Import and shape -------------------------------------------------------


def import_person(spec):
    addon_utils.enable("bl_ext.user_default.import_daz", default_set=True)
    from bl_ext.user_default.import_daz import api

    api.set_silent_mode(True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    files = [content(f"{G9}/Characters/{spec['character']} for Genesis 9.duf")]
    files += [content(path) for path in ANATOMY + spec["wear"]]
    api.set_selection(files)
    bpy.ops.daz.import_daz_manually(fitMeshes="UNIQUE")
    before = set(bpy.data.objects)
    # Hair imports on its own, so whatever it adds is hair whatever its mesh is called.
    api.set_selection([content(path) for path in spec["hair"]])
    bpy.ops.daz.import_daz_manually(fitMeshes="UNIQUE")
    hair_objects = set(bpy.data.objects) - before
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH" and len(obj.data.vertices) > 0]
    body = next(obj for obj in meshes if len(obj.data.vertices) == BODY_VERTICES and spec["character"] in obj.name)
    for obj in meshes:
        for modifier in [m for m in obj.modifiers if m.type == "SUBSURF"]:
            obj.modifiers.remove(modifier)
    log(f"{spec['character']}: imported {', '.join(f'{obj.name} ({len(obj.data.vertices)})' for obj in meshes)}")
    hair = [obj for obj in meshes if obj in hair_objects]
    return body, [obj for obj in meshes if obj is not body], hair


def evaluated_world(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    evaluated.to_mesh_clear()
    co = co.reshape(-1, 3)
    world = np.array(obj.matrix_world)
    return co @ world[:3, :3].T + world[:3, 3]


def formula_weights(path, morph_id):
    """Shape key weights a character morph drives: output = morph value * k."""
    weights = {}
    for formula in build_feet.load_dsf(path)["modifier_library"][0].get("formulas", []):
        output = formula["output"].split("#")[-1].split("?")[0]
        ops = formula["operations"]
        if len(ops) == 3 and ops[0].get("url", "").endswith(f"{morph_id}?value") and ops[2].get("op") == "mult":
            weights[output] = ops[1]["val"]
    return weights


def apply_character_shape(body, character):
    rig = body.parent
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    folder = content(f"data/DAZ 3D/Genesis 9/Base/Morphs/Daz 3D/Base Characters 9/{character}_body_bs_body.dsf").rsplit("/", 1)[0]
    weights = {}
    for morph_id in (f"{character}_body_bs_body", f"{character}_head_bs_Head"):
        filename = next(name for name in os.listdir(folder) if name.lower() == f"{morph_id}.dsf".lower())
        bpy.ops.daz.import_custom_morphs(
            filepath=f"{folder}/{filename}", directory=folder + "/", files=[{"name": filename}], category="Character", onDrivers="RIG"
        )
        weights.update(formula_weights(f"{folder}/{filename}", morph_id))
        weights[morph_id] = 1.0
    keys = body.data.shape_keys
    applied = []
    for block in keys.key_blocks[1:] if keys else []:
        try:
            keys.driver_remove(f'key_blocks["{block.name}"].value')
        except TypeError:
            pass
        block.slider_min = -1.0
        block.value = weights.get(block.name, 0.0)
        if block.value:
            applied.append(f"{block.name}={block.value:g}")
    log(f"{character}: shape {', '.join(applied)}")


def transfer_shape(base, shaped, accessories):
    """Moves each accessory vertex by the body displacement around it."""
    displacement = shaped - base
    tree = kdtree.KDTree(len(base))
    for index, point in enumerate(base):
        tree.insert(point, index)
    tree.balance()
    moved = {}
    for obj in accessories:
        points = evaluated_world(obj)
        result = np.empty_like(points)
        for row, point in enumerate(points):
            near = tree.find_n(point, 8)
            weights = np.array([1.0 / max(distance, 1e-5) for _, _, distance in near])
            indices = [index for _, index, _ in near]
            result[row] = point + (weights[:, None] * displacement[indices]).sum(axis=0) / weights.sum()
        moved[obj] = result
    return moved, tree


def bake(body, accessories, moved):
    """Freezes every mesh in world space and removes the Daz rigs and modifiers."""
    bpy.context.view_layer.objects.active = body
    for obj in bpy.data.objects:
        obj.select_set(obj is body)
    if body.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for obj in [body, *accessories]:
        for modifier in list(obj.modifiers):
            obj.modifiers.remove(modifier)
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        if obj is body:
            obj.data.transform(world)
        else:
            if obj.data.shape_keys:
                obj.shape_key_clear()
            obj.data.vertices.foreach_set("co", moved[obj].astype(np.float32).ravel())
        obj.data.update()
    for obj in list(bpy.data.objects):
        if obj.type != "MESH" or obj not in (body, *accessories):
            bpy.data.objects.remove(obj, do_unlink=True)


# --- Cleanup ----------------------------------------------------------------


def drop_surfaces(objects):
    kept = []
    for obj in objects:
        doomed = {i for i, mat in enumerate(obj.data.materials) if mat and any(tag in mat.name for tag in DROPPED_SURFACES)}
        if doomed:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.delete(bm, geom=[face for face in bm.faces if face.material_index in doomed], context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
            bm.to_mesh(obj.data)
            bm.free()
        if len(obj.data.polygons) == 0:
            bpy.data.objects.remove(obj, do_unlink=True)
        else:
            kept.append(obj)
    return kept


def thin_hair(obj, budget):
    """Keeps the scalp cap and an even subset of hair cards within a face budget."""
    faces = len(obj.data.polygons)
    if faces <= budget:
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    cards = []
    for face in bm.faces:
        if face.index in seen:
            continue
        stack, card = [face], []
        seen.add(face.index)
        while stack:
            current = stack.pop()
            card.append(current)
            for edge in current.edges:
                for other in edge.link_faces:
                    if other.index not in seen:
                        seen.add(other.index)
                        stack.append(other)
        cards.append(card)
    cards.sort(key=len, reverse=True)
    keep_ratio = (budget - len(cards[0])) / max(1, faces - len(cards[0]))
    doomed = []
    accumulated = 0.0
    for card in cards[1:]:
        accumulated += keep_ratio
        if accumulated >= 1.0:
            accumulated -= 1.0
        else:
            doomed.extend(card)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    log(f"{obj.name}: thinned {faces} faces in {len(cards)} cards to {len(obj.data.polygons)}")


# --- Weights, landmarks, pivots ----------------------------------------------


def group_matrix(obj):
    """Per vertex weight of every vertex group, as an array indexed by group index."""
    weights = np.zeros((len(obj.data.vertices), len(obj.vertex_groups)))
    for vertex in obj.data.vertices:
        for element in vertex.groups:
            weights[vertex.index, element.group] = element.weight
    return weights


def region_weights(body):
    """Per vertex membership of leg L/R, arm L/R, head, and core, from Genesis 9 groups."""
    groups = group_matrix(body)
    names = [group.name for group in body.vertex_groups]

    def total(predicate):
        columns = [i for i, name in enumerate(names) if predicate(name)]
        return groups[:, columns].sum(axis=1) if columns else np.zeros(len(groups))

    leg_parts = ("thightwist", "shin", "foot", "metatarsal", "toe")
    arm_parts = ("upperarmtwist", "forearmtwist", "hand", "index", "mid", "ring", "pinky", "thumb", "metacarpal")
    head_names = {"head", "chin", "lowerjaw", "lowerteeth", "centerbrow", "liplowermiddle", "lipuppermiddle"}
    head_parts = ("brow", "cheek", "ear", "eyelid", "infraorbital", "lip", "nostril", "squint")
    foot_parts = ("foot", "metatarsal", "toe")
    regions = {}
    for side in ("l", "r"):
        regions[f"leg.{side}"] = total(lambda n, s=side: n.startswith(f"{s}_") and any(p in n for p in leg_parts))
        regions[f"foot.{side}"] = total(lambda n, s=side: n.startswith(f"{s}_") and any(p in n[2:] for p in foot_parts) and "metacarpal" not in n)
        # Toe groups (l_indextoe1, l_midtoe1, ...) share finger prefixes; they belong to the leg.
        regions[f"arm.{side}"] = total(
            lambda n, s=side: n.startswith(f"{s}_") and "toe" not in n and any(n[2:].startswith(p) for p in arm_parts)
        )
    regions["head"] = total(lambda n: n in head_names or (n[:2] in ("l_", "r_") and any(n[2:].startswith(p) for p in head_parts)))
    regions["neck"] = total(lambda n: n.startswith("neck"))
    covered = sum(regions[k] for k in ("leg.l", "leg.r", "arm.l", "arm.r", "head", "neck"))
    regions["core"] = np.clip(1.0 - covered, 0.0, 1.0)
    total_weight = covered + regions["core"]
    for key in regions:
        regions[key] = regions[key] / np.maximum(total_weight, 1e-6)
    return regions


def find_landmarks(body, regions):
    """Landmark vertex indices on the shaped body, found by anatomy-based rules."""
    co = np.array([v.co[:] for v in body.data.vertices])
    floor = co[:, 2].min()
    height = co[:, 2] - floor
    stature = height.max()
    left_leg = regions["leg.l"] > 0.5
    left_arm = regions["arm.l"]
    core = regions["core"] > 0.5
    names = [group.name for group in body.vertex_groups]
    groups = group_matrix(body)

    def pick(mask, score):
        candidates = np.flatnonzero(mask)
        if candidates.size == 0:
            raise RuntimeError("A landmark rule matched no vertices.")
        return int(candidates[np.argmax(score[candidates])])

    band = lambda low, high: (height >= low * stature) & (height <= high * stature)
    marks = {}
    shin = groups[:, names.index("l_shin")]
    foot = groups[:, names.index("l_foot")]
    # Lateral malleolus: the outermost point of the left ankle above the foot.
    marks["ankle"] = [pick(left_leg & band(0.032, 0.055) & (foot < 0.5), co[:, 0])]
    # Mid-patella: the front of the left knee at the middle of the thigh-to-shin handover (front is -y).
    knee_zone = left_leg & (shin > 0.3) & (shin < 0.7) & (foot < 0.05)
    knee_mid = np.median(height[knee_zone])
    marks["knee"] = [pick(knee_zone & (np.abs(height - knee_mid) < 0.01), -co[:, 1])]
    # Crotch: the lowest point of the trunk on the midline.
    marks["crotch"] = [pick(core & (np.abs(co[:, 0]) < 0.012), -height)]
    # Acromion: the outermost point of the left shoulder, where trunk and arm meet.
    shoulder_zone = (left_arm > 0.1) & (left_arm < 0.6) & (co[:, 0] > 0) & band(0.76, 0.88)
    left_shoulder = pick(shoulder_zone, co[:, 0])
    marks["shoulderLeft"] = [left_shoulder]
    mirror = co[left_shoulder] * np.array([-1, 1, 1])
    marks["shoulderRight"] = [int(np.argmin(np.linalg.norm(co - mirror, axis=1)))]
    # Cervicale: where the neck meets the back, on the midline (Blender's back is +y).
    marks["neck"] = [pick((np.abs(co[:, 0]) < 0.012) & (regions["neck"] > 0.3) & (co[:, 1] > 0), -height)]
    # Tragion: the front of the left ear opening, at the ear's mid-height.
    ear = groups[:, names.index("l_ear")] > 0.5
    ear_mid = np.median(height[ear])
    marks["ear"] = [pick(ear & (np.abs(height - ear_mid) < 0.006), -co[:, 1])]
    # Wrist: the ring where the left hand takes over from the forearm.
    hand = groups[:, names.index("l_hand")]
    marks["wrist"] = list(np.flatnonzero((hand > 0.35) & (hand < 0.65) & (left_arm > 0.9)))
    # Foot length: both ends of the left sole.
    sole = left_leg & (height < 0.03) & (regions["foot.l"] > 0.5)
    forward = -co[:, 1]
    sole_low, sole_high = forward[sole].min(), forward[sole].max()
    marks["soleEnds"] = list(np.flatnonzero(sole & ((forward < sole_low + 0.004) | (forward > sole_high - 0.004))))
    marks["crown"] = [int(np.argmax(height))]
    # Hip breadth: the widest point of the hips just above the crotch, each side.
    crotch_height = height[marks["crotch"][0]]
    hips = (height > crotch_height) & (height < crotch_height + 0.12 * stature) & (regions["arm.l"] + regions["arm.r"] < 0.1)
    marks["hipLeft"] = [pick(hips, co[:, 0])]
    marks["hipRight"] = [pick(hips, -co[:, 0])]
    return marks


def landmark_height(body, marks, name):
    co = np.array([body.data.vertices[i].co[:] for i in marks[name]])
    floor = min(v.co.z for v in body.data.vertices)
    return co[:, 2].max() - floor


def segment_weights(points, regions, levels, blend):
    """Per vertex weights over BONES from region memberships and landmark heights."""
    heights = points[:, 2]
    weights = np.zeros((len(points), len(BONES)))
    for side, suffix in (("l", "L"), ("r", "R")):
        leg = regions[f"leg.{side}"]
        above_ankle = smoothstep(levels["ankle"] - blend, levels["ankle"] + blend, heights)
        above_knee = smoothstep(levels["knee"] - blend, levels["knee"] + blend, heights)
        weights[:, BONE[f"foot.{suffix}"]] += leg * (1 - above_ankle)
        weights[:, BONE[f"shin.{suffix}"]] += leg * above_ankle * (1 - above_knee)
        weights[:, BONE[f"thigh.{suffix}"]] += leg * above_knee
        weights[:, BONE[f"arm.{suffix}"]] += regions[f"arm.{side}"]
    above_shoulder = smoothstep(levels["shoulder"] - blend, levels["shoulder"] + blend, heights)
    weights[:, BONE["pelvis"]] += regions["core"] * (1 - above_shoulder)
    weights[:, BONE["chest"]] += regions["core"] * above_shoulder
    weights[:, BONE["neck"]] += regions["neck"]
    weights[:, BONE["head"]] += regions["head"]
    return weights / np.maximum(weights.sum(axis=1, keepdims=True), 1e-6)


def top_four(weights):
    order = np.argsort(-weights, axis=1)[:, :4]
    values = np.take_along_axis(weights, order, axis=1)
    values = values / np.maximum(values.sum(axis=1, keepdims=True), 1e-6)
    return order.astype(np.float32), values.astype(np.float32)


def write_vector_attribute(obj, name, values):
    attribute = obj.data.attributes.new(name, "FLOAT_COLOR", "POINT")
    attribute.data.foreach_set("color", values.astype(np.float32).ravel())


def rig_body_and_accessories(body, accessories):
    regions = region_weights(body)
    marks = find_landmarks(body, regions)
    floor = min(v.co.z for v in body.data.vertices)
    stature = max(v.co.z for v in body.data.vertices) - floor
    levels = {name: landmark_height(body, marks, name) + floor for name in ("ankle", "knee", "crotch", "neck", "ear")}
    levels["shoulder"] = landmark_height(body, marks, "shoulderLeft") + floor
    blend = 0.012 * stature

    body_points = np.array([v.co[:] for v in body.data.vertices])
    body_weights = segment_weights(body_points, regions, levels, blend)
    index, weight = top_four(body_weights)
    write_vector_attribute(body, "_SKIN_INDEX", index)
    write_vector_attribute(body, "_SKIN_WEIGHT", weight)
    landmark = np.zeros((len(body_points), 4), dtype=np.float32)
    for name, vertices in marks.items():
        landmark[vertices, 0] = LANDMARKS[name]
    write_vector_attribute(body, "_LANDMARK", landmark)

    tree = kdtree.KDTree(len(body_points))
    for i, point in enumerate(body_points):
        tree.insert(point, i)
    tree.balance()
    for obj in accessories:
        points = np.array([v.co[:] for v in obj.data.vertices])
        blended = np.zeros((len(points), len(BONES)))
        for row, point in enumerate(points):
            near = tree.find_n(point, 4)
            near_weights = np.array([1.0 / max(distance, 1e-5) for _, _, distance in near])
            blended[row] = (near_weights[:, None] * body_weights[[i for _, i, _ in near]]).sum(axis=0) / near_weights.sum()
        index, weight = top_four(blended)
        write_vector_attribute(obj, "_SKIN_INDEX", index)
        write_vector_attribute(obj, "_SKIN_WEIGHT", weight)

    # Bone pivots, in Blender coordinates (z up, -y forward); the rig writer converts.
    co = body_points
    left_shoulder = co[marks["shoulderLeft"][0]]
    heel_y = co[marks["soleEnds"]][:, 1].max()
    pivots = {
        "root": [0, 0, floor],
        "foot.L": [0, heel_y, floor],
        "foot.R": [0, heel_y, floor],
        "shin.L": [0, 0, levels["ankle"]],
        "shin.R": [0, 0, levels["ankle"]],
        "thigh.L": [0, 0, levels["knee"]],
        "thigh.R": [0, 0, levels["knee"]],
        "pelvis": [0, 0, levels["crotch"]],
        "chest": [0, 0, levels["shoulder"]],
        "neck": [0, 0, levels["neck"]],
        "head": [0, co[marks["ear"][0]][1], levels["ear"]],
        # Arms scale uniformly about the shoulder joint, just inside the acromion.
        "arm.L": [left_shoulder[0] - 0.03, left_shoulder[1], left_shoulder[2] - 0.04],
        "arm.R": [-(left_shoulder[0] - 0.03), left_shoulder[1], left_shoulder[2] - 0.04],
    }
    body["rigPivots"] = json.dumps({name: [float(v) for v in value] for name, value in pivots.items()})
    log(f"landmarks: stature {stature * 1000:.0f} mm, " + ", ".join(f"{k} {(v - floor) * 1000:.0f}" for k, v in levels.items()))


def drop_to_floor(objects, body):
    """Puts the soles on z = 0. Hems cut for shoes would hang below a bare foot; they rest on the floor."""
    lowest = min(v.co.z for v in body.data.vertices)
    for obj in objects:
        obj.data.transform(Matrix.Translation((0, 0, -lowest)))
        if obj is not body:
            for vertex in obj.data.vertices:
                if vertex.co.z < 0:
                    vertex.co.z = 0.0


# --- Materials ----------------------------------------------------------------


def images_in(node_tree, found=None):
    """Every image a material uses, including inside node groups."""
    found = found if found is not None else []
    for node in node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image and node.image.filepath:
            found.append(node.image)
        elif node.type == "GROUP" and node.node_tree:
            images_in(node.node_tree, found)
    return found


def link_role(node):
    """What an image node drives, judged by the sockets its output links into."""
    targets = [(link.to_node, link.to_socket.name) for output in node.outputs for link in output.links]
    if any(socket in ("Alpha", "Cutout Opacity") or (socket == "Fac" and "Transparent" in target.name) for target, socket in targets):
        # Skin shaders route translucency maps through similar sockets; only real cutouts count.
        name = os.path.basename(node.image.filepath).lower()
        return "alpha" if any(tag in name for tag in ("trans", "opac", "cutout", "alpha", "mask")) else None
    if any(target.type == "NORMAL_MAP" or socket == "Normal" for target, socket in targets):
        return "normal"
    if any(socket == "Roughness" for _, socket in targets):
        return "roughness"
    if any(socket in ("Base Color", "Color", "Diffuse Color") and target.type in ("BSDF_PRINCIPLED", "BSDF_DIFFUSE") for target, socket in targets):
        return "color"
    if any(target.type in ("MIX", "MIX_RGB") and socket in ("A", "B", "Color1", "Color2") for target, socket in targets):
        return "color?"
    return None


NAME_ROLES = (
    ("normal", ("_nm", "normal", "_nrm")),
    ("alpha", ("_trans", "opacity", "alpha", "cutout", "_mask")),
    ("roughness", ("_r_", "rough")),
    ("color", ("_d_", "diffuse", "basecolor", "base_color", "_base", "albedo", "_col", "color", "_tx")),
)


def multiply_tint(node):
    """The constant color a MULTIPLY mix applies to an image, if any."""
    for link in (link for output in node.outputs for link in output.links):
        mix = link.to_node
        if mix.type in ("MIX", "MIX_RGB") and getattr(mix, "blend_type", "") == "MULTIPLY":
            for socket in mix.inputs:
                if socket.enabled and not socket.is_linked and socket.name in ("A", "B", "Color1", "Color2"):
                    return list(socket.default_value)[:3]
    return None


def classify(material):
    """Maps roles (color, normal, roughness, alpha) to images, by node links first, then names.

    A color reached through a MULTIPLY mix carries the mix's constant color as `tint`.
    """
    roles = {}
    guesses = {}

    def walk(tree):
        for node in tree.nodes:
            if node.type == "TEX_IMAGE" and node.image and node.image.filepath:
                role = link_role(node)
                if role == "color?":
                    if "color" not in guesses:
                        guesses["color"] = node.image
                        tint = multiply_tint(node)
                        if tint is not None:
                            guesses["tint"] = tint
                elif role:
                    roles.setdefault(role, node.image)
            elif node.type == "GROUP" and node.node_tree:
                walk(node.node_tree)

    walk(material.node_tree)
    for role, image in guesses.items():
        roles.setdefault(role, image)
    if "color" in roles:
        roles.pop("tint", None)
    for image in images_in(material.node_tree):
        name = os.path.basename(image.filepath).lower()
        for role, tags in NAME_ROLES:
            if role not in roles and image not in roles.values() and any(tag in name for tag in tags):
                roles[role] = image
                break
    return roles


def preset_textures(preset):
    """Texture layers and color tints a Daz material preset assigns, per surface.

    Presets set channels through animation keys; an image may be a file or a
    layered entry of the image library (for example sclera with the iris over it).
    """
    data = build_feet.load_dsf(preset)
    library = {entry["id"]: [layer["url"] for layer in entry.get("map", []) if layer.get("url")] for entry in data.get("image_library", [])}
    channel_roles = {
        "diffuse": "color",
        "Cutout%20Opacity": "alpha",
        "Normal%20Map": "normal",
        "Specular%20Lobe%201%20Roughness": "roughness",
        "Glossy%20Roughness": "roughness",
    }
    surfaces = {}
    for animation in data["scene"].get("animations", []):
        url = animation["url"]
        if "#materials/" not in url:
            continue
        surface, _, channel_path = url.split("#materials/", 1)[1].partition(":?")
        surface = surface.replace("%20", " ")
        value = animation.get("keys", [[0, None]])[0][1]
        parts = channel_path.split("/")
        channel = parts[0] if parts[0] == "diffuse" else (parts[3] if len(parts) > 3 and parts[1] == "studio_material_channels" else None)
        role = channel_roles.get(channel)
        if role is None or value in (None, ""):
            continue
        entry = surfaces.setdefault(surface, {})
        if parts[-1] in ("image_file", "image") and isinstance(value, str):
            layers = library.get(value.lstrip("#").replace("%20", " "), library.get(value.lstrip("#"), [value]))
            entry[role] = [content(layer.lstrip("/").replace("%20", " ")) for layer in layers if layer]
        elif parts[-1] == "value" and role == "color" and isinstance(value, list):
            entry["tint"] = value
    return surfaces


def texture_limit(material_name):
    for key, size in TEXTURE_LIMITS.items():
        if key != "default" and key.lower() in material_name.lower():
            return size
    return TEXTURE_LIMITS["default"]


def convert_materials(objects, model_id, workdir, presets, hair_names=(), hair_tint=None, wear_tints=None):
    """Replaces Daz shaders with glTF PBR materials and cropped, resized textures.

    Roles come from the Daz shader (node links, then file names); a material
    preset for the surface (eyes, lashes, brows, mouth, hair color) overrides the
    roles it sets. Layers composite and tints multiply in linear light.
    """
    cache = {}
    converted = {}
    for obj in objects:
        uv = obj.data.uv_layers.active
        for index, source in enumerate(obj.data.materials):
            if source is None:
                continue
            loops = [loop for poly in obj.data.polygons if poly.material_index == index for loop in poly.loop_indices]
            if not loops:
                continue
            surface = source.name.rsplit("-", 1)[0].strip()
            name = f"{model_id}_{surface.replace(' ', '_')}_{obj.name.split(' ')[0]}"
            roles = classify(source) if source.use_nodes else {}
            sources = {role: [image_path(image)] for role, image in roles.items() if role != "tint"}
            tint = roles.get("tint")
            preset = presets.get(surface, {})
            for role, layers in preset.items():
                if role == "tint":
                    # Daz stores color channel values as sRGB picker values; Blender node tints are linear.
                    tint = to_linear(np.asarray(layers[:3], dtype=np.float32)).tolist()
                else:
                    sources[role] = layers
            extra = hair_tint if obj.name in hair_names else next(
                (rgb for key, rgb in (wear_tints or {}).items() if key in obj.name), None
            )
            if extra is not None and "color" in sources:
                tint = [a * b for a, b in zip(tint or [1.0, 1.0, 1.0], extra)]
            if "color" not in sources and "alpha" in sources:
                # Lashes and brows without an albedo: dark keratin under the cutout.
                tint, sources["color"] = tint or [0.035, 0.025, 0.02], None

            coords = np.array([uv.data[i].uv[:] for i in loops]) if uv else np.zeros((1, 2))
            tile = np.floor(coords.min(axis=0))
            lo, hi = np.clip(coords.min(axis=0) - tile - 0.004, 0, 1), np.clip(coords.max(axis=0) - tile + 0.004, 0, 1)
            if (hi - lo).min() <= 0.01:
                lo, hi = np.zeros(2), np.ones(2)
            for i in loops:
                u, v = uv.data[i].uv
                uv.data[i].uv = ((u - tile[0] - lo[0]) / (hi[0] - lo[0]), (v - tile[1] - lo[1]) / (hi[1] - lo[1]))

            material = bpy.data.materials.new(name)
            material.use_nodes = True
            nodes, links = material.node_tree.nodes, material.node_tree.links
            shader = nodes["Principled BSDF"]
            shader.inputs["Metallic"].default_value = 0.0
            limit = texture_limit(surface)
            if "color" in sources:
                color = layered(cache, sources["color"], tint, sources.get("alpha"))
                texture = nodes.new("ShaderNodeTexImage")
                texture.image = save_crop(color, lo, hi, f"{name}_color", workdir, limit)
                links.new(texture.outputs["Color"], shader.inputs["Base Color"])
                if color.shape[2] == 4:
                    links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
            else:
                # No color texture: a flat color from the tint, or the garment's own tint.
                flat = tint or extra or [0.5, 0.45, 0.42]
                shader.inputs["Base Color"].default_value = (*flat, 1)
            for role, socket in (("roughness", "Roughness"), ("normal", "Normal")):
                if role not in sources:
                    continue
                texture = nodes.new("ShaderNodeTexImage")
                texture.image = save_crop(layered(cache, sources[role]), lo, hi, f"{name}_{role}", workdir, min(limit, DETAIL_TEXTURE_LIMIT))
                texture.image.colorspace_settings.name = "Non-Color"
                if role == "roughness":
                    links.new(texture.outputs["Color"], shader.inputs["Roughness"])
                else:
                    normal = nodes.new("ShaderNodeNormalMap")
                    links.new(texture.outputs["Color"], normal.inputs["Color"])
                    links.new(normal.outputs["Normal"], shader.inputs["Normal"])
            obj.data.materials[index] = material
            converted[name] = ("preset+" if preset else "") + "/".join(sorted(sources))
    log("materials: " + "; ".join(f"{name} [{roles}]" for name, roles in converted.items()))


def image_path(image):
    return image if isinstance(image, str) else bpy.path.abspath(image.filepath)


def read_pixels(path, size=None):
    """An image as float RGB(A) in [0, 1], rows top to bottom, optionally resized."""
    import OpenImageIO as oiio

    # Straight (unassociated) alpha: OIIO would otherwise premultiply on read.
    config = oiio.ImageSpec()
    config.attribute("oiio:UnassociatedAlpha", 1)
    buf = oiio.ImageBuf(path, 0, 0, config)
    if size is not None and (buf.spec().width, buf.spec().height) != size:
        buf = oiio.ImageBufAlgo.resize(buf, roi=oiio.ROI(0, size[0], 0, size[1], 0, 1, 0, buf.spec().nchannels))
    pixels = np.asarray(buf.get_pixels(oiio.FLOAT), dtype=np.float32)
    if pixels.ndim == 2:
        pixels = pixels[:, :, None]
    if pixels.shape[2] == 1:
        pixels = np.repeat(pixels, 3, axis=2)
    return pixels


def to_linear(srgb):
    return np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)


def to_srgb(linear):
    linear = np.clip(linear, 0.0, 1.0)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)


def layered(cache, layers, tint=None, alpha=None):
    """Composites layers bottom to top by their own alpha, tints in linear light,
    and appends an alpha channel from `alpha` (a cutout map) when given.
    `layers` None means a flat white base (tinted below)."""
    key = (tuple(layers) if layers else None, tuple(tint) if tint else None, tuple(alpha) if alpha else None)
    if key in cache:
        return cache[key]
    if layers:
        base = read_pixels(layers[0])
        size = (base.shape[1], base.shape[0])
        result = to_linear(base[:, :, :3])
        for layer in layers[1:]:
            # Daz layers sit at the canvas's top-left at their own size (offset 0, scale 1).
            pixels = read_pixels(layer)
            h, w = min(pixels.shape[0], result.shape[0]), min(pixels.shape[1], result.shape[1])
            pixels = pixels[:h, :w]
            over = pixels[:, :, 3:4] if pixels.shape[2] == 4 else 1.0
            result[:h, :w] = to_linear(pixels[:, :, :3]) * over + result[:h, :w] * (1 - over)
    else:
        mask = read_pixels(alpha[0])
        size = (mask.shape[1], mask.shape[0])
        result = np.ones((size[1], size[0], 3), dtype=np.float32)
    if tint is not None:
        result = result * np.asarray(tint[:3], dtype=np.float32)
    result = to_srgb(result)
    if alpha:
        mask = read_pixels(alpha[0], (result.shape[1], result.shape[0]))[:, :, :1]
        result = np.concatenate([result, mask], axis=2)
    cache[key] = result.astype(np.float32)
    return cache[key]


def save_crop(pixels, lo, hi, name, workdir, limit):
    """Crops UV region [lo, hi] (v up) out of a top-to-bottom pixel array, resizes, saves."""
    import OpenImageIO as oiio

    height, width, channels = pixels.shape
    x0, x1 = int(lo[0] * width), int(math.ceil(hi[0] * width))
    y0, y1 = int((1 - hi[1]) * height), int(math.ceil((1 - lo[1]) * height))
    region = np.ascontiguousarray(pixels[y0:y1, x0:x1])
    buf = oiio.ImageBuf(oiio.ImageSpec(region.shape[1], region.shape[0], channels, oiio.FLOAT))
    buf.set_pixels(oiio.ROI(), region)
    scale = min(1.0, limit / max(region.shape[0], region.shape[1]))
    if scale < 1.0:
        size = oiio.ROI(0, max(1, round(region.shape[1] * scale)), 0, max(1, round(region.shape[0] * scale)), 0, 1, 0, channels)
        buf = oiio.ImageBufAlgo.resize(buf, roi=size)
    path = os.path.join(workdir, f"{name}.{'png' if channels == 4 else 'jpg'}")
    out = oiio.ImageBuf(oiio.ImageSpec(buf.spec().width, buf.spec().height, channels, oiio.UINT8))
    oiio.ImageBufAlgo.copy(out, buf, oiio.UINT8)
    # Our RGB is straight alpha; without this OIIO divides it by alpha when writing PNG.
    out.specmod().attribute("oiio:UnassociatedAlpha", 1)
    if channels != 4:
        out.specmod().attribute("Compression", "jpeg:90")
    if not out.write(path):
        raise RuntimeError(f"Could not write {path}: {out.geterror()}")
    image = bpy.data.images.load(path)
    image.name = name
    return image


# --- Export -------------------------------------------------------------------


def name_meshes(body, accessories, hair):
    """Body, Eyes, Eyelashes, Mouth, Hair <name>, Clothing <name>."""
    body.name = body.data.name = "Body"
    for obj in accessories:
        label = obj.name.replace(" Mesh", "").replace("Genesis 9 ", "")
        if obj.name in hair:
            label = f"Hair {label}"
        elif label.startswith("G9 Eyebrows"):
            label = "Eyebrows"
        elif label not in ("Eyes", "Eyelashes", "Mouth"):
            label = f"Clothing {label}"
        obj.name = obj.data.name = label


def export(objects, path):
    for obj in bpy.data.objects:
        obj.select_set(obj in objects)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_attributes=True,
        export_tangents=False,
        export_skins=False,
        export_morph=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_image_format="AUTO",
        export_jpeg_quality=90,
    )


def main():
    model_id, output = sys.argv[sys.argv.index("--") + 1 :][:2]
    spec = PEOPLE[model_id]
    workdir = os.path.join(os.path.dirname(os.path.abspath(output)), f".{model_id}-textures")
    os.makedirs(workdir, exist_ok=True)

    body, accessories, hair = import_person(spec)
    hair_names = {obj.name for obj in hair}
    for obj in hair:
        thin_hair(obj, HAIR_FACE_BUDGET // max(1, len(hair)))
    base = evaluated_world(body)
    apply_character_shape(body, spec["character"])
    shaped = evaluated_world(body)
    log(f"largest shape displacement {np.abs(shaped - base).max() * 1000:.1f} mm")
    moved, _ = transfer_shape(base, shaped, accessories)
    bake(body, accessories, moved)
    accessories = drop_surfaces([obj for obj in bpy.data.objects if obj.type == "MESH" and obj is not body])
    drop_to_floor([body, *accessories], body)
    rig_body_and_accessories(body, accessories)
    presets = {}
    folder = f"{G9}/Characters/Daz Originals/{spec['character']} G9/Materials"
    preset_files = [
        f"{folder}/{spec['character']} G9 Eyes.duf",
        f"{folder}/{spec['character']} G9 Eyelashes.duf",
        MOUTH_PRESET,
        f"{BROWS}/Materials/G9 Eyebrows Color {spec.get('brows', 'Brown')}.duf",
        *spec.get("hair_presets", []),
    ]
    for preset in preset_files:
        for surface, roles in preset_textures(content(preset)).items():
            presets.setdefault(surface, {}).update(roles)
    convert_materials([body, *accessories], model_id, workdir, presets, hair_names, spec.get("hair_tint"), spec.get("wear_tints"))
    name_meshes(body, accessories, hair_names)
    export([body, *accessories], output)
    total = sum(len(obj.data.polygons) for obj in [body, *accessories])
    log(f"wrote {output}: {len(accessories) + 1} meshes, {total} faces")


if __name__ == "__main__":
    main()
