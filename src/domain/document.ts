import { emptyFeetWorld, type FeetWorld } from './feet-world.ts'
import { emptyHeightWorld, type HeightWorld } from './height-world.ts'
import type { LengthUnit } from './measure.ts'
import type { ShoeSystem } from './shoe-charts.ts'

export type Mode = 'height' | 'feet'

export type CompareDocument = {
  version: 2
  mode: Mode
  heightUnit: LengthUnit
  shoeSystem: ShoeSystem
  height: HeightWorld
  feet: FeetWorld
}

export function emptyDocument(): CompareDocument {
  return {
    version: 2,
    mode: 'height',
    heightUnit: 'ftin',
    shoeSystem: 'US',
    height: emptyHeightWorld(),
    feet: emptyFeetWorld(),
  }
}
