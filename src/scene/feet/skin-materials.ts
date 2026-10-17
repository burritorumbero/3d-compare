import * as THREE from 'three'
import { footSkinTextureFiles } from '../../catalog/foot-skins.ts'
import type { FootCatalogId } from '../../domain/catalog.ts'
import {
  defaultFootSkinTone,
  FOOT_SKIN_PRESETS,
  type FootSkinTone,
} from '../../domain/foot-skin.ts'

/**
 * Own the material per placement; texture sets stay cached and shared. Lighter
 * female presets use independent authored maps, not a tint of the tan skin.
 * Other presets keep their original treatment. Cleanup releases only copies.
 */
export type FootSkinMaps = {
  map: THREE.Texture
  normalMap: THREE.Texture
  roughnessMap: THREE.Texture
}

/** External maps follow the GLB's UV orientation and color-space conventions. */
export function configureFootSkinMaps(textures: readonly THREE.Texture[]): FootSkinMaps | null {
  if (textures.length === 0) return null
  if (textures.length !== 3)
    throw new Error('A foot complexion requires color, normal and roughness maps.')
  const [map, normalMap, roughnessMap] = textures
  for (const texture of textures) {
    texture.flipY = false
    texture.colorSpace = texture === map ? THREE.SRGBColorSpace : THREE.NoColorSpace
  }
  return { map, normalMap, roughnessMap }
}

export function applyFootSkinTone(
  meshes: readonly THREE.Mesh[],
  catalogId: FootCatalogId,
  skinTone: FootSkinTone,
  maps: FootSkinMaps | null = null,
): () => void {
  if (footSkinTextureFiles(catalogId, skinTone).length > 0 && !maps) {
    throw new Error(`Missing complexion textures for ${catalogId}/${skinTone}.`)
  }
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
      if (maps) {
        copy.map = maps.map
        copy.normalMap = maps.normalMap
        copy.roughnessMap = maps.roughnessMap
        copy.color.setRGB(1, 1, 1)
      } else copy.color.multiply(multiplier)
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
