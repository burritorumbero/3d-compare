import type {
  FigureAlignment,
  HumanCatalogEntry,
  HumanCatalogId,
} from '../domain/catalog.ts'
import { heightMm } from '../domain/measure.ts'

const ALIGNMENT: FigureAlignment = { up: 'y', forward: 'z', soleY: 0 }

const SKIN_SWATCH = {
  pale: '#e6c2a6',
  tan: '#c7936f',
  dark: '#734a33',
} as const

// Reference statures come from the Body mesh of each GLB (sole to skull top).
// scripts/verify-models.mjs re-measures the files and fails on drift.
export const HUMAN_CATALOG: readonly HumanCatalogEntry[] = [
  {
    id: 'female-tan-dress',
    label: 'Ari',
    subtitle: 'Female · tan skin · dress',
    sex: 'female',
    skin: 'tan',
    model: { file: 'female-tan-dress.glb', triangles: 83072 },
    swatch: { skinHex: SKIN_SWATCH.tan, outfitHex: '#607a65' },
    referenceHeightMm: heightMm(1670),
    footprintWidthMm: 1020,
    alignment: ALIGNMENT,
  },
  {
    id: 'female-dark-jeans-tshirt',
    label: 'Mika',
    subtitle: 'Female · dark skin · jeans & T-shirt',
    sex: 'female',
    skin: 'dark',
    model: { file: 'female-dark-jeans-tshirt.glb', triangles: 75912 },
    swatch: { skinHex: SKIN_SWATCH.dark, outfitHex: '#c28e65' },
    referenceHeightMm: heightMm(1700),
    footprintWidthMm: 1037,
    alignment: ALIGNMENT,
  },
  {
    id: 'female-pale-shorts-croptop',
    label: 'Sloane',
    subtitle: 'Female · pale skin · shorts & crop top',
    sex: 'female',
    skin: 'pale',
    model: { file: 'female-pale-shorts-croptop.glb', triangles: 82193 },
    swatch: { skinHex: SKIN_SWATCH.pale, outfitHex: '#5f7ea3' },
    referenceHeightMm: heightMm(1640),
    footprintWidthMm: 1001,
    alignment: ALIGNMENT,
  },
  {
    id: 'male-tan-shorts-tshirt',
    label: 'Luca',
    subtitle: 'Male · tan skin · shorts & T-shirt',
    sex: 'male',
    skin: 'tan',
    model: { file: 'male-tan-shorts-tshirt.glb', triangles: 72110 },
    swatch: { skinHex: SKIN_SWATCH.tan, outfitHex: '#567b73' },
    referenceHeightMm: heightMm(1790),
    footprintWidthMm: 1166,
    alignment: ALIGNMENT,
  },
  {
    id: 'male-dark-jeans-sleeveless',
    label: 'Miles',
    subtitle: 'Male · dark skin · jeans & sleeveless shirt',
    sex: 'male',
    skin: 'dark',
    model: { file: 'male-dark-jeans-sleeveless.glb', triangles: 77398 },
    swatch: { skinHex: SKIN_SWATCH.dark, outfitHex: '#474747' },
    referenceHeightMm: heightMm(1840),
    footprintWidthMm: 1211,
    alignment: ALIGNMENT,
  },
  {
    id: 'male-pale-trousers-shirt',
    label: 'Owen',
    subtitle: 'Male · pale skin · trousers & shirt',
    sex: 'male',
    skin: 'pale',
    model: { file: 'male-pale-trousers-shirt.glb', triangles: 77904 },
    swatch: { skinHex: SKIN_SWATCH.pale, outfitHex: '#7f97ad' },
    referenceHeightMm: heightMm(1810),
    footprintWidthMm: 1177,
    alignment: ALIGNMENT,
  },
]

export function humanEntry(id: HumanCatalogId): HumanCatalogEntry {
  const entry = HUMAN_CATALOG.find((candidate) => candidate.id === id)
  if (!entry) {
    throw new RangeError(`Unknown human catalog id: ${id}`)
  }

  return entry
}
