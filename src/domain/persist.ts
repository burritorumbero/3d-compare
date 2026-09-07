import {
  FOOT_CATALOG_IDS,
  HUMAN_CATALOG_IDS,
  type FootCatalogId,
  type HumanCatalogId,
} from './catalog.ts'
import type { CompareDocument, Mode } from './document.ts'
import { FEET_CAP, type FeetWorld, type PlacedFoot } from './feet-world.ts'
import {
  HEIGHT_CAP,
  sanitizeHumanName,
  type HeightWorld,
  type PlacedHuman,
} from './height-world.ts'
import { placementId } from './ids.ts'
import type { FloorPose, SurfacePose } from './layout.ts'
import {
  FOOT_LENGTH_MM_MAX,
  FOOT_LENGTH_MM_MIN,
  HEIGHT_MM_MAX,
  HEIGHT_MM_MIN,
  footLengthMm,
  heightMm,
  type LengthUnit,
  type ParseResult,
} from './measure.ts'
import type { FeetNavMode } from './navigation.ts'
import type { ShoeSystem } from './shoe-charts.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function humanCatalogId(value: unknown): HumanCatalogId | null {
  return HUMAN_CATALOG_IDS.find((id) => id === value) ?? null
}

function footCatalogId(value: unknown): FootCatalogId | null {
  return FOOT_CATALOG_IDS.find((id) => id === value) ?? null
}

function floorPose(value: unknown): FloorPose | null {
  if (
    !isRecord(value) ||
    value.space !== 'floor' ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z) ||
    !isFiniteNumber(value.yaw) ||
    Math.abs(value.x) > 20 ||
    Math.abs(value.z) > 20
  ) {
    return null
  }

  return { space: 'floor', x: value.x, z: value.z, yaw: value.yaw }
}

function surfacePose(value: unknown): SurfacePose | null {
  if (
    !isRecord(value) ||
    value.space !== 'table' ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z) ||
    !isFiniteNumber(value.yaw) ||
    Math.abs(value.x) > 2 ||
    Math.abs(value.z) > 2
  ) {
    return null
  }

  return { space: 'table', x: value.x, z: value.z, yaw: value.yaw }
}

function humanPlacement(value: unknown): PlacedHuman | null {
  if (
    !isRecord(value) ||
    value.kind !== 'human' ||
    typeof value.id !== 'string' ||
    !isFiniteNumber(value.heightMm) ||
    value.heightMm < HEIGHT_MM_MIN ||
    value.heightMm > HEIGHT_MM_MAX
  ) {
    return null
  }

  const catalogId = humanCatalogId(value.catalogId)
  const pose = floorPose(value.pose)
  if (!catalogId || !pose) {
    return null
  }

  const name = typeof value.name === 'string' ? sanitizeHumanName(value.name) : ''
  return {
    kind: 'human',
    id: placementId(value.id),
    catalogId,
    heightMm: heightMm(value.heightMm),
    pose,
    ...(name ? { name } : {}),
  }
}

function footPlacement(value: unknown): PlacedFoot | null {
  if (
    !isRecord(value) ||
    value.kind !== 'foot' ||
    typeof value.id !== 'string' ||
    !isFiniteNumber(value.footLengthMm) ||
    value.footLengthMm < FOOT_LENGTH_MM_MIN ||
    value.footLengthMm > FOOT_LENGTH_MM_MAX
  ) {
    return null
  }

  const catalogId = footCatalogId(value.catalogId)
  const pose = surfacePose(value.pose)
  if (!catalogId || !pose) {
    return null
  }

  return {
    kind: 'foot',
    id: placementId(value.id),
    catalogId,
    footLengthMm: footLengthMm(value.footLengthMm),
    pose,
  }
}

function heightWorld(value: unknown): HeightWorld | null {
  if (
    !isRecord(value) ||
    value.kind !== 'height' ||
    !Array.isArray(value.placements) ||
    value.placements.length > HEIGHT_CAP
  ) {
    return null
  }

  const placements = value.placements.map(humanPlacement)
  if (placements.some((placement) => placement === null)) {
    return null
  }

  const validPlacements = placements.filter(
    (placement): placement is PlacedHuman => placement !== null,
  )
  const selected =
    typeof value.selected === 'string' &&
    validPlacements.some((placement) => placement.id === value.selected)
      ? placementId(value.selected)
      : null
  return {
    kind: 'height',
    placements: validPlacements,
    selected,
    cameraIntent: { kind: 'none' },
    savedNav: null,
  }
}

function feetWorld(value: unknown): FeetWorld | null {
  if (
    !isRecord(value) ||
    value.kind !== 'feet' ||
    !Array.isArray(value.placements) ||
    value.placements.length > FEET_CAP
  ) {
    return null
  }

  const placements = value.placements.map(footPlacement)
  if (placements.some((placement) => placement === null)) {
    return null
  }

  const validPlacements = placements.filter(
    (placement): placement is PlacedFoot => placement !== null,
  )
  const selected =
    typeof value.selected === 'string' &&
    validPlacements.some((placement) => placement.id === value.selected)
      ? placementId(value.selected)
      : null
  const navMode: FeetNavMode = value.navMode === 'inspect' ? 'inspect' : 'orbit'

  return {
    kind: 'feet',
    placements: validPlacements,
    selected,
    navMode,
    cameraIntent: { kind: 'none' },
    savedNav: null,
  }
}

export function parseDocumentJson(raw: string): ParseResult<CompareDocument> {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== 1) {
      return { ok: false, message: 'Saved comparison uses an unsupported version.' }
    }

    const height = heightWorld(value.height)
    const feet = feetWorld(value.feet)
    if (!height || !feet) {
      return { ok: false, message: 'Saved comparison has invalid placements.' }
    }

    const mode: Mode = value.mode === 'feet' ? 'feet' : 'height'
    const heightUnit: LengthUnit = value.heightUnit === 'cm' ? 'cm' : 'ftin'
    const shoeSystem: ShoeSystem = value.shoeSystem === 'EU' ? 'EU' : 'US'
    return {
      ok: true,
      value: { version: 1, mode, heightUnit, shoeSystem, height, feet },
    }
  } catch {
    return { ok: false, message: 'Saved comparison is not valid JSON.' }
  }
}

export function serializeDocument(document: CompareDocument): string {
  return JSON.stringify(document)
}
