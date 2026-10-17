/**
 * A rig file (`*.rig.json`, shipped next to a GLB) describes how a mesh deforms
 * and how it is measured, by name. The asset pipeline writes it; the kernel
 * reads it through `encodeRig`, which flattens it into typed arrays.
 *
 * Conventions the kernel relies on:
 * - Deform bones have an identity rest rotation, so a bone scale is an
 *   axis-aligned scale about the bone head. In three.js, `bone.scale` on such a
 *   bone produces exactly the deformation the kernel computes.
 * - Bone heads sit on the floor (y = 0) so vertical scaling keeps soles down.
 * - `vertices` is a sample of the mesh: every vertex a measure or the hull uses.
 *   `source` maps each back to its index in the GLB mesh.
 * - Units are the GLB's: meters. Controls are factors with a rest value of 1.
 */
export type Axis = 'x' | 'y' | 'z'

export type RigChannel =
  | { bone: string; axis: Axis; gain: number }
  | { morph: string; gain: number }

export type RigMeasure =
  | { name: string; kind: 'extent' | 'max'; group: string; axis: Axis }
  | { name: string; kind: 'between'; from: string; to: string; axis: Axis }

export type RigFile = {
  version: 1
  /** The GLB mesh this rig deforms. */
  mesh: string
  bones: readonly { name: string; parent: string | null; head: readonly [number, number, number] }[]
  vertices: {
    source: readonly number[]
    /** x, y, z per vertex. */
    positions: readonly number[]
    /** Four bone indices per vertex. */
    skinBones: readonly number[]
    /** Four weights per vertex, summing to 1. */
    skinWeights: readonly number[]
  }
  morphs: readonly { name: string; deltas: readonly number[] }[]
  controls: readonly { name: string; min: number; max: number; channels: readonly RigChannel[] }[]
  groups: Readonly<Record<string, readonly number[]>>
  measures: readonly RigMeasure[]
  /** The group whose vertices bound the deformed mesh. */
  hull: string
}

/** The flat layout `Kernel`'s constructor takes, in argument order. */
export type EncodedRig = {
  parents: Int32Array
  heads: Float64Array
  positions: Float64Array
  skinBones: Uint32Array
  skinWeights: Float64Array
  morphCount: number
  morphDeltas: Float64Array
  /** Rows of kind (0 bone scale, 1 morph), control, bone or morph, axis, gain. */
  channels: Float64Array
  /** Low, high per control. */
  controlBounds: Float64Array
  groupOffsets: Uint32Array
  groupMembers: Uint32Array
  /** Rows of kind (0 extent, 1 max, 2 between), group or from, to, axis. */
  measures: Uint32Array
  hullGroup: number
  controlNames: readonly string[]
  measureNames: readonly string[]
}

const AXES: Record<Axis, number> = { x: 0, y: 1, z: 2 }

function lookup(names: readonly string[], name: string, what: string): number {
  const index = names.indexOf(name)
  if (index === -1) {
    throw new RangeError(`Rig names a missing ${what}: ${name}`)
  }

  return index
}

export function encodeRig(rig: RigFile): EncodedRig {
  if (rig.version !== 1) {
    throw new RangeError(`Unsupported rig version ${String(rig.version)}.`)
  }

  const boneNames = rig.bones.map((bone) => bone.name)
  const morphNames = rig.morphs.map((morph) => morph.name)
  const groupNames = Object.keys(rig.groups)

  const channels: number[] = []
  rig.controls.forEach((control, controlIndex) => {
    for (const channel of control.channels) {
      if ('bone' in channel) {
        channels.push(0, controlIndex, lookup(boneNames, channel.bone, 'bone'), AXES[channel.axis], channel.gain)
      } else {
        channels.push(1, controlIndex, lookup(morphNames, channel.morph, 'morph'), 0, channel.gain)
      }
    }
  })

  const groupOffsets = [0]
  const groupMembers: number[] = []
  for (const name of groupNames) {
    groupMembers.push(...rig.groups[name])
    groupOffsets.push(groupMembers.length)
  }

  const measures = rig.measures.flatMap((measure) =>
    measure.kind === 'between'
      ? [2, lookup(groupNames, measure.from, 'group'), lookup(groupNames, measure.to, 'group'), AXES[measure.axis]]
      : [measure.kind === 'extent' ? 0 : 1, lookup(groupNames, measure.group, 'group'), 0, AXES[measure.axis]],
  )

  return {
    parents: Int32Array.from(rig.bones, (bone) =>
      bone.parent === null ? -1 : lookup(boneNames, bone.parent, 'parent bone'),
    ),
    heads: Float64Array.from(rig.bones.flatMap((bone) => bone.head)),
    positions: Float64Array.from(rig.vertices.positions),
    skinBones: Uint32Array.from(rig.vertices.skinBones),
    skinWeights: Float64Array.from(rig.vertices.skinWeights),
    morphCount: rig.morphs.length,
    morphDeltas: Float64Array.from(rig.morphs.flatMap((morph) => morph.deltas)),
    channels: Float64Array.from(channels),
    controlBounds: Float64Array.from(rig.controls.flatMap((control) => [control.min, control.max])),
    groupOffsets: Uint32Array.from(groupOffsets),
    groupMembers: Uint32Array.from(groupMembers),
    measures: Uint32Array.from(measures),
    hullGroup: lookup(groupNames, rig.hull, 'hull group'),
    controlNames: rig.controls.map((control) => control.name),
    measureNames: rig.measures.map((measure) => measure.name),
  }
}
