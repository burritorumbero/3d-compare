import * as THREE from 'three'
import type { FootCatalogId } from '../../domain/catalog.ts'
import {
  defaultFootSkinTone,
  FOOT_SKIN_PRESETS,
  type FootSkinTone,
} from '../../domain/foot-skin.ts'

/**
 * Recolor only this placement's skin materials. Linear RGB ratios preserve the
 * authored texture's fine color variation, normals and roughness. Toenails and
 * all shared GLB materials/textures stay unchanged. Cleanup restores bindings
 * and releases the small material copies, never the shared texture maps.
 */
export function applyFootSkinTone(
  meshes: readonly THREE.Mesh[],
  catalogId: FootCatalogId,
  skinTone: FootSkinTone,
): () => void {
  const sourceTone = new THREE.Color(FOOT_SKIN_PRESETS[defaultFootSkinTone(catalogId)].color)
  const targetTone = new THREE.Color(FOOT_SKIN_PRESETS[skinTone].color)
  const multiplier = new THREE.Color(
    targetTone.r / sourceTone.r,
    targetTone.g / sourceTone.g,
    targetTone.b / sourceTone.b,
  )
  const copies = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>()
  const bindings = meshes.map((mesh) => ({ mesh, material: mesh.material }))
  function tint(material: THREE.Material): THREE.Material {
    if (
      !('isMeshStandardMaterial' in material) ||
      !material.isMeshStandardMaterial ||
      !material.name.endsWith('_Skin')
    )
      return material
    const skin = material as THREE.MeshStandardMaterial
    let copy = copies.get(skin)
    if (!copy) {
      copy = skin.clone()
      copy.color.multiply(multiplier)
      copies.set(skin, copy)
    }
    return copy
  }
  for (const { mesh, material } of bindings)
    mesh.material = Array.isArray(material) ? material.map(tint) : tint(material)
  return () => {
    for (const { mesh, material } of bindings) mesh.material = material
    for (const material of copies.values()) material.dispose()
  }
}
