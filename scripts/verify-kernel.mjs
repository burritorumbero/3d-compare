// Proves the WebAssembly kernel on the shipped feet rigs: each rig matches its
// GLB, and across the full range of foot shapes the solved rig measures what was
// asked within 0.1 mm, soles stay on the floor, the shin is untouched, left and
// right feet solve alike, and three.js skinning with the kernel's bone scales
// reproduces the kernel's measurements (so the GPU draws what the kernel measured).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { footDimensionRange } from '../src/domain/foot-shape.ts'
import { assertFootRig, footTargets, solveFoot } from '../src/kernel/foot.ts'
import { RigSolver, loadKernel } from '../src/kernel/index.ts'
import { poseFoot, rigFoot } from '../src/scene/feet/rigged-foot.ts'
import { meshAttribute, meshPositions, readGlb } from './glb.mjs'

const MAX_ERROR_MM = 0.1
await loadKernel(readFileSync(fileURLToPath(new URL('../src/kernel/pkg/kernel_bg.wasm', import.meta.url))))

/**
 * Deforms the rig's sample vertices with the app's own skinning code: the foot
 * is rigged and posed by src/scene/feet/rigged-foot.ts and each vertex goes
 * through three.js SkinnedMesh.applyBoneTransform, the CPU twin of the shader.
 */
function skinWithApp(glb, rig, pose) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshPositions(glb, rig.mesh).flat(), 3))
  geometry.setAttribute('_deform_weights', new THREE.Float32BufferAttribute(meshAttribute(glb, rig.mesh, '_DEFORM_WEIGHTS').flat(), 3))
  const node = new THREE.Mesh(geometry)
  node.name = rig.mesh
  const foot = rigFoot(node, rig)
  poseFoot(foot, pose)
  // Placement moves the root; skinning must follow it exactly.
  foot.root.position.set(0.37, 0, -0.21)
  foot.root.updateMatrixWorld(true)
  const [mesh] = foot.meshes
  return rig.vertices.source.map((source) =>
    mesh.applyBoneTransform(source, new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), source)).sub(foot.root.position),
  )
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
  const rigFile = JSON.parse(
    readFileSync(fileURLToPath(new URL(`../public/models/${entry.model.file.replace(/\.glb$/, '.rig.json')}`, import.meta.url)), 'utf8'),
  )
  assert.equal(rigFile.version, 1)
  assert.deepEqual(rigFile.rigs.map((rig) => rig.mesh), ['LeftFootAndShin', 'RightFootAndShin'])
  for (const rig of rigFile.rigs) {
    // The rig samples the GLB: every sampled vertex sits where the GLB has it, with the GLB's weights.
    const positions = meshPositions(glb, rig.mesh)
    const weights = meshAttribute(glb, rig.mesh, '_DEFORM_WEIGHTS')
    rig.vertices.source.forEach((source, local) => {
      for (let axis = 0; axis < 3; axis += 1) {
        assert.ok(Math.abs(positions[source][axis] - rig.vertices.positions[local * 3 + axis]) < 2e-6, `${rig.mesh} vertex ${source} matches the GLB`)
      }
      assert.ok(Math.abs(weights[source][2] - rig.vertices.skinWeights[local * 4 + 2]) < 1e-5, `${rig.mesh} vertex ${source} toes weight matches the GLB`)
    })
    for (const vertexWeights of weights) {
      assert.ok(Math.abs(vertexWeights[0] + vertexWeights[1] + vertexWeights[2] - 1) < 1e-4, `${rig.mesh} deform weights sum to 1`)
    }
  }
  const rig = rigFile.rigs[0]
  const solver = new RigSolver(rig)
  const mirror = new RigSolver(rigFile.rigs[1])
  assertFootRig(solver)
  assertFootRig(mirror)

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

          const mirrored = solveFoot(mirror, shape)
          for (const [name, value] of Object.entries(solution.controls)) {
            assert.ok(Math.abs(mirrored.controls[name] - value) < 0.002, `${label}: right foot ${name} matches the left`)
          }

          // A slider drag warm-starts from the last solution and converges in a step or two.
          const nudged = { ...shape, ballWidthMm: shape.ballWidthMm + 1 }
          const warm = solveFoot(solver, nudged, { initial: solution.controls })
          assert.ok(warm.maxErrorMm <= MAX_ERROR_MM && warm.iterations <= 3, `${label}: warm start converges quickly`)
        }
      }
    }
  }

  // The GPU path: the app's rigged foot, posed by the kernel, measures the same.
  const sample = { lengthMm: 310, toeLengthMm: 95, ballWidthMm: 128, instepHeightMm: 70, locked: [] }
  const solution = solveFoot(solver, sample)
  const three = measureWithThree(rig, skinWithApp(glb, rig, solver.pose(solution.controls)))
  for (const [name, target] of Object.entries(footTargets(sample))) {
    assert.ok(
      Math.abs(three[name] - target) < 0.0001,
      `${entry.id}: the app's skinned foot measures ${name} ${(three[name] * 1000).toFixed(2)} mm, wanted ${(target * 1000).toFixed(2)} mm`,
    )
  }

  // Bad input is refused rather than producing garbage.
  assert.throws(() => solver.solve({ heelHeight: 0.1 }), /no measure named heelHeight/)
  assert.throws(() => solver.solve({ length: Number.POSITIVE_INFINITY }), /finite/)
  solver.dispose()
  mirror.dispose()
}

console.log(
  `Kernel verification passed: shipped rigs match their GLBs, ${solves} foot solves (left and right agree), worst error ${worst.toFixed(4)} mm, ` +
    `${(elapsed / solves).toFixed(2)} ms per solve, the app's three.js skinning agrees.`,
)
