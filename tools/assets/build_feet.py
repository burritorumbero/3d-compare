"""Builds a feet GLB (a pair of feet cut at mid-shin) from a Daz Genesis 9 character.

Run headless through scripts/build-feet-assets.mjs, which also writes the rig file:

    blender -b --python tools/assets/build_feet.py -- <model id> <output .glb>

Steps:
  1. Import the character with the Diffeomorphic DAZ importer and apply its body
     shape. Character presets drive their shape through formulas, which headless
     Blender does not evaluate, so this sets the formula's shape key weights directly.
  2. Keep the lower legs, subdivide once for detail, cut flat at mid-shin, and cap.
  3. Derive three deform weights per vertex (shin, foot, toes) from Genesis 9's own
     bone weights and store them as the `_DEFORM_WEIGHTS` vertex attribute. The app
     rebuilds a skeleton from the rig file and skins the mesh with these weights.
  4. Split into LeftFootAndShin and RightFootAndShin, put the soles on y = 0.
  5. Replace Daz shaders with glTF PBR materials (base color, normal, roughness),
     with the textures cropped to the part of their UDIM tile the feet use. The
     diffuse map is the albedo, as in standard Daz-to-real-time exports; Iray's
     subsurface scattering has no glTF equivalent.

The Daz content comes from the local library (DAZ_LIBRARY, default
/Users/Shared/My DAZ 3D Library) and never enters git.
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
from mathutils import Matrix

LIBRARY = os.environ.get("DAZ_LIBRARY", "/Users/Shared/My DAZ 3D Library")

# Model id -> Genesis 9 character. Skin tones match the catalog: Laura's legs
# average a tan tone, Matt's a pale one.
FEET = {
    "female-feet-shins": "Laura",
    "male-feet-shins": "Matt",
}

# The cut sits this many foot lengths above the floor (the previous pack used 1.23-1.4).
CUT_RATIO = 1.3
# Shin weight hands over to the foot between these heights, as ratios of foot
# length: above the lateral malleolus (ANSUR II ~0.27), so the instep is pure foot.
SHIN_HANDOVER = (0.30, 0.42)
TEXTURE_MAX = 2048
TEXTURE_PAD_PX = 12

FOOT_GROUPS = ("foot", "metatarsal")
SHIN_GROUPS = ("shin", "thigh")


def log(message):
    print(f"[build_feet] {message}", flush=True)


def load_dsf(path):
    raw = open(path, "rb").read()
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass
    return json.loads(raw)


def import_character(name):
    addon_utils.enable("bl_ext.user_default.import_daz", default_set=True)
    from bl_ext.user_default.import_daz import api

    api.set_silent_mode(True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    api.set_selection([f"{LIBRARY}/People/Genesis 9/Characters/{name} for Genesis 9.duf"])
    bpy.ops.daz.import_daz_manually(fitMeshes="UNIQUE")
    rig = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
    mesh = next(obj for obj in bpy.data.objects if obj.type == "MESH")
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)

    morph = f"{LIBRARY}/data/DAZ 3D/Genesis 9/Base/Morphs/Daz 3D/Base Characters 9/{name}_body_bs_body.dsf"
    bpy.ops.daz.import_custom_morphs(
        filepath=morph,
        directory=os.path.dirname(morph) + "/",
        files=[{"name": os.path.basename(morph)}],
        category="Character",
        onDrivers="RIG",
    )
    modifier = load_dsf(morph)["modifier_library"][0]
    weights = {}
    for formula in modifier.get("formulas", []):
        output = formula["output"].split("#")[-1].split("?")[0]
        ops = formula["operations"]
        source = ops[0].get("url", "") if ops else ""
        if len(ops) == 3 and source.endswith(f"{name}_body_bs_body?value") and ops[2].get("op") == "mult":
            weights[output] = ops[1]["val"]

    keys = mesh.data.shape_keys
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
    skipped = [output for output in weights if not (keys and output in keys.key_blocks)]
    log(f"{name}: shape {', '.join(applied)}; not applied (bone-scale controls): {', '.join(skipped) or 'none'}")
    return rig, mesh


def bake_mesh(rig, mesh):
    """Freezes the shaped mesh in world space and drops the Daz rig and modifiers."""
    bpy.context.view_layer.objects.active = mesh
    for obj in bpy.data.objects:
        obj.select_set(obj == mesh)
    if mesh.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for modifier in list(mesh.modifiers):
        mesh.modifiers.remove(modifier)
    world = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.data.transform(world)
    mesh.matrix_world = Matrix.Identity(4)
    bpy.data.objects.remove(rig, do_unlink=True)
    for obj in list(bpy.data.objects):
        if obj != mesh:
            bpy.data.objects.remove(obj, do_unlink=True)


def group_weights(mesh, side):
    """Per vertex (shin, foot, toes) sums of Genesis 9 weights on one side."""
    kinds = {}
    for group in mesh.vertex_groups:
        name = group.name
        if not name.startswith(f"{side}_"):
            continue
        part = name[2:]
        if "toe" in part:
            kinds[group.index] = 2
        elif part in FOOT_GROUPS:
            kinds[group.index] = 1
        elif part in SHIN_GROUPS:
            kinds[group.index] = 0
    weights = np.zeros((len(mesh.data.vertices), 3))
    for vertex in mesh.data.vertices:
        for element in vertex.groups:
            kind = kinds.get(element.group)
            if kind is not None:
                weights[vertex.index, kind] += element.weight
    return weights


def foot_length(mesh):
    co = np.array([vertex.co[:] for vertex in mesh.data.vertices])
    weights = group_weights(mesh, "l")
    foot = co[(weights[:, 1] + weights[:, 2]) > 0.5]
    sole = foot[foot[:, 2] < co[:, 2].min() + 0.03]
    return sole[:, 1].max() - sole[:, 1].min()


def material_index(mesh, prefix):
    return next(i for i, mat in enumerate(mesh.data.materials) if mat and mat.name.startswith(prefix))


def keep_lower_legs(mesh, cut_height):
    """Deletes everything above the knee region and every material but legs and toenails."""
    keep = {material_index(mesh, "Legs"), material_index(mesh, "Toenails")}
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    doomed = [face for face in bm.faces if face.material_index not in keep or max(v.co.z for v in face.verts) > cut_height + 0.08]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    loose = [vertex for vertex in bm.verts if not vertex.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(mesh.data)
    bm.free()


def subdivide(mesh):
    bpy.context.view_layer.objects.active = mesh
    modifier = mesh.modifiers.new("Detail", "SUBSURF")
    modifier.levels = 1
    modifier.render_levels = 1
    modifier.uv_smooth = "PRESERVE_BOUNDARIES"
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def cut_and_cap(mesh, cut_height):
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    geometry = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geometry, plane_co=(0, 0, cut_height), plane_no=(0, 0, 1), clear_outer=True)
    rim = [edge for edge in bm.edges if edge.is_boundary and all(abs(v.co.z - cut_height) < 1e-5 for v in edge.verts)]
    caps = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=rim)["geom"]
    uv = bm.loops.layers.uv.active
    skin = material_index(mesh, "Legs")
    cap_faces = [element for element in caps if isinstance(element, bmesh.types.BMFace)]
    cap_set = set(cap_faces)
    # One UV for the whole cap, taken from the front of the shin's rim, so the cap
    # reads as plain skin instead of the rim's texture smeared across it.
    front = max((v for edge in rim for v in edge.verts), key=lambda vertex: -vertex.co.y)
    skin_uv = next(loop[uv].uv.copy() for loop in front.link_loops if loop.face not in cap_set)
    for face in cap_faces:
        face.material_index = skin
        face.smooth = False
        for loop in face.loops:
            loop[uv].uv = skin_uv
    bm.normal_update()
    bm.to_mesh(mesh.data)
    bm.free()
    log(f"cut at {cut_height * 1000:.0f} mm and capped {len(rim)} rim edges")


def smoothstep(edge0, edge1, value):
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def write_deform_weights(mesh, length):
    """Stores (shin, foot, toes) per vertex, from the vertex's own side of the body."""
    co = np.array([vertex.co[:] for vertex in mesh.data.vertices])
    left = group_weights(mesh, "l")
    right = group_weights(mesh, "r")
    raw = np.where((co[:, 0] >= 0)[:, None], left, right)
    total = raw.sum(axis=1)
    raw[total <= 1e-6] = (1.0, 0.0, 0.0)
    raw /= raw.sum(axis=1, keepdims=True)

    height = co[:, 2] - co[:, 2].min()
    shin = raw[:, 0] * smoothstep(SHIN_HANDOVER[0] * length, SHIN_HANDOVER[1] * length, height)
    foot_and_toes = raw[:, 1] + raw[:, 2]
    toes_share = np.divide(raw[:, 2], foot_and_toes, out=np.zeros_like(foot_and_toes), where=foot_and_toes > 1e-6)
    rest = 1.0 - shin
    weights = np.stack([shin, rest * (1 - toes_share), rest * toes_share], axis=1)

    attribute = mesh.data.attributes.new("_DEFORM_WEIGHTS", "FLOAT_VECTOR", "POINT")
    attribute.data.foreach_set("vector", weights.astype(np.float32).ravel())
    log(f"deform weights: shin {np.mean(weights[:, 0]):.2f}, foot {np.mean(weights[:, 1]):.2f}, toes {np.mean(weights[:, 2]):.2f} (mean)")


