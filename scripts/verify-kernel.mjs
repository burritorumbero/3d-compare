// Proves the WebAssembly kernel on real foot geometry: across the full range of
// foot shapes the solved rig measures what was asked within 0.1 mm, soles stay
// on the floor, the shin is untouched, and three.js skinning with the kernel's
// bone scales reproduces the kernel's measurements (so the GPU draws what the
// kernel measured).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { footDimensionRange } from '../src/domain/foot-shape.ts'
import { assertFootRig, footTargets, solveFoot } from '../src/kernel/foot.ts'
import { RigSolver, loadKernel } from '../src/kernel/index.ts'
import { readGlb } from './glb.mjs'
import { proceduralFootRig } from './procedural-foot-rig.mjs'

const MAX_ERROR_MM = 0.1
await loadKernel(readFileSync(fileURLToPath(new URL('../src/kernel/pkg/kernel_bg.wasm', import.meta.url))))

/** Deforms the rig's vertices the way three.js skinning does on the GPU. */
function skinWithThree(rig, pose) {
  const bones = rig.bones.map(() => new THREE.Bone())
  rig.bones.forEach((spec, index) => {
    const parentIndex = rig.bones.findIndex((candidate) => candidate.name === spec.parent)
    const parentHead = parentIndex === -1 ? [0, 0, 0] : rig.bones[parentIndex].head
    bones[index].position.set(spec.head[0] - parentHead[0], spec.head[1] - parentHead[1], spec.head[2] - parentHead[2])
    if (parentIndex !== -1) {
      bones[parentIndex].add(bones[index])
    }
  })
  bones[0].updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(bones)
  skeleton.calculateInverses()
  pose.boneScales.forEach((scale, index) => bones[index].scale.set(...scale))
  bones[0].updateMatrixWorld(true)
  const skin = bones.map((bone, index) => new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[index]))

  const { positions, skinBones, skinWeights } = rig.vertices
  return Array.from({ length: positions.length / 3 }, (_, vertex) => {
    const rest = new THREE.Vector3().fromArray(positions, vertex * 3)
    const out = new THREE.Vector3()
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = skinWeights[vertex * 4 + slot]
      if (weight > 0) {
        out.addScaledVector(rest.clone().applyMatrix4(skin[skinBones[vertex * 4 + slot]]), weight)
      }
    }
    return out
  })
}

function measureWithThree(rig, points) {
  const axis = { x: 'x', y: 'y', z: 'z' }
  const values = (group, a) => rig.groups[group].map((vertex) => points[vertex][axis[a]])
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length
  return Object.fromEntries(
    rig.measures.map((measure) => {
      if (measure.kind === 'between') {
        return [measure.name, Math.abs(mean(values(measure.to, measure.axis)) - mean(values(measure.from, measure.axis)))]
      }
      const list = values(measure.group, measure.axis)
      return [measure.name, measure.kind === 'max' ? Math.max(...list) : Math.max(...list) - Math.min(...list)]
    }),
  )
}

let solves = 0
let worst = 0
let elapsed = 0
for (const entry of FEET_CATALOG) {
  const glb = readGlb(fileURLToPath(new URL(`../public/models/${entry.model.file}`, import.meta.url)))
  const rig = proceduralFootRig(glb, 'LeftFootAndShin')
  const solver = new RigSolver(rig)
  assertFootRig(solver)

  const rest = solver.evaluate()
  assert.ok(
    Math.abs(rest.measures.length * 1000 - entry.referenceFootLengthMm) <= 2,
    `${entry.id}: rest length ${(rest.measures.length * 1000).toFixed(1)} mm matches the catalog`,
  )
  const restTop = rest.bounds.max[1]

  for (let lengthMm = 200; lengthMm <= 380; lengthMm += 30) {
    for (const toe of [0.19, 0.26, 0.33]) {
      for (const width of [0.31, 0.376, 0.47]) {
        for (const instep of [0.19, 0.25, 0.33]) {
          const shape = {
            lengthMm,
            toeLengthMm: Math.round(lengthMm * toe),
            ballWidthMm: Math.round(lengthMm * width),
            instepHeightMm: Math.round(lengthMm * instep),
            locked: [],
          }
          for (const dimension of ['ballWidth', 'instepHeight']) {
            const range = footDimensionRange(dimension, lengthMm)
            const value = dimension === 'ballWidth' ? shape.ballWidthMm : shape.instepHeightMm
            assert.ok(value >= range.min - 0.5 && value <= range.max + 0.5, 'grid stays inside the domain limits')
          }

          const started = performance.now()
          const solution = solveFoot(solver, shape)
          elapsed += performance.now() - started
          solves += 1
          worst = Math.max(worst, solution.maxErrorMm)
          const label = `${entry.id} ${lengthMm} mm, toe ${toe}, width ${width}, instep ${instep}`
          assert.ok(solution.maxErrorMm <= MAX_ERROR_MM, `${label}: off by ${solution.maxErrorMm.toFixed(3)} mm`)
          // The authored soles rest 1 mm up; vertical scaling about the floor keeps them there or closer.
          assert.ok(
            solution.bounds.min[1] >= -1e-9 && solution.bounds.min[1] <= rest.bounds.min[1] * solution.controls.thickness + 1e-6,
            `${label}: sole stays on the floor (lowest point ${(solution.bounds.min[1] * 1000).toFixed(2)} mm)`,
          )
          assert.ok(Math.abs(solution.bounds.max[1] - restTop) < 0.0005, `${label}: shin top is unchanged`)
          for (const value of [...solution.bounds.min, ...solution.bounds.max]) {
            assert.ok(Number.isFinite(value), `${label}: bounds are finite`)
          }

          // A slider drag warm-starts from the last solution and converges in a step or two.
          const nudged = { ...shape, ballWidthMm: shape.ballWidthMm + 1 }
          const warm = solveFoot(solver, nudged, { initial: solution.controls })
          assert.ok(warm.maxErrorMm <= MAX_ERROR_MM && warm.iterations <= 3, `${label}: warm start converges quickly`)
        }
      }
    }
  }

  // The GPU path: three.js bones scaled by the kernel's pose measure the same.
  const sample = { lengthMm: 310, toeLengthMm: 95, ballWidthMm: 128, instepHeightMm: 70, locked: [] }
  const solution = solveFoot(solver, sample)
  const three = measureWithThree(rig, skinWithThree(rig, solver.pose(solution.controls)))
  for (const [name, target] of Object.entries(footTargets(sample))) {
    assert.ok(
      Math.abs(three[name] - target) < 0.0001,
      `${entry.id}: three.js skinning measures ${name} ${(three[name] * 1000).toFixed(2)} mm, wanted ${(target * 1000).toFixed(2)} mm`,
    )
  }

  // Bad input is refused rather than producing garbage.
  assert.throws(() => solver.solve({ heelHeight: 0.1 }), /no measure named heelHeight/)
  assert.throws(() => solver.solve({ length: Number.POSITIVE_INFINITY }), /finite/)
  solver.dispose()
}

console.log(
  `Kernel verification passed: ${solves} foot solves, worst error ${worst.toFixed(4)} mm, ` +
    `${(elapsed / solves).toFixed(2)} ms per solve, three.js skinning agrees.`,
)
