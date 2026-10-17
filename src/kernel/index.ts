import init, { Kernel } from './pkg/kernel.js'
import { encodeRig, type RigFile } from './rig.ts'

export type { RigFile } from './rig.ts'

let ready: Promise<void> | null = null

/**
 * Instantiates the WebAssembly module once. The browser passes the URL Vite
 * serves `kernel_bg.wasm` from (see `browser.ts`); Node passes the file bytes.
 */
export function loadKernel(source: URL | string | BufferSource): Promise<void> {
  ready ??= init({ module_or_path: source }).then(() => undefined)
  return ready
}

export type Bounds = {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}

export type RigPose = {
  /** Local x, y, z scale per bone in rig order: set as `bone.scale` in three.js. */
  boneScales: readonly (readonly [number, number, number])[]
  morphWeights: readonly number[]
}

export type RigSolution = {
  controls: Readonly<Record<string, number>>
  measures: Readonly<Record<string, number>>
  bounds: Bounds
  iterations: number
  /** Largest |measured - target| over the targeted measures, in rig units. */
  maxError: number
}

export type SolveOptions = {
  /** Start here instead of the rest pose: pass the last solution while a slider drags. */
  initial?: Readonly<Record<string, number>>
  /** Values the controls are pulled toward when targets leave freedom. Defaults to rest. */
  prior?: Readonly<Record<string, number>>
  /** Prior weight relative to a 1 mm error squared. Small values only break ties. */
  priorWeight?: number
  /** Stop once every target is within this, in rig units. Defaults to 0.05 mm. */
  tolerance?: number
}

/** A loaded rig: solves measurement targets for controls, and poses for the GPU. */
export class RigSolver {
  readonly rig: RigFile
  readonly controlNames: readonly string[]
  readonly measureNames: readonly string[]
  private readonly kernel: Kernel
  private readonly boneCount: number

  constructor(rig: RigFile) {
    const encoded = encodeRig(rig)
    this.rig = rig
    this.controlNames = encoded.controlNames
    this.measureNames = encoded.measureNames
    this.boneCount = rig.bones.length
    this.kernel = new Kernel(
      encoded.parents,
      encoded.heads,
      encoded.inheritScale,
      encoded.positions,
      encoded.skinBones,
      encoded.skinWeights,
      encoded.morphCount,
      encoded.morphDeltas,
      encoded.channels,
      encoded.controlBounds,
      encoded.groupOffsets,
      encoded.groupMembers,
      encoded.measures,
      encoded.hullGroup,
    )
  }

  private controlArray(values: Readonly<Record<string, number>> | undefined): Float64Array {
    return Float64Array.from(this.controlNames, (name) => values?.[name] ?? 1)
  }

  private named(names: readonly string[], values: ArrayLike<number>, offset = 0): Record<string, number> {
    return Object.fromEntries(names.map((name, index) => [name, values[offset + index]]))
  }

  private bounds(values: ArrayLike<number>, offset: number): Bounds {
    return {
      min: [values[offset], values[offset + 1], values[offset + 2]],
      max: [values[offset + 3], values[offset + 4], values[offset + 5]],
    }
  }

  /** Measures and bounds at the given controls. Missing controls stay at rest. */
  evaluate(controls?: Readonly<Record<string, number>>): { measures: Record<string, number>; bounds: Bounds } {
    const values = this.kernel.evaluate(this.controlArray(controls))
    return { measures: this.named(this.measureNames, values), bounds: this.bounds(values, this.measureNames.length) }
  }

  /** Bone scales and morph weights to apply to the three.js skeleton and mesh. */
  pose(controls: Readonly<Record<string, number>>): RigPose {
    const values = this.kernel.pose(this.controlArray(controls))
    const boneScales = Array.from({ length: this.boneCount }, (_, bone) => {
      const at = bone * 3
      return [values[at], values[at + 1], values[at + 2]] as const
    })
    return { boneScales, morphWeights: Array.from(values.subarray(this.boneCount * 3)) }
  }

  /** Finds controls that make the named measures hit their targets. Unnamed measures are free. */
  solve(targets: Readonly<Record<string, number>>, options: SolveOptions = {}): RigSolution {
    for (const name of Object.keys(targets)) {
      if (!this.measureNames.includes(name)) {
        throw new RangeError(`Rig has no measure named ${name}.`)
      }
    }

    const values = this.kernel.solve(
      Float64Array.from(this.measureNames, (name) => targets[name] ?? Number.NaN),
      this.controlArray(options.initial),
      this.controlArray(options.prior),
      options.priorWeight ?? 1e-4,
      options.tolerance ?? 0.00005,
    )
    const controls = this.controlNames.length
    const measures = this.measureNames.length
    return {
      controls: this.named(this.controlNames, values),
      measures: this.named(this.measureNames, values, controls),
      bounds: this.bounds(values, controls + measures),
      iterations: values[controls + measures + 6],
      maxError: values[controls + measures + 7],
    }
  }

  /** Frees the WebAssembly memory behind this rig. */
  dispose(): void {
    this.kernel.free()
  }
}