def drop_to_floor(mesh):
    lowest = min(vertex.co.z for vertex in mesh.data.vertices)
    mesh.data.transform(Matrix.Translation((0, 0, -lowest)))


def source_images(material):
    found = {}
    for node in material.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image:
            name = node.image.name
            for key, tag in (("color", "_D_"), ("normal", "_NM_"), ("roughness", "_R_")):
                if tag in name:
                    found[key] = node.image
    return found


def cropped_material(mesh, prefix, name, workdir):
    """A glTF PBR material whose textures are cropped to the UVs this material uses."""
    index = material_index(mesh, prefix)
    images = source_images(mesh.data.materials[index])
    uv = mesh.data.uv_layers.active
    loops = [loop for poly in mesh.data.polygons if poly.material_index == index for loop in poly.loop_indices]
    coords = np.array([uv.data[i].uv[:] for i in loops])
    tile = np.floor(coords.min(axis=0))
    local = coords - tile
    lo, hi = local.min(axis=0), local.max(axis=0)

    width, height = images["color"].size
    pad = np.array([TEXTURE_PAD_PX / width, TEXTURE_PAD_PX / height])
    lo, hi = np.clip(lo - pad, 0, 1), np.clip(hi + pad, 0, 1)
    for i in loops:
        u, v = uv.data[i].uv
        uv.data[i].uv = ((u - tile[0] - lo[0]) / (hi[0] - lo[0]), (v - tile[1] - lo[1]) / (hi[1] - lo[1]))

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes["Principled BSDF"]
    for key, image in images.items():
        crop = crop_image(image, lo, hi, f"{name}_{key}", workdir, non_color=key != "color")
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = crop
        if key == "color":
            links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        elif key == "roughness":
            links.new(texture.outputs["Color"], shader.inputs["Roughness"])
        else:
            normal = nodes.new("ShaderNodeNormalMap")
            links.new(texture.outputs["Color"], normal.inputs["Color"])
            links.new(normal.outputs["Normal"], shader.inputs["Normal"])
    shader.inputs["Metallic"].default_value = 0.0
    mesh.data.materials[index] = material
    log(f"{name}: cropped to u {lo[0]:.3f}-{hi[0]:.3f}, v {lo[1]:.3f}-{hi[1]:.3f} of its tile")


