import { ANSUR_II } from './anthropometry.ts'
import type { Sex } from './catalog.ts'
import {
  FOOT_LENGTH_MM_MAX,
  FOOT_LENGTH_MM_MIN,
  footLengthMm,
  type FootLengthMm,
} from './measure.ts'

/**
 * A foot is described the way a CAD part is: by named dimensions in millimeters.
 * Foot length is heel to the tip of the longest toe, and shoe size reads it.
 * The other three are driven by foot length (they follow adult averages) until
 * someone sets one, which locks it as a driving dimension that keeps its value.
 *
 * Toe length is part of foot length, so changing it changes foot length, and the
 * shoe size, by the same amount. The heel-to-ball part of the foot is unchanged.
 */
export type FootDimension = 'toeLength' | 'ballWidth' | 'instepHeight'

export const FOOT_DIMENSIONS: readonly FootDimension[] = ['toeLength', 'ballWidth', 'instepHeight']

export type FootShape = {
  lengthMm: FootLengthMm
  /** First MTP joint to the tip of the longest toe. */
  toeLengthMm: number
  /** Horizontal breadth across the first and fifth MTP joints. */
  ballWidthMm: number
  /** Floor to the top of the foot halfway along its length. */
  instepHeightMm: number
  /** Dimensions set by hand. The rest follow foot length. */
  locked: readonly FootDimension[]
}

export type FootShapeResult =
  | { ok: true; value: FootShape }
  | {
      ok: false
      reason: 'constraint-violated'
      dimension: 'length' | FootDimension
      message: string
    }

/**
 * Instep height has no ANSUR II measurement. This ratio is a provisional adult
 * average to calibrate against the rigged base mesh; it is not survey data.
 */
const INSTEP_RATIO = 0.25

/**
 * Allowed proportions, as ratios to foot length. They reach well past the ANSUR II
 * 1st to 99th percentile bands so unusual feet can be modeled, while keeping the
 * mesh inside the range the rig can deform without breaking its shape.
 */
export const FOOT_RATIO_LIMITS: Record<FootDimension, { min: number; max: number }> = {
  toeLength: { min: 0.18, max: 0.34 },
  ballWidth: { min: 0.3, max: 0.48 },
  instepHeight: { min: 0.18, max: 0.34 },
}

const LABELS: Record<'length' | FootDimension, string> = {
  length: 'Foot length',
  toeLength: 'Toe length',
  ballWidth: 'Foot width',
  instepHeight: 'Foot thickness',
}

export function footDimensionLabel(dimension: 'length' | FootDimension): string {
  return LABELS[dimension]
}

/** The adult median of a dimension for a foot of this length. */
export function typicalFootDimension(dimension: FootDimension, sex: Sex, lengthMm: number): number {
  const ratio =
    dimension === 'toeLength'
      ? ANSUR_II[sex].toeRatio.p50
      : dimension === 'ballWidth'
        ? ANSUR_II[sex].widthRatio.p50
        : INSTEP_RATIO
  return Math.round(lengthMm * ratio)
}

function isLocked(shape: Pick<FootShape, 'locked'>, dimension: FootDimension): boolean {
  return shape.locked.includes(dimension)
}

function withLock(locked: readonly FootDimension[], dimension: FootDimension): readonly FootDimension[] {
  return locked.includes(dimension)
    ? locked
    : FOOT_DIMENSIONS.filter((candidate) => candidate === dimension || locked.includes(candidate))
}

function valueOf(shape: FootShape, dimension: FootDimension): number {
  return dimension === 'toeLength'
    ? shape.toeLengthMm
    : dimension === 'ballWidth'
      ? shape.ballWidthMm
      : shape.instepHeightMm
}

export function footDimensionMm(shape: FootShape, dimension: FootDimension): number {
  return valueOf(shape, dimension)
}

function rangeMessage(dimension: 'length' | FootDimension, min: number, max: number): string {
  return `${LABELS[dimension]} must be between ${Math.ceil(min)} and ${Math.floor(max)} mm here.`
}

/** The millimeter range a dimension may take on a foot of this length. */
export function footDimensionRange(dimension: FootDimension, lengthMm: number): { min: number; max: number } {
  const limits = FOOT_RATIO_LIMITS[dimension]
  return { min: lengthMm * limits.min, max: lengthMm * limits.max }
}

/**
 * The values a dimension can be set to on this foot. Toe length moves foot length
 * with it, so its range comes from the fixed heel-to-ball part and the foot length
 * limits; the others are bounded by the current foot length.
 */
export function footDimensionEditRange(shape: FootShape, dimension: FootDimension): { min: number; max: number } {
  if (dimension !== 'toeLength') {
    const range = footDimensionRange(dimension, shape.lengthMm)
    return { min: Math.ceil(range.min), max: Math.floor(range.max) }
  }

  const limits = FOOT_RATIO_LIMITS.toeLength
  const heelToBall = shape.lengthMm - shape.toeLengthMm
  return {
    min: Math.ceil(Math.max((heelToBall * limits.min) / (1 - limits.min), FOOT_LENGTH_MM_MIN - heelToBall)),
    max: Math.floor(Math.min((heelToBall * limits.max) / (1 - limits.max), FOOT_LENGTH_MM_MAX - heelToBall)),
  }
}

