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
   * Shoulder point to wrist. A rig may measure this as the arm's vertical drop in
   * its rest pose: with the arm scaled uniformly, the drop changes in proportion.
   */
  armLength: number
}

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

/**
 * Keep the authored head and neck proportional to stature. Scaling the upper
 * landmarks together also leaves room for the neck above the shoulders; using
 * the extrapolated adult ear height alone makes heads disproportionately small on very tall figures.
 * Legs, arm length and body breadths retain the adult allometric adjustments.
 */
export function statureTargets(sex: Sex, authored: BodyLandmarks, statureMm: number): BodyLandmarks {
  const from = averageLandmarks(sex, authored.stature)
  const to = averageLandmarks(sex, statureMm)
  const targets = {} as BodyLandmarks
  for (const landmark of BODY_LANDMARKS) {
    targets[landmark] = authored[landmark] * (to[landmark] / from[landmark])
  }
  const growth = statureMm / authored.stature
  for (const landmark of ['shoulder', 'neck', 'ear'] as const) {
    targets[landmark] = authored[landmark] * growth
  }
  targets.stature = statureMm
  return targets
}
