import { footEntry } from '../catalog/feet.ts'
import { humanEntry } from '../catalog/humans.ts'
import { humanDisplayName } from '../catalog/names.ts'
import type { FootCatalogId, HumanCatalogId, ModelAsset, Sex } from '../domain/catalog.ts'
import type { PlacedFoot } from '../domain/feet-world.ts'
import type { PlacedHuman } from '../domain/height-world.ts'
import type { PlacementId } from '../domain/ids.ts'
import { typicalFootDimension, type FootShape } from '../domain/foot-shape.ts'
import { HUMAN_GAP_M } from '../domain/layout.ts'
import {
  footScale,
  formatHeight,
  heightScale,
  type LengthUnit,
} from '../domain/measure.ts'
import { formatShoe, type ShoeSystem } from '../domain/shoe-charts.ts'

export type HumanDraw = {
  id: PlacementId
  catalogId: HumanCatalogId
  model: ModelAsset
  referenceHeightM: number
  scale: number
  position: readonly [number, 0, number]
  yaw: number
  selected: boolean
  label: string
}

export type FootDraw = {
  id: PlacementId
  catalogId: FootCatalogId
  model: ModelAsset
  referenceLengthM: number
  /** Per-axis scale (x width, y thickness, z length) applied to the authored pair. */
  scale: readonly [number, number, number]
  position: readonly [number, 0, number]
  yaw: number
  selected: boolean
  label: string
}

/** Arm-span footprint of a person at their set height, in meters. */
function humanFootprintM(placement: PlacedHuman): number {
  const entry = humanEntry(placement.catalogId)
  return (entry.footprintWidthMm / 1000) * heightScale(entry.referenceHeightMm, placement.heightMm)
}

/**
 * Where each person stands along the lineup. The first stands at the center and
 * the rest alternate left and right, each kept clear of its neighbor by its own
 * scaled footprint, so a 10-foot person never overlaps the next one.
 */
export function humanLineupX(placements: readonly PlacedHuman[]): ReadonlyMap<PlacementId, number> {
  const positions = new Map<PlacementId, number>()
  let left = 0
  let right = 0
  placements.forEach((placement, index) => {
    const half = humanFootprintM(placement) / 2
    if (index === 0) {
      positions.set(placement.id, 0)
      left = -half
      right = half
    } else if (index % 2 === 1) {
      const x = left - HUMAN_GAP_M - half
      positions.set(placement.id, x)
      left = x - half
    } else {
      const x = right + HUMAN_GAP_M + half
      positions.set(placement.id, x)
      right = x + half
    }
  })

  return positions
}

export function toHumanDraw(
  placement: PlacedHuman,
  selectedId: PlacementId | null,
  unit: LengthUnit,
  lineupX: number,
): HumanDraw {
  const entry = humanEntry(placement.catalogId)
  return {
    id: placement.id,
    catalogId: entry.id,
    model: entry.model,
    referenceHeightM: entry.referenceHeightMm / 1000,
    scale: heightScale(entry.referenceHeightMm, placement.heightMm),
    position: [lineupX, 0, placement.pose.z],
    yaw: placement.pose.yaw,
    selected: placement.id === selectedId,
    label: `${humanDisplayName(placement)} · ${formatHeight(placement.heightMm, unit)}`,
  }
}

/**
 * Interim deformation until the rigged feet ship: the authored pair stands for
 * an average foot, so a typical shape scales uniformly by length, and width and
 * thickness stretch their axis by how far they sit from typical. Toe length only
 * shows through foot length here; the rig gives toes their own bones.
 */
function footAxisScale(
  sex: Sex,
  referenceLengthMm: FootShape['lengthMm'],
  shape: FootShape,
): readonly [number, number, number] {
  const length = footScale(referenceLengthMm, shape.lengthMm)
  const relative = (value: number, dimension: 'ballWidth' | 'instepHeight') =>
    value / typicalFootDimension(dimension, sex, shape.lengthMm)
  return [
    length * relative(shape.ballWidthMm, 'ballWidth'),
    length * relative(shape.instepHeightMm, 'instepHeight'),
    length,
  ]
}

export function toFootDraw(
  placement: PlacedFoot,
  selectedId: PlacementId | null,
  system: ShoeSystem,
): FootDraw {
  const entry = footEntry(placement.catalogId)
  return {
    id: placement.id,
    catalogId: entry.id,
    model: entry.model,
    referenceLengthM: entry.referenceFootLengthMm / 1000,
    scale: footAxisScale(entry.sex, entry.referenceFootLengthMm, placement.shape),
    position: [placement.pose.x, 0, placement.pose.z],
    yaw: placement.pose.yaw,
    selected: placement.id === selectedId,
    label: `${entry.label} · ${formatShoe(placement.shape.lengthMm, system, entry.sex)}`,
  }
}
