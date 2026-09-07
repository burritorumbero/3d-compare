import type { HumanCatalogId } from './catalog.ts'
import type { PlacementId } from './ids.ts'
import { nextHumanPose, type FloorPose, type PlanarDelta } from './layout.ts'
import type { HeightMm } from './measure.ts'
import type { HeightCameraIntent, HeightNavSnapshot } from './navigation.ts'
import type { PlaceResult, UpdateResult } from './results.ts'

export const HEIGHT_CAP = 10
export const HUMAN_NAME_MAX_LENGTH = 40

export type PlacedHuman = {
  kind: 'human'
  id: PlacementId
  catalogId: HumanCatalogId
  heightMm: HeightMm
  pose: FloorPose
  /** A custom label. When absent, the catalog entry's label is shown. */
  name?: string
}

export type HeightWorld = {
  kind: 'height'
  placements: readonly PlacedHuman[]
  selected: PlacementId | null
  cameraIntent: HeightCameraIntent
  savedNav: HeightNavSnapshot | null
}

export function emptyHeightWorld(): HeightWorld {
  return {
    kind: 'height',
    placements: [],
    selected: null,
    cameraIntent: { kind: 'none' },
    savedNav: null,
  }
}

/** Collapses whitespace and caps the length. Returns '' when nothing readable remains. */
export function sanitizeHumanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, HUMAN_NAME_MAX_LENGTH)
}

export function selectedHuman(world: HeightWorld): PlacedHuman | null {
  return world.placements.find((placement) => placement.id === world.selected) ?? null
}

export function placeHuman(
  world: HeightWorld,
  id: PlacementId,
  catalogId: HumanCatalogId,
  initialHeight: HeightMm,
  name?: string,
): { world: HeightWorld; result: PlaceResult } {
  if (world.placements.length >= HEIGHT_CAP) {
    return { world, result: { ok: false, reason: 'cap-reached' } }
  }

  const cleanName = name === undefined ? '' : sanitizeHumanName(name)
  const placement: PlacedHuman = {
    kind: 'human',
    id,
    catalogId,
    heightMm: initialHeight,
    pose: nextHumanPose(world.placements.length),
    ...(cleanName ? { name: cleanName } : {}),
  }

  return {
    world: {
      ...world,
      placements: [...world.placements, placement],
      selected: id,
      cameraIntent: { kind: 'frame-selection' },
    },
    result: { ok: true, id },
  }
}

export function updateHumanHeight(
  world: HeightWorld,
  id: PlacementId,
  value: HeightMm,
): { world: HeightWorld; result: UpdateResult } {
  if (!world.placements.some((placement) => placement.id === id)) {
    return { world, result: { ok: false, reason: 'not-found' } }
  }

  return {
    world: {
      ...world,
      placements: world.placements.map((placement) =>
        placement.id === id ? { ...placement, heightMm: value } : placement,
      ),
    },
    result: { ok: true },
  }
}

/** A blank name removes the custom label so the catalog label shows again. */
export function renameHuman(
  world: HeightWorld,
  id: PlacementId,
  raw: string,
): { world: HeightWorld; result: UpdateResult } {
  const placement = world.placements.find((candidate) => candidate.id === id)
  if (!placement) {
    return { world, result: { ok: false, reason: 'not-found' } }
  }

  const name = sanitizeHumanName(raw)
  if ((placement.name ?? '') === name) {
    return { world, result: { ok: true } }
  }

  return {
    world: {
      ...world,
      placements: world.placements.map((candidate) => {
        if (candidate.id !== id) {
          return candidate
        }

        const { name: _previous, ...rest } = candidate
        return name ? { ...rest, name } : rest
      }),
    },
    result: { ok: true },
  }
}

export function selectHuman(world: HeightWorld, id: PlacementId | null): HeightWorld {
  const selected =
    id === null || world.placements.some((placement) => placement.id === id) ? id : null
  return selected === world.selected ? world : { ...world, selected }
}

export function removeHuman(world: HeightWorld, id: PlacementId): HeightWorld {
  if (!world.placements.some((placement) => placement.id === id)) {
    return world
  }

  return {
    ...world,
    placements: world.placements.filter((placement) => placement.id !== id),
    selected: world.selected === id ? null : world.selected,
  }
}

export function repositionHuman(
  world: HeightWorld,
  id: PlacementId,
  delta: PlanarDelta,
): { world: HeightWorld; result: UpdateResult } {
  const placement = world.placements.find((candidate) => candidate.id === id)
  if (!placement) {
    return { world, result: { ok: false, reason: 'not-found' } }
  }

  return {
    world: {
      ...world,
      placements: world.placements.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              pose: {
                ...candidate.pose,
                x: candidate.pose.x + delta.x,
                z: candidate.pose.z + delta.z,
                yaw: candidate.pose.yaw + (delta.yaw ?? 0),
              },
            }
          : candidate,
      ),
    },
    result: { ok: true },
  }
}

export function setHeightCameraIntent(
  world: HeightWorld,
  cameraIntent: HeightCameraIntent,
): HeightWorld {
  return { ...world, cameraIntent }
}

export function saveHeightNav(
  world: HeightWorld,
  savedNav: HeightNavSnapshot,
): HeightWorld {
  return { ...world, savedNav }
}
