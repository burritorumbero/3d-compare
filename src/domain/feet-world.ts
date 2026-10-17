import type { FootCatalogId } from './catalog.ts'
import type { PlacementId } from './ids.ts'
import { nextFootPose, type PlanarDelta, type SurfacePose } from './layout.ts'
import type { FootShape } from './foot-shape.ts'
import type {
  FeetCameraIntent,
  FeetNavMode,
  FeetNavSnapshot,
} from './navigation.ts'
import type { PlaceResult, UpdateResult } from './results.ts'

export const FEET_CAP = 10

export type PlacedFoot = {
  kind: 'foot'
  id: PlacementId
  catalogId: FootCatalogId
  shape: FootShape
  pose: SurfacePose
}

export type FeetWorld = {
  kind: 'feet'
  placements: readonly PlacedFoot[]
  selected: PlacementId | null
  navMode: FeetNavMode
  cameraIntent: FeetCameraIntent
  savedNav: FeetNavSnapshot | null
}

export function emptyFeetWorld(): FeetWorld {
  return {
    kind: 'feet',
    placements: [],
    selected: null,
    navMode: 'orbit',
    cameraIntent: { kind: 'none' },
    savedNav: null,
  }
}

export function selectedFoot(world: FeetWorld): PlacedFoot | null {
  return world.placements.find((placement) => placement.id === world.selected) ?? null
}

/** Automatic columns also reflow old saves and close gaps after removal. */
export function footLineupPose(world: FeetWorld, id: PlacementId): SurfacePose {
  const index = world.placements.findIndex((placement) => placement.id === id)
  return nextFootPose(Math.max(0, index))
}

export function placeFoot(
  world: FeetWorld,
  id: PlacementId,
  catalogId: FootCatalogId,
  initialShape: FootShape,
): { world: FeetWorld; result: PlaceResult } {
  if (world.placements.length >= FEET_CAP) {
    return { world, result: { ok: false, reason: 'cap-reached' } }
  }

  const placement: PlacedFoot = {
    kind: 'foot',
    id,
    catalogId,
    shape: initialShape,
    pose: nextFootPose(world.placements.length),
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

export function updateFootShape(
  world: FeetWorld,
  id: PlacementId,
  shape: FootShape,
): { world: FeetWorld; result: UpdateResult } {
  if (!world.placements.some((placement) => placement.id === id)) {
    return { world, result: { ok: false, reason: 'not-found' } }
  }

  return {
    world: {
      ...world,
      placements: world.placements.map((placement) =>
        placement.id === id ? { ...placement, shape } : placement,
      ),
    },
    result: { ok: true },
  }
}

export function selectFoot(world: FeetWorld, id: PlacementId | null): FeetWorld {
  const selected =
    id === null || world.placements.some((placement) => placement.id === id) ? id : null
  return selected === world.selected ? world : { ...world, selected }
}

export function removeFoot(world: FeetWorld, id: PlacementId): FeetWorld {
  if (!world.placements.some((placement) => placement.id === id)) {
    return world
  }

  return {
    ...world,
    placements: world.placements.filter((placement) => placement.id !== id),
    selected: world.selected === id ? null : world.selected,
  }
}

export function repositionFoot(
  world: FeetWorld,
  id: PlacementId,
  delta: PlanarDelta,
): { world: FeetWorld; result: UpdateResult } {
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

export function setFeetNavMode(world: FeetWorld, navMode: FeetNavMode): FeetWorld {
  return world.navMode === navMode ? world : { ...world, navMode }
}

export function setFeetCameraIntent(
  world: FeetWorld,
  cameraIntent: FeetCameraIntent,
): FeetWorld {
  return { ...world, cameraIntent }
}

export function saveFeetNav(world: FeetWorld, savedNav: FeetNavSnapshot): FeetWorld {
  return { ...world, savedNav }
}
