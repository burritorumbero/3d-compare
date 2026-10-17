import { ANSUR_II, type AllometricFit } from './anthropometry.ts'
import type { Sex } from './catalog.ts'

/**
 * Body landmarks the stature solve fits a rigged person to, in millimeters.
 * Heights are from the floor; breadths are horizontal spans.
 */
export type BodyLandmarks = {
  /** Lateral malleolus: the ankle bone. */
  ankle: number
  /** Mid-patella. */
  knee: number
  crotch: number
  /** Acromion: the point of the shoulder. */
  shoulder: number
  /** Cervicale: the base of the neck at the back. */
  neck: number
  /** Tragion: the ear opening. Stature minus this is the head above the ear. */
  ear: number
  stature: number
  biacromialBreadth: number
  hipBreadth: number
  footLength: number
  /**
   * Shoulder joint to elbow to wrist, following the anatomical limb path.
   */
  armLength: number
}

/** Surface widths measured on each authored mesh; they preserve that person's build. */
export type BodyWidths = { headWidth: number; neckWidth: number; armWidth: number; handWidth: number }
export const BODY_WIDTHS = ['headWidth', 'neckWidth', 'armWidth', 'handWidth'] as const

// Nearby shoulder/neck landmarks can amplify residual error into torso scale.
// Solve them tightly enough that dragging back to a height restores its shape.
export const STATURE_TOLERANCE_MM = .005

export const BODY_LANDMARKS = [
  'ankle',
  'knee',
  'crotch',
  'shoulder',
  'neck',
  'ear',
  'stature',
  'biacromialBreadth',
  'hipBreadth',
  'footLength',
  'armLength',
] as const satisfies readonly (keyof BodyLandmarks)[]

/** Landmark heights from the floor up; each must sit above the one before at every stature. */
export const LANDMARK_HEIGHT_ORDER = ['ankle', 'knee', 'crotch', 'shoulder', 'neck', 'ear', 'stature'] as const

function power(fit: AllometricFit, statureMm: number): number {
  return fit.coefficient * statureMm ** fit.exponent
}

/**
 * Adult averages for a stature, from the ANSUR II power laws: segment lengths
 * grow at different rates, so legs lengthen faster than the head grows. Past
 * the surveyed range (about 1.4 to 2.0 m) the laws extrapolate; the predicted
 * order of landmarks holds from 0.9 m to 3.05 m (see verify-domain).
 */
export function averageLandmarks(sex: Sex, statureMm: number): BodyLandmarks {
  const fits = ANSUR_II[sex].allometry
  return {
    ankle: power(fits.lateralMalleolusHeight, statureMm),
    knee: power(fits.kneeHeight, statureMm),
    crotch: power(fits.crotchHeight, statureMm),
    shoulder: power(fits.acromialHeight, statureMm),
    neck: power(fits.cervicaleHeight, statureMm),
    ear: statureMm - power(fits.headAboveTragion, statureMm),
    stature: statureMm,
    biacromialBreadth: power(fits.biacromialBreadth, statureMm),
    hipBreadth: power(fits.hipBreadth, statureMm),
    footLength: power(fits.footLength, statureMm),
    armLength: power(fits.armLength, statureMm),
  }
}

// Observed public ANSUR II stature bounds (not percentile bands). Outside them,
// gradually stop changing relative proportions. This is an artistic extension,
// not a biological prediction for children or giant adults. The tanh shoulder
// keeps both the value and slope continuous and bounds the proportion drift.
const ADULT_STATURE: Record<Sex, readonly [number, number]> = { female: [1409, 1829], male: [1491, 1993] }
const EXTRAPOLATION_LOG_SPAN = Math.log(1.25)

export function statureGrowth(sex: Sex, referenceMm: number, targetMm: number, exponent: number): number {
  const [low, high] = ADULT_STATURE[sex].map(Math.log)
  function shapeLog(mm: number): number {
    const h = Math.log(mm)
    const edge = Math.max(low, Math.min(high, h))
    return edge + EXTRAPOLATION_LOG_SPAN * Math.tanh((h - edge) / EXTRAPOLATION_LOG_SPAN)
  }
  return targetMm / referenceMm * Math.exp((exponent - 1) * (shapeLog(targetMm) - shapeLog(referenceMm)))
}

/**
 * Preserve authored identity, then choose dimensions independently of placement.
 * Head (.67), neck/upper-head spacing (.8), and hand (.72) are reviewed visual policies;
 * the survey's tragion-to-crown fit is not a whole-head growth model. Arm girth
 * follows shoulder breadth, preserving build instead of applying arm length's
 * exponent to thickness. Upper landmarks are assembled from local segment gaps.
 */
export function statureTargets(
  sex: Sex,
  authored: BodyLandmarks & Partial<BodyWidths>,
  statureMm: number,
): BodyLandmarks & Partial<BodyWidths> {
  const fits = ANSUR_II[sex].allometry
  const grow = (exponent: number) => statureGrowth(sex, authored.stature, statureMm, exponent)
  const head = grow(.67)
  const breadth = grow(fits.biacromialBreadth.exponent)
  const ear = statureMm - (authored.stature - authored.ear) * head
  const neck = ear - (authored.ear - authored.neck) * grow(.8)
  const targets: BodyLandmarks & Partial<BodyWidths> = {
    ankle: authored.ankle * grow(fits.lateralMalleolusHeight.exponent),
    knee: authored.knee * grow(fits.kneeHeight.exponent),
    crotch: authored.crotch * grow(fits.crotchHeight.exponent),
    shoulder: neck - (authored.neck - authored.shoulder) * grow(1),
    neck,
    ear,
    stature: statureMm,
    biacromialBreadth: authored.biacromialBreadth * breadth,
    hipBreadth: authored.hipBreadth * grow(fits.hipBreadth.exponent),
    footLength: authored.footLength * grow(fits.footLength.exponent),
    armLength: authored.armLength * grow(fits.armLength.exponent),
  }
  const widthGrowth = { headWidth: head, neckWidth: breadth, armWidth: breadth, handWidth: grow(.72) }
  for (const key of BODY_WIDTHS) {
    const width = authored[key]
    if (width !== undefined) targets[key] = width * widthGrowth[key]
  }
  return targets
}
