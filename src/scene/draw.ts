import { footEntry } from '../catalog/feet.ts'
import { humanEntry } from '../catalog/humans.ts'
import { humanDisplayName } from '../catalog/names.ts'
import type { FootCatalogId, HumanCatalogId, ModelAsset } from '../domain/catalog.ts'
import type { PlacedFoot } from '../domain/feet-world.ts'
import type { PlacedHuman } from '../domain/height-world.ts'
import type { PlacementId } from '../domain/ids.ts'
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
  scale: number
  position: readonly [number, 0, number]
  yaw: number
  selected: boolean
  label: string
}

export function toHumanDraw(
  placement: PlacedHuman,
  selectedId: PlacementId | null,
  unit: LengthUnit,
): HumanDraw {
  const entry = humanEntry(placement.catalogId)
  return {
    id: placement.id,
    catalogId: entry.id,
    model: entry.model,
    referenceHeightM: entry.referenceHeightMm / 1000,
    scale: heightScale(entry.referenceHeightMm, placement.heightMm),
    position: [placement.pose.x, 0, placement.pose.z],
    yaw: placement.pose.yaw,
    selected: placement.id === selectedId,
    label: `${humanDisplayName(placement)} · ${formatHeight(placement.heightMm, unit)}`,
  }
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
    scale: footScale(entry.referenceFootLengthMm, placement.footLengthMm),
    position: [placement.pose.x, 0, placement.pose.z],
    yaw: placement.pose.yaw,
    selected: placement.id === selectedId,
    label: `${entry.label} · ${formatShoe(placement.footLengthMm, system, entry.sex)}`,
  }
}
