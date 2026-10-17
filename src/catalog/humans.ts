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

// Each person is a Daz Genesis 9 character built by tools/assets/build_people.py.
// Reference statures come from the Body mesh of each GLB (sole to skull top, hair
// excluded); scripts/verify-models.mjs re-measures the files and fails on drift.
export const HUMAN_CATALOG: readonly HumanCatalogEntry[] = [
  {
    id: 'female-tan-dress',
    label: 'Ari',
    subtitle: 'Female · tan skin · dress',
    sex: 'female',
    skin: 'tan',
    model: { file: 'female-tan-dress.glb', triangles: 150626 },
    swatch: { skinHex: SKIN_SWATCH.tan, outfitHex: '#5d5d60' },
    referenceHeightMm: heightMm(1705),
    footprintWidthMm: 1198,
    alignment: ALIGNMENT,
  },
  {
    id: 'female-dark-jeans-tshirt',
    label: 'Mika',
    subtitle: 'Female · dark skin · jeans & T-shirt',
    sex: 'female',
    skin: 'dark',
    model: { file: 'female-dark-jeans-tshirt.glb', triangles: 188408 },
    swatch: { skinHex: SKIN_SWATCH.dark, outfitHex: '#5b7fb0' },
    referenceHeightMm: heightMm(1696),
    footprintWidthMm: 1265,
    alignment: ALIGNMENT,
  },
  {
    id: 'female-pale-shorts-croptop',
    label: 'Sloane',
    subtitle: 'Female · pale skin · shorts & crop top',
    sex: 'female',
    skin: 'pale',
    model: { file: 'female-pale-shorts-croptop.glb', triangles: 162877 },
    swatch: { skinHex: SKIN_SWATCH.pale, outfitHex: '#4f6f96' },
    referenceHeightMm: heightMm(1755),
    footprintWidthMm: 1277,
    alignment: ALIGNMENT,
  },
  {
    id: 'male-tan-shorts-tshirt',
    label: 'Luca',
    subtitle: 'Male · tan skin · shorts & T-shirt',
    sex: 'male',
    skin: 'tan',
    model: { file: 'male-tan-shorts-tshirt.glb', triangles: 161201 },
    swatch: { skinHex: SKIN_SWATCH.tan, outfitHex: '#2b2b2d' },
    referenceHeightMm: heightMm(1704),
    footprintWidthMm: 1320,
    alignment: ALIGNMENT,
  },
  {
    id: 'male-dark-jeans-sleeveless',
    label: 'Miles',
    subtitle: 'Male · dark skin · jeans & tank top',
    sex: 'male',
    skin: 'dark',
    model: { file: 'male-dark-jeans-sleeveless.glb', triangles: 175529 },
    swatch: { skinHex: SKIN_SWATCH.dark, outfitHex: '#3d5a80' },
    referenceHeightMm: heightMm(1724),
    footprintWidthMm: 1285,
    alignment: ALIGNMENT,
  },
  {
    id: 'male-pale-trousers-shirt',
    label: 'Owen',
    subtitle: 'Male · pale skin · trousers & sweater',
    sex: 'male',
    skin: 'pale',
    model: { file: 'male-pale-trousers-shirt.glb', triangles: 221648 },
    swatch: { skinHex: SKIN_SWATCH.pale, outfitHex: '#8d8f93' },
    referenceHeightMm: heightMm(1710),
    footprintWidthMm: 1335,
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
