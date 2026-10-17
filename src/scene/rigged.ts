import * as THREE from 'three'
import type { RigFile, RigPose } from '../kernel/index.ts'

/**
 * Meshes skinned to bones rebuilt from a rig file. The bones follow the rig
 * contract (identity rest rotation, heads from the rig), so setting `bone.matrix`
 * to the kernel's pose deforms the meshes exactly as the kernel measured them.
 */
export type Rigged = {
  /** Holds the bones and the skinned meshes; move this to place the model. */
  root: THREE.Group
  bones: readonly THREE.Bone[]
  meshes: readonly THREE.SkinnedMesh[]
}

/** Every mesh under a node, the node included. */
function meshesUnder(node: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  node.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      meshes.push(child)
    }
  })
  return meshes
}

/**
 * Adds skinIndex and skinWeight once per geometry (geometry is shared by every
 * placement of a model), from either authoring layout:
 * - `_skin_index` / `_skin_weight`: four bone influences per vertex (people);
 * - `_deform_weights`: shin, foot, toes weights for bones 0, 1, 2 (feet).
 */
function ensureSkinAttributes(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute('skinIndex')) {
    return
  }

  const index = geometry.getAttribute('_skin_index')
  const weight = geometry.getAttribute('_skin_weight')
  const deform = geometry.getAttribute('_deform_weights')
  const count = (index ?? deform)?.count
  if (count === undefined || (index && !weight)) {
    throw new Error('Rigged geometry needs _SKIN_INDEX and _SKIN_WEIGHT, or _DEFORM_WEIGHTS.')
  }

  const indices = new Uint16Array(count * 4)
  const values = new Float32Array(count * 4)
  for (let vertex = 0; vertex < count; vertex += 1) {
    const bones = index
      ? [index.getX(vertex), index.getY(vertex), index.getZ(vertex), index.getW(vertex)]
      : [0, 1, 2, 0]
    const raw = index
      ? [weight.getX(vertex), weight.getY(vertex), weight.getZ(vertex), weight.getW(vertex)]
      : [deform.getX(vertex), deform.getY(vertex), deform.getZ(vertex), 0]
    const total = raw[0] + raw[1] + raw[2] + raw[3] || 1
    indices.set(bones.map(Math.round), vertex * 4)
    values.set(raw.map((value) => value / total), vertex * 4)
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(values, 4))
}

/**
 * Hair, lash, and brow cards blend badly when sorted per mesh. Alpha to coverage
 * turns their soft alpha into MSAA sample coverage instead: they write depth,
 * need no sorting, and keep their density (a hard 0.5 cutoff erases soft hair).
 * Materials are shared, so this runs once per material.
 */
function cutoutTransparency(material: THREE.Material | THREE.Material[]): void {
  for (const each of Array.isArray(material) ? material : [material]) {
    if (each.transparent) {
      each.transparent = false
      each.alphaToCoverage = true
      each.alphaTest = 0.1
      each.depthWrite = true
      each.needsUpdate = true
    }
  }
}

const normalMaterials = new WeakSet<THREE.Material>()

/** Skin normals need the inverse transpose when length and girth differ. */
function affineSkinNormals(material: THREE.Material | THREE.Material[]): void {
  for (const each of Array.isArray(material) ? material : [material]) {
    if (normalMaterials.has(each)) continue
    normalMaterials.add(each)
    const previous = each.onBeforeCompile
    each.onBeforeCompile = (shader, renderer) => {
      previous.call(each, shader, renderer)
      shader.vertexShader = shader.vertexShader.replace('#include <skinnormal_vertex>', THREE.ShaderChunk.skinnormal_vertex.replace(
        'objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;',
        `mat3 linearSkin = mat3(skinMatrix);
        mat3 normalSkin = mat3(cross(linearSkin[1], linearSkin[2]), cross(linearSkin[2], linearSkin[0]), cross(linearSkin[0], linearSkin[1]));
        objectNormal = normalSkin * objectNormal / dot(linearSkin[0], normalSkin[0]);`,
      ))
    }
    each.customProgramCacheKey = () => 'affine-skin-normals-v1'
    each.needsUpdate = true
  }
}

/** Builds the bones for `rig` and skins every mesh under `node` to them. */
export function rigNode(node: THREE.Object3D, rig: RigFile): Rigged {
  const bones = rig.bones.map((spec) => {
    const bone = new THREE.Bone()
    bone.name = `${rig.mesh}:${spec.name}`
    return bone
  })
  rig.bones.forEach((spec, index) => {
    const parentIndex = spec.parent === null ? -1 : rig.bones.findIndex((candidate) => candidate.name === spec.parent)
    const parentHead = parentIndex === -1 ? [0, 0, 0] : rig.bones[parentIndex].head
    bones[index].position.set(spec.head[0] - parentHead[0], spec.head[1] - parentHead[1], spec.head[2] - parentHead[2])
    if (parentIndex !== -1) {
      bones[parentIndex].add(bones[index])
    }
  })

  const root = new THREE.Group()
  root.name = rig.mesh
  root.add(bones[0])
  // Bind while the root sits at the origin, so rest world matrices are the rig's own space.
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(bones)

  const meshes = meshesUnder(node).map((source) => {
    ensureSkinAttributes(source.geometry)
    cutoutTransparency(source.material)
    if (rig.bones.some((bone) => bone.basis)) affineSkinNormals(source.material)
    const skinned = new THREE.SkinnedMesh(source.geometry, source.material)
    skinned.name = source.name
    // Bounds change with the pose; the scene is small enough to skip culling.
    skinned.frustumCulled = false
    root.add(skinned)
    skinned.updateMatrixWorld(true)
    skinned.bind(skeleton, new THREE.Matrix4())
    return skinned
  })

  return { root, bones, meshes }
}

/** Keep the full matrix: decomposing oriented parent compensation loses shear. */
export function applyPose(rigged: Rigged, pose: RigPose): void {
  rigged.bones.forEach((bone, index) => {
    bone.matrixAutoUpdate = false
    bone.matrix.fromArray(pose.boneMatrices[index])
    bone.matrixWorldNeedsUpdate = true
  })
}
