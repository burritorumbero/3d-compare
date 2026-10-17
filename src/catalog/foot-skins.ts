import type { FootCatalogId } from '../domain/catalog.ts'
import type { FootSkinTone } from '../domain/foot-skin.ts'

/** Independent authored complexion maps on the same Genesis 9 UV layout. */
export function footSkinTextureFiles(catalogId: FootCatalogId, tone: FootSkinTone): string[] {
  if (catalogId !== 'foot-female' || (tone !== 'white' && tone !== 'asian')) return []
  return ['color', 'normal', 'roughness'].map((kind) => `female-${tone}-${kind}.webp`)
}
