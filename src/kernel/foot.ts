import type { FootShape } from '../domain/foot-shape.ts'
import type { RigSolution, RigSolver, SolveOptions } from './index.ts'

/**
 * Measures every foot rig must define, in meters, matching the FootShape
 * definitions: length is heel to the tip of the longest toe along the sole;
 * toe length runs from the first MTP joint to that tip; ball width spans the
 * forefoot at the MTP joints; instep height is the top of the foot halfway
 * along its length.
 */
export const FOOT_RIG_MEASURES = ['length', 'toeLength', 'ballWidth', 'instepHeight'] as const

// Rest measurements are immutable for a solver; avoid evaluating them on every
// slider tick. Weak keys let unloaded solvers be collected.
const restMeasures = new WeakMap<RigSolver, Readonly<Record<string, number>>>()

export function footTargets(shape: FootShape): Record<(typeof FOOT_RIG_MEASURES)[number], number> {
  return {
    length: shape.lengthMm / 1000,
    toeLength: shape.toeLengthMm / 1000,
    ballWidth: shape.ballWidthMm / 1000,
    instepHeight: shape.instepHeightMm / 1000,
  }
}

export function assertFootRig(solver: RigSolver): void {
  const missing = [...FOOT_RIG_MEASURES, 'lowerLegHeight'].filter((name) => !solver.measureNames.includes(name))
  if (missing.length > 0) {
    throw new RangeError(`Foot rig ${solver.rig.mesh} is missing measures: ${missing.join(', ')}`)
  }
}

/**
 * Grows the lower leg with heel-to-ball length, preserving the authored ankle
 * proportions instead of stretching the foot away from a stationary shin.
 * This is a geometric proportion rule, not a prediction of a person's stature.
 * Toe-only edits leave heel-to-ball length (and thus the lower leg) unchanged;
 * width and instep remain independent local adjustments with blended weights.
 */
export function footRigTargets(solver: RigSolver, shape: FootShape): Record<string, number> {
  let rest = restMeasures.get(solver)
  if (!rest) {
    assertFootRig(solver)
    rest = solver.evaluate().measures
    restMeasures.set(solver, rest)
  }
  const targets = footTargets(shape)
  const growth = (targets.length - targets.toeLength) / (rest.length - rest.toeLength)
  return { ...targets, lowerLegHeight: rest.lowerLegHeight * growth }
}

/** Solves the exact foot dimensions together with the proportional lower leg. */
export function solveFoot(
  solver: RigSolver,
  shape: FootShape,
  options: SolveOptions = {},
): RigSolution & { maxErrorMm: number } {
  const solution = solver.solve(footRigTargets(solver, shape), options)
  return { ...solution, maxErrorMm: solution.maxError * 1000 }
}
