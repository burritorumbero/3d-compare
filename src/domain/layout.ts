export type FloorPose = {
  space: 'floor'
  x: number
  z: number
  yaw: number
}

export type SurfacePose = {
  space: 'table'
  x: number
  z: number
  yaw: number
}

export type PlanarDelta = {
  x: number
  z: number
  yaw?: number
}

/** The human models stand in an A-pose about 1.2 m across, so a lineup needs this much room. */
export const HUMAN_SPACING_M = 1.2
/** A pair of feet with a narrowed stance is about 0.3 m across before scaling, and up to 0.48 m at the largest sizes. */
export const FOOT_SPACING_M = 0.5
export const FOOT_COLUMNS = 5
/** Rows of feet stand with their heels on lines this far in front of and behind the table center. */
export const FOOT_ROW_OFFSET_M = 0.26

function centeredSlot(index: number): number {
  if (index === 0) {
    return 0
  }

  const distance = Math.ceil(index / 2)
  return index % 2 === 1 ? -distance : distance
}

/** Everyone stands on one line so the eye compares heights without perspective bias. */
export function nextHumanPose(count: number): FloorPose {
  return {
    space: 'floor',
    x: centeredSlot(count) * HUMAN_SPACING_M,
    z: 0,
    yaw: 0,
  }
}

export function nextFootPose(count: number): SurfacePose {
  const column = count % FOOT_COLUMNS
  const row = Math.floor(count / FOOT_COLUMNS)
  return {
    space: 'table',
    x: centeredSlot(column) * FOOT_SPACING_M,
    z: row === 0 ? -FOOT_ROW_OFFSET_M : FOOT_ROW_OFFSET_M,
    yaw: 0,
  }
}
