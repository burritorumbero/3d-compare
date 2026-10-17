import { footEntry } from '../catalog/feet.ts'
import { humanEntry } from '../catalog/humans.ts'
import { humanDisplayName } from '../catalog/names.ts'
import type { FootCatalogId, HumanCatalogId, ModelAsset, Sex } from '../domain/catalog.ts'
import type { FootSkinTone } from '../domain/foot-skin.ts'
import type { PlacedFoot } from '../domain/feet-world.ts'
import type { PlacedHuman } from '../domain/height-world.ts'
import type { PlacementId } from '../domain/ids.ts'
import type { FootShape } from '../domain/foot-shape.ts'
import { averageLandmarks } from '../domain/stature.ts'
import { HUMAN_GAP_M } from '../domain/layout.ts'
import {
  footScale,
  formatHeight,
  heightScale,
  type HeightMm,
  type LengthUnit,
} from '../domain/measure.ts'
import { formatShoe, type ShoeSystem } from '../domain/shoe-charts.ts'

export type HumanDraw = {
  id: PlacementId
  catalogId: HumanCatalogId
  model: ModelAsset
  sex: Sex
  /** The height the kernel solves the rigged person to. */
  heightMm: HeightMm
  referenceHeightM: number
  /** Height over the authored stature: sizes the stand-in while the person loads. */
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
  /** The dimensions the kernel solves the rigged pair to. */
  shape: FootShape
  skinTone: FootSkinTone
  /** Foot length over the authored length: sizes the stand-in while the pair loads. */
  lengthScale: number
  position: readonly [number, 0, number]
  yaw: number
  selected: boolean
  label: string
}

/**
 * Arm-span footprint of a person at their set height, in meters. The A-pose span
 * is mostly arms, and arms grow a little faster than stature (ANSUR II), so the
 * footprint follows the arm-length ratio rather than the height ratio.
 */
function humanFootprintM(placement: PlacedHuman): number {
  const entry = humanEntry(placement.catalogId)
  const growth =
    averageLandmarks(entry.sex, placement.heightMm).armLength / averageLandmarks(entry.sex, entry.referenceHeightMm).armLength
  return (entry.footprintWidthMm / 1000) * growth
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
    sex: entry.sex,
    heightMm: placement.heightMm,
    referenceHeightM: entry.referenceHeightMm / 1000,
    scale: heightScale(entry.referenceHeightMm, placement.heightMm),
    position: [lineupX, 0, placement.pose.z],
    yaw: placement.pose.yaw,
    selected: placement.id === selectedId,
    label: `${humanDisplayName(placement)} · ${formatHeight(placement.heightMm, unit)}`,
  }
}

export function toFootDraw(
  placement: PlacedFoot,
  selectedId: PlacementId | null,
  system: ShoeSystem,
  lineup: Pick<PlacedFoot['pose'], 'x' | 'z'> = placement.pose,
): FootDraw {
  const entry = footEntry(placement.catalogId)
  return {
    id: placement.id,
    catalogId: entry.id,
    model: entry.model,
    referenceLengthM: entry.referenceFootLengthMm / 1000,
    shape: placement.shape,
    skinTone: placement.skinTone,
    lengthScale: footScale(entry.referenceFootLengthMm, placement.shape.lengthMm),
    position: [lineup.x, 0, lineup.z],
    yaw: placement.pose.yaw,
    selected: placement.id === selectedId,
    label: `${entry.label} · ${formatShoe(placement.shape.lengthMm, system, entry.sex)}`,
  }
}
