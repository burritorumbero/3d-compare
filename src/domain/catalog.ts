import type { FootLengthMm, HeightMm } from './measure.ts'

export type Sex = 'female' | 'male'
export type SkinTone = 'pale' | 'tan' | 'dark'

export const HUMAN_CATALOG_IDS = [
  'female-tan-dress',
  'female-dark-jeans-tshirt',
  'female-pale-shorts-croptop',
  'male-tan-shorts-tshirt',
  'male-dark-jeans-sleeveless',
  'male-pale-trousers-shirt',
] as const
export type HumanCatalogId = (typeof HUMAN_CATALOG_IDS)[number]

export const FOOT_CATALOG_IDS = ['foot-female', 'foot-male'] as const
export type FootCatalogId = (typeof FOOT_CATALOG_IDS)[number]

/** Shape defaults and shoe charts depend on sex, so the domain knows it for each foot model. */
export const FOOT_CATALOG_SEX: Record<FootCatalogId, Sex> = {
  'foot-female': 'female',
  'foot-male': 'male',
}

/**
 * A glTF binary shipped in public/models. Every asset is a static mesh in
 * meters, Y up, facing +Z, with its soles resting on y = 0.
 */
export type ModelAsset = {
  file: string
  triangles: number
}

/** Flat colors that stand in for the textured model in 2D chrome such as cards and lineup rows. */
export type Swatch = {
  skinHex: string
  outfitHex: string
}

export type FigureAlignment = {
  up: 'y'
  forward: 'z'
  soleY: 0
}

export type HumanCatalogEntry = {
  id: HumanCatalogId
  label: string
  subtitle: string
  sex: Sex
  skin: SkinTone
  model: ModelAsset
  swatch: Swatch
  /** Stature of the authored mesh from sole to skull top, hair excluded. */
  referenceHeightMm: HeightMm
  /** Fingertip-to-fingertip width of the authored A-pose. */
  footprintWidthMm: number
  alignment: FigureAlignment
}

export type FootCatalogEntry = {
  id: FootCatalogId
  label: string
  subtitle: string
  sex: Sex
  skin: SkinTone
  model: ModelAsset
  swatch: Swatch
  /** Heel-to-toe length of each authored foot. */
  referenceFootLengthMm: FootLengthMm
  /** Foot length a new placement starts at: a common adult size for the sex. */
  defaultFootLengthMm: FootLengthMm
  alignment: FigureAlignment
}
