import type {
  FigureAlignment,
  FootCatalogEntry,
  FootCatalogId,
} from '../domain/catalog.ts'
import { footLengthMm } from '../domain/measure.ts'

const ALIGNMENT: FigureAlignment = { up: 'y', forward: 'z', soleY: 0 }

// Each GLB holds a left and a right foot, cut and capped at mid-shin, built from a
// Daz Genesis 9 character by tools/assets/build_feet.py (female: Laura, male: Matt).
// Reference lengths are the heel-to-toe extent of the sole vertices in each file.
// scripts/verify-models.mjs re-measures the files and fails on drift.
export const FEET_CATALOG: readonly FootCatalogEntry[] = [
  {
    id: 'foot-female',
    label: 'Female feet',
    subtitle: 'Tan skin · pair to mid-shin',
    sex: 'female',
    skin: 'tan',
    model: { file: 'female-feet-shins.glb', triangles: 40544 },
    swatch: { skinHex: '#c7936f', outfitHex: '#a65d4e' },
    referenceFootLengthMm: footLengthMm(226),
    defaultFootLengthMm: footLengthMm(242),
    alignment: ALIGNMENT,
  },
  {
    id: 'foot-male',
    label: 'Male feet',
    subtitle: 'Pale skin · pair to mid-shin',
    sex: 'male',
    skin: 'pale',
    model: { file: 'male-feet-shins.glb', triangles: 41288 },
    swatch: { skinHex: '#e6c2a6', outfitHex: '#355863' },
    referenceFootLengthMm: footLengthMm(248),
    defaultFootLengthMm: footLengthMm(272),
    alignment: ALIGNMENT,
  },
]

export function footEntry(id: FootCatalogId): FootCatalogEntry {
  const entry = FEET_CATALOG.find((candidate) => candidate.id === id)
  if (!entry) {
    throw new RangeError(`Unknown foot catalog id: ${id}`)
  }

  return entry
}
