// Builds the rig file for a feet GLB from the deform weights the asset pipeline
// authored (the `_DEFORM_WEIGHTS` attribute: shin, foot, toes per vertex, derived
// from Genesis 9's bone weights by tools/assets/build_feet.py).
//
// Bones follow the rig contract (identity rest rotation, heads on the floor):
//   shin   root at the heel; grows the ankle and lower leg with heel-to-ball length
//   foot   child of shin at the heel; length, width, and thickness of the foot
//   toes   child of foot at the ball line, where the toes weight crosses 0.5
// The rig samples only the vertices its measures and hull need; `source` maps
// each back to its index in the GLB mesh (primitives concatenated in order).
import { bounds, meshAttribute, meshPositions } from './glb.mjs'

export const FOOT_MESHES = ['LeftFootAndShin', 'RightFootAndShin']
const DECIMALS = 1e6

function round(value) {
  return Math.round(value * DECIMALS) / DECIMALS
}

/** Forward position on the sole where the toes weight crosses one half. */
function ballLine(sole) {
  const sorted = [...sole].sort((a, b) => a.point[2] - b.point[2])
  const bins = new Map()
  for (const { point, weights } of sorted) {
    const bin = Math.round(point[2] * 500)
    const entry = bins.get(bin) ?? { z: 0, toes: 0, count: 0 }
    entry.z += point[2]
    entry.toes += weights[2]
    entry.count += 1
    bins.set(bin, entry)
  }
  const profile = [...bins.values()].map((entry) => ({ z: entry.z / entry.count, toes: entry.toes / entry.count }))
  for (let index = 1; index < profile.length; index += 1) {
    const [a, b] = [profile[index - 1], profile[index]]
    if (a.toes < 0.5 && b.toes >= 0.5) {
      return a.z + ((0.5 - a.toes) / (b.toes - a.toes)) * (b.z - a.z)
    }
  }
  throw new Error('The toes weight never crosses 0.5 along the sole.')
}

export function footRig(glb, meshName) {
  const all = meshPositions(glb, meshName)
  const weights = meshAttribute(glb, meshName, '_DEFORM_WEIGHTS')
  const isSole = (p) => p[1] < 0.03
  const soleAll = all.map((point, index) => ({ point, weights: weights[index] })).filter(({ point }) => isSole(point))
  const sole = bounds(soleAll.map(({ point }) => point))
  const heelZ = sole.min[2]
  const tipZ = sole.max[2]
  const length = tipZ - heelZ
  const ballZ = ballLine(soleAll)
  const midZ = heelZ + length / 2
  const centerX = (sole.min[0] + sole.max[0]) / 2
  const shinTop = Math.max(...all.map((point) => point[1]))

  // Only the ends of the sole can set its length; the ball line marks toe length.
  const isSoleEnd = (p) => isSole(p) && (p[2] < heelZ + 0.015 || p[2] > tipZ - 0.015)
  const isTip = (p) => isSole(p) && p[2] > tipZ - 0.003
  const isBall = (p) => isSole(p) && Math.abs(p[2] - ballZ) < 0.004
  const isForefoot = (p) => p[1] < 0.05 && Math.abs(p[2] - ballZ) < 0.008
  const isInstep = (p, w) => Math.abs(p[2] - midZ) < 0.004 && w[0] < 0.5
  const isHull = (p, index) => index % 24 === 0 || isSoleEnd(p)

  const groups = { soleEnds: [], tip: [], ball: [], forefoot: [], instep: [], shinTop: [], hull: [] }
  const source = []
  const positions = []
  const skinBones = []
  const skinWeights = []
  all.forEach((point, index) => {
    const w = weights[index]
    const membership = {
      soleEnds: isSoleEnd(point),
      tip: isTip(point),
      ball: isBall(point),
      forefoot: isForefoot(point),
      instep: isInstep(point, w),
      shinTop: point[1] > shinTop - 0.001 && w[0] > 0.999,
      hull: isHull(point, index),
    }
    if (!Object.values(membership).some(Boolean)) {
      return
    }

    const local = source.length
    source.push(index)
    positions.push(...point.map(round))
    const total = w[0] + w[1] + w[2]
    skinBones.push(0, 1, 2, 0)
    skinWeights.push(round(w[0] / total), round(w[1] / total), round(1 - round(w[0] / total) - round(w[1] / total)), 0)
    for (const [group, member] of Object.entries(membership)) {
      if (member) {
        groups[group].push(local)
      }
    }
  })

  for (const [group, members] of Object.entries(groups)) {
    if (members.length === 0) {
      throw new Error(`${meshName}: rig group ${group} is empty.`)
    }
  }

  return {
    version: 1,
    mesh: meshName,
    bones: [
      { name: 'shin', parent: null, head: [round(centerX), 0, round(heelZ)] },
      { name: 'foot', parent: 'shin', head: [round(centerX), 0, round(heelZ)] },
      { name: 'toes', parent: 'foot', head: [round(centerX), 0, round(ballZ)] },
    ],
    vertices: { source, positions, skinBones, skinWeights },
    morphs: [],
    controls: [
      // A common scale preserves the Achilles/ankle transition at every shoe
      // size. The four foot controls remain local adjustments within it.
      { name: 'lowerLegScale', min: 0.5, max: 2.5, channels: ['x', 'y', 'z'].map((axis) => ({ bone: 'shin', axis, gain: 1 })) },
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
      { name: 'lowerLegHeight', kind: 'max', group: 'shinTop', axis: 'y' },
    ],
    hull: 'hull',
  }
}

/** The rig file shipped next to a feet GLB: one rig per foot. */
export function feetRigFile(glb) {
  return { version: 1, rigs: FOOT_MESHES.map((meshName) => footRig(glb, meshName)) }
}
