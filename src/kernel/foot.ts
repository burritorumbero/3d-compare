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

export function footTargets(shape: FootShape): Record<(typeof FOOT_RIG_MEASURES)[number], number> {
  return {
    length: shape.lengthMm / 1000,
    toeLength: shape.toeLengthMm / 1000,
    ballWidth: shape.ballWidthMm / 1000,
    instepHeight: shape.instepHeightMm / 1000,
  }
}

export function assertFootRig(solver: RigSolver): void {
  const missing = FOOT_RIG_MEASURES.filter((name) => !solver.measureNames.includes(name))
  if (missing.length > 0) {
    throw new RangeError(`Foot rig ${solver.rig.mesh} is missing measures: ${missing.join(', ')}`)
  }
}

/** Solves a rig so the deformed foot measures exactly the given shape. */
export function solveFoot(
  solver: RigSolver,
  shape: FootShape,
  options: SolveOptions = {},
): RigSolution & { maxErrorMm: number } {
  const solution = solver.solve(footTargets(shape), options)
  return { ...solution, maxErrorMm: solution.maxError * 1000 }
}