/** Checks every constraint and names the first dimension that breaks one. */
export function validateFootShape(shape: FootShape): FootShapeResult {
  if (shape.lengthMm < FOOT_LENGTH_MM_MIN || shape.lengthMm > FOOT_LENGTH_MM_MAX) {
    return {
      ok: false,
      reason: 'constraint-violated',
      dimension: 'length',
      message: rangeMessage('length', FOOT_LENGTH_MM_MIN, FOOT_LENGTH_MM_MAX),
    }
  }

  for (const dimension of FOOT_DIMENSIONS) {
    const value = valueOf(shape, dimension)
    const range = footDimensionRange(dimension, shape.lengthMm)
    if (!Number.isFinite(value) || value < range.min - 0.5 || value > range.max + 0.5) {
      return {
        ok: false,
        reason: 'constraint-violated',
        dimension,
        message: rangeMessage(dimension, range.min, range.max),
      }
    }
  }

  return { ok: true, value: shape }
}

/** Re-derives every unlocked dimension from foot length. */
function rederive(shape: FootShape, sex: Sex): FootShape {
  const follow = (dimension: FootDimension, current: number): number =>
    isLocked(shape, dimension) ? current : typicalFootDimension(dimension, sex, shape.lengthMm)
  return {
    ...shape,
    toeLengthMm: follow('toeLength', shape.toeLengthMm),
    ballWidthMm: follow('ballWidth', shape.ballWidthMm),
    instepHeightMm: follow('instepHeight', shape.instepHeightMm),
  }
}

/** An average adult foot of this length: nothing locked. */
export function typicalFootShape(sex: Sex, lengthMm: FootLengthMm): FootShape {
  return rederive(
    { lengthMm, toeLengthMm: 0, ballWidthMm: 0, instepHeightMm: 0, locked: [] },
    sex,
  )
}

/**
 * Sets foot length, as a shoe size does. Locked dimensions keep their millimeters;
 * the rest follow the new length.
 */
export function resizeFoot(shape: FootShape, sex: Sex, lengthMm: FootLengthMm): FootShapeResult {
  return validateFootShape(rederive({ ...shape, lengthMm }, sex))
}

/**
 * Sets one dimension by hand and locks it. A new toe length moves the toe tip, so
 * foot length changes by the same amount; unlocked width and thickness then follow
 * the new length.
 */
export function setFootDimension(
  shape: FootShape,
  sex: Sex,
  dimension: FootDimension,
  valueMm: number,
): FootShapeResult {
  if (!Number.isFinite(valueMm) || valueMm <= 0) {
    return {
      ok: false,
      reason: 'constraint-violated',
      dimension,
      message: `${LABELS[dimension]} must be a positive number of millimeters.`,
    }
  }

  const value = Math.round(valueMm)
  const locked = withLock(shape.locked, dimension)
  if (dimension === 'toeLength') {
    const lengthMm = shape.lengthMm - shape.toeLengthMm + value
    if (lengthMm < FOOT_LENGTH_MM_MIN || lengthMm > FOOT_LENGTH_MM_MAX) {
      return {
        ok: false,
        reason: 'constraint-violated',
        dimension: 'length',
        message: `That toe length makes the foot ${lengthMm} mm long. ${rangeMessage('length', FOOT_LENGTH_MM_MIN, FOOT_LENGTH_MM_MAX)}`,
      }
    }

    return validateFootShape(
      rederive({ ...shape, lengthMm: footLengthMm(lengthMm), toeLengthMm: value, locked }, sex),
    )
  }

  return validateFootShape({
    ...shape,
    ...(dimension === 'ballWidth' ? { ballWidthMm: value } : { instepHeightMm: value }),
    locked,
  })
}

/**
 * Unlocks a dimension so it follows foot length again. Resetting toe length keeps
 * the heel-to-ball part of the foot and grows or shrinks the toes back to the
 * average proportion, so foot length changes too.
 */
export function resetFootDimension(shape: FootShape, sex: Sex, dimension: FootDimension): FootShapeResult {
  const locked = shape.locked.filter((candidate) => candidate !== dimension)
  if (dimension !== 'toeLength') {
    return validateFootShape(rederive({ ...shape, locked }, sex))
  }

  const ratio = ANSUR_II[sex].toeRatio.p50
  const heelToBall = shape.lengthMm - shape.toeLengthMm
  const lengthMm = Math.round(heelToBall / (1 - ratio))
  if (lengthMm < FOOT_LENGTH_MM_MIN || lengthMm > FOOT_LENGTH_MM_MAX) {
    return {
      ok: false,
      reason: 'constraint-violated',
      dimension: 'length',
      message: `Average toes would make the foot ${lengthMm} mm long. ${rangeMessage('length', FOOT_LENGTH_MM_MIN, FOOT_LENGTH_MM_MAX)}`,
    }
  }

  return validateFootShape(rederive({ ...shape, lengthMm: footLengthMm(lengthMm), locked }, sex))
}

/** Where a dimension sits among adults of the same sex with the same foot length. */
export function footDimensionPercentileBand(
  shape: FootShape,
  sex: Sex,
  dimension: FootDimension,
): 'below-typical' | 'typical' | 'above-typical' | null {
  if (dimension === 'instepHeight') {
    return null
  }

  const band = dimension === 'toeLength' ? ANSUR_II[sex].toeRatio : ANSUR_II[sex].widthRatio
  const ratio = valueOf(shape, dimension) / shape.lengthMm
  return ratio < band.p01 ? 'below-typical' : ratio > band.p99 ? 'above-typical' : 'typical'
}
