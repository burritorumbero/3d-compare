import * as THREE from 'three'
import type { RigFile, RigPose } from '../../kernel/index.ts'

/**
 * One foot, skinned to bones rebuilt from its rig file. The bones follow the rig
 * contract (identity rest rotation, heads on the floor), so setting `bone.scale`
 * to the kernel's pose deforms the mesh exactly as the kernel measured it.
 */
export type RiggedFoot = {
  /** Holds the bones and the skinned meshes; move this to place the foot. */
  root: THREE.Group
  bones: readonly THREE.Bone[]
  meshes: readonly THREE.SkinnedMesh[]
}

/** The meshes that make up a glTF mesh node: the node itself, or one child per material. */
function nodeMeshes(node: THREE.Object3D): THREE.Mesh[] {
  if (node instanceof THREE.Mesh) {
    return [node]
  }

  return node.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
}

/**
 * Adds skinIndex and skinWeight from the `_DEFORM_WEIGHTS` attribute (shin,
 * foot, toes), once per geometry. Geometry is shared by every placement of a model.
 */
function ensureSkinAttributes(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute('skinIndex')) {
    return
  }

  const weights = geometry.getAttribute('_deform_weights')
  if (!weights) {
    throw new Error('Foot geometry has no _DEFORM_WEIGHTS attribute.')
  }

  const indices = new Uint16Array(weights.count * 4)
  const values = new Float32Array(weights.count * 4)
  for (let vertex = 0; vertex < weights.count; vertex += 1) {
    const shin = weights.getX(vertex)
    const foot = weights.getY(vertex)
    const toes = weights.getZ(vertex)
    const total = shin + foot + toes || 1
    indices.set([0, 1, 2, 0], vertex * 4)
    values.set([shin / total, foot / total, toes / total, 0], vertex * 4)
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(values, 4))
}

/** Builds the bones for `rig` and skins the meshes of `node` (left or right foot) to them. */
export function rigFoot(node: THREE.Object3D, rig: RigFile): RiggedFoot {
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

  const meshes = nodeMeshes(node).map((source) => {
    ensureSkinAttributes(source.geometry)
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

/** Applies a kernel pose (bone scales in rig order) to a rigged foot. */
export function poseFoot(foot: RiggedFoot, pose: RigPose): void {
  foot.bones.forEach((bone, index) => {
    const [x, y, z] = pose.boneScales[index]
    bone.scale.set(x, y, z)
  })
}
