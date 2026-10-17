import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { footSkinTextureFiles } from '../../catalog/foot-skins.ts'
import type { FootCatalogId } from '../../domain/catalog.ts'
import type { FootSkinTone } from '../../domain/foot-skin.ts'
import { configureFootSkinMaps } from './skin-materials.ts'

/** Load only the chosen complexion; identical pairs share the cached maps. */
export function useFootSkinMaps(catalogId: FootCatalogId, tone: FootSkinTone) {
  const files = footSkinTextureFiles(catalogId, tone)
  const textures = useLoader(
    THREE.TextureLoader,
    files.map((file) => `${import.meta.env.BASE_URL}skins/${file}`),
  )
  return useMemo(() => configureFootSkinMaps(textures), [textures])
}