def crop_image(image, lo, hi, name, workdir, non_color):
    """Crops the source file on disk with OpenImageIO (bundled with Blender)."""
    import OpenImageIO as oiio

    source = oiio.ImageBuf(bpy.path.abspath(image.filepath))
    spec = source.spec()
    width, height = spec.width, spec.height
    # UV v runs up from the bottom; image rows run down from the top.
    x0, x1 = int(lo[0] * width), int(math.ceil(hi[0] * width))
    y0, y1 = int((1 - hi[1]) * height), int(math.ceil((1 - lo[1]) * height))
    region = oiio.ImageBufAlgo.cut(source, oiio.ROI(x0, x1, y0, y1, 0, 1, 0, 3))
    scale = min(1.0, TEXTURE_MAX / max(x1 - x0, y1 - y0))
    if scale < 1.0:
        size = oiio.ROI(0, max(1, round((x1 - x0) * scale)), 0, max(1, round((y1 - y0) * scale)), 0, 1, 0, 3)
        region = oiio.ImageBufAlgo.resize(region, roi=size)
    path = os.path.join(workdir, f"{name}.jpg")
    region.specmod().attribute("Compression", "jpeg:92")
    if not region.write(path):
        raise RuntimeError(f"Could not write {path}: {region.geterror()}")
    crop = bpy.data.images.load(path)
    crop.name = name
    crop.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return crop


def split_feet(mesh):
    bpy.context.view_layer.objects.active = mesh
    for obj in bpy.data.objects:
        obj.select_set(obj == mesh)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for vertex in mesh.data.vertices:
        vertex.select = vertex.co.x < 0
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    right = next(obj for obj in bpy.data.objects if obj.type == "MESH" and obj != mesh)
    for obj, name in ((mesh, "LeftFootAndShin"), (right, "RightFootAndShin")):
        obj.name = name
        obj.data.name = name
        obj.vertex_groups.clear()
    return mesh, right


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
        export_tangents=True,
        export_skins=False,
        export_morph=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_image_format="JPEG",
        export_jpeg_quality=92,
    )


def main():
    model_id, output = sys.argv[sys.argv.index("--") + 1 :][:2]
    character = FEET[model_id]
    workdir = os.path.join(os.path.dirname(os.path.abspath(output)), f".{model_id}-textures")
    os.makedirs(workdir, exist_ok=True)

    rig, mesh = import_character(character)
    bake_mesh(rig, mesh)
    length = foot_length(mesh)
    cut_height = CUT_RATIO * length + min(vertex.co.z for vertex in mesh.data.vertices)
    log(f"{character}: foot length {length * 1000:.1f} mm")
    keep_lower_legs(mesh, cut_height)
    subdivide(mesh)
    cut_and_cap(mesh, cut_height)
    drop_to_floor(mesh)
    write_deform_weights(mesh, length)
    cropped_material(mesh, "Legs", f"{model_id}_Skin", workdir)
    cropped_material(mesh, "Toenails", f"{model_id}_Toenails", workdir)
    left, right = split_feet(mesh)
    export([left, right], output)
    log(f"wrote {output}: {len(left.data.vertices)} + {len(right.data.vertices)} vertices")


if __name__ == "__main__":
    main()
