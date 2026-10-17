// Builds a rig file for one foot of the current static feet GLBs, procedurally.
// It is a test fixture for the kernel until the Blender pipeline exports
// authored rigs: same file format, same measure names, real foot geometry.
//
// Bones (heads on the floor, identity rest rotation, per the rig contract):
//   shin   root at the heel; keeps the leg above the ankle unchanged
//   foot   child of shin; length, width, and thickness of the whole foot
//   toes   child of foot at the ball line; toe length
import { meshPositions, bounds } from './glb.mjs'

/** ANSUR II ball-of-foot length is about 74% of foot length for both sexes. */
const BALL_RATIO = 0.74

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function proceduralFootRig(glb, meshName) {
  const all = meshPositions(glb, meshName)
  const soleAll = all.filter((point) => point[1] < 0.03)
  const sole = bounds(soleAll)
  const heelZ = sole.min[2]
  const tipZ = sole.max[2]
  const length = tipZ - heelZ
  const ballZ = heelZ + BALL_RATIO * length
  const midZ = heelZ + length / 2
  const centerX = (sole.min[0] + sole.max[0]) / 2
  // ANSUR II puts the lateral malleolus at about 0.27 of foot length; the shin
  // takes over just above it, clear of the instep.
  const ankleY = 0.36 * length

  // Membership tests on rest positions, by GLB vertex index.
  const isSole = (p) => p[1] < 0.03
  // Only the two ends of the sole can set its length, whatever the deformation.
  const isSoleEnd = (p) => isSole(p) && (p[2] < heelZ + 0.015 || p[2] > tipZ - 0.015)
  const isTip = (p) => isSole(p) && p[2] > tipZ - 0.003
  const isBall = (p) => isSole(p) && Math.abs(p[2] - ballZ) < 0.004
  const isForefoot = (p) => p[1] < 0.05 && Math.abs(p[2] - ballZ) < 0.008
  const isInstep = (p) => Math.abs(p[2] - midZ) < 0.004 && p[1] < ankleY
  const isHull = (p, index) => index % 24 === 0 || isSoleEnd(p)

  const sampled = []
  all.forEach((point, index) => {
    if (isSoleEnd(point) || isBall(point) || isForefoot(point) || isInstep(point) || isHull(point, index)) {
      sampled.push(index)
    }
  })

  const positions = []
  const skinBones = []
  const skinWeights = []
  const groups = { soleEnds: [], tip: [], ball: [], forefoot: [], instep: [], hull: [] }
  sampled.forEach((source, local) => {
    const point = all[source]
    positions.push(...point)
    // Above the ankle the shin holds; below, the foot, handing over to the toes past the ball.
    const shin = smoothstep(0.3 * length, 0.42 * length, point[1])
    const toes = (1 - shin) * smoothstep(ballZ - 0.012, ballZ + 0.012, point[2])
    const foot = 1 - shin - toes
    skinBones.push(0, 1, 2, 0)
    skinWeights.push(shin, foot, toes, 0)
    if (isSoleEnd(point)) groups.soleEnds.push(local)
    if (isTip(point)) groups.tip.push(local)
    if (isBall(point)) groups.ball.push(local)
    if (isForefoot(point)) groups.forefoot.push(local)
    if (isInstep(point)) groups.instep.push(local)
    if (isHull(point, source)) groups.hull.push(local)
  })

  return {
    version: 1,
    mesh: meshName,
    bones: [
      { name: 'shin', parent: null, head: [centerX, 0, heelZ] },
      { name: 'foot', parent: 'shin', head: [centerX, 0, heelZ] },
      { name: 'toes', parent: 'foot', head: [centerX, 0, ballZ] },
    ],
    vertices: { source: sampled, positions, skinBones, skinWeights },
    morphs: [],
    controls: [
      { name: 'footLength', min: 0.4, max: 2.5, channels: [{ bone: 'foot', axis: 'z', gain: 1 }] },
      { name: 'toeLength', min: 0.4, max: 2.5, channels: [{ bone: 'toes', axis: 'z', gain: 1 }] },
      { name: 'width', min: 0.4, max: 2.5, channels: [{ bone: 'foot', axis: 'x', gain: 1 }] },
      { name: 'thickness', min: 0.3, max: 2.5, channels: [{ bone: 'foot', axis: 'y', gain: 1 }] },
    ],
    groups,
    measures: [
      { name: 'length', kind: 'extent', group: 'soleEnds', axis: 'z' },
      { name: 'toeLength', kind: 'between', from: 'ball', to: 'tip', axis: 'z' },
      { name: 'ballWidth', kind: 'extent', group: 'forefoot', axis: 'x' },
      { name: 'instepHeight', kind: 'max', group: 'instep', axis: 'y' },
    ],
    hull: 'hull',
  }
}
