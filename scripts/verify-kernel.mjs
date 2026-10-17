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
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { footDimensionRange } from '../src/domain/foot-shape.ts'
import { averageLandmarks, statureTargets } from '../src/domain/stature.ts'
import { assertFootRig, footTargets, solveFoot } from '../src/kernel/foot.ts'
import { RigSolver, loadKernel } from '../src/kernel/index.ts'
import { applyPose, rigNode } from '../src/scene/rigged.ts'
import { meshAttribute, meshPositions, readGlb } from './glb.mjs'
import { readModel } from './model-io.mjs'

const MAX_ERROR_MM = 0.1
await loadKernel(readFileSync(fileURLToPath(new URL('../src/kernel/pkg/kernel_bg.wasm', import.meta.url))))

/**
 * Deforms the rig's sample vertices with the app's own skinning code: the foot
 * is rigged and posed by src/scene/rigged.ts and each vertex goes
 * through three.js SkinnedMesh.applyBoneTransform, the CPU twin of the shader.
 */
function skinWithApp(glb, rig, pose) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(meshPositions(glb, rig.mesh).flat(), 3))
  geometry.setAttribute('_deform_weights', new THREE.Float32BufferAttribute(meshAttribute(glb, rig.mesh, '_DEFORM_WEIGHTS').flat(), 3))
  const node = new THREE.Mesh(geometry)
  node.name = rig.mesh
  const foot = rigNode(node, rig)
  applyPose(foot, pose)
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

// Body column: segments stacked from the floor, each moving with the one below
// without inheriting its scale, solved to ANSUR stature targets from 0.9 to
// 3.05 m. Then three.js bones, given the kernel's local scales, must land every
// landmark where the kernel put it.
function bodyColumnRig(sex) {
  const authored = averageLandmarks(sex, 1700)
  const m = (value) => value / 1000
  const segments = [
    ['foot', 0, 'ankle'],
    ['shin', authored.ankle, 'knee'],
    ['thigh', authored.knee, 'crotch'],
    ['pelvis', authored.crotch, 'shoulder'],
    ['chest', authored.shoulder, 'neck'],
    ['neck', authored.neck, 'ear'],
    ['head', authored.ear, 'stature'],
  ]
  const bones = [{ name: 'root', parent: null, head: [0, 0, 0] }]
  segments.forEach(([name, base], index) =>
    bones.push({ name, parent: index === 0 ? 'root' : segments[index - 1][0], head: [0, m(base), 0], inheritScale: false }),
  )
  const positions = []
  const skinBones = []
  const groups = {}
  const vertex = (bone, point) => {
    positions.push(...point)
    skinBones.push(bones.findIndex((candidate) => candidate.name === bone), 0, 0, 0)
    return positions.length / 3 - 1
  }
  for (const [name, , landmark] of segments) {
    groups[landmark] = [vertex(name, [0, m(authored[landmark]), 0])]
  }
  // Breadths: shoulder points on the chest's base, hip points on the pelvis.
  groups.shoulders = [-1, 1].map((side) => vertex('chest', [(side * m(authored.biacromialBreadth)) / 2, m(authored.shoulder), 0]))
  groups.hips = [-1, 1].map((side) => vertex('pelvis', [(side * m(authored.hipBreadth)) / 2, m(authored.crotch + 60), 0]))
  const count = positions.length / 3
  groups.all = Array.from({ length: count }, (_, index) => index)
  return {
    authored,
    rig: {
      version: 1,
      mesh: 'Body',
      bones,
      vertices: {
        source: Array.from({ length: count }, (_, index) => index),
        positions,
        skinBones,
        skinWeights: Array.from({ length: count }, () => [1, 0, 0, 0]).flat(),
      },
      morphs: [],
      controls: [
        ...segments.map(([name, , landmark]) => ({ name: landmark, min: 0.3, max: 2.5, channels: [{ bone: name, axis: 'y', gain: 1 }] })),
        { name: 'shoulderWidth', min: 0.3, max: 2.5, channels: [{ bone: 'chest', axis: 'x', gain: 1 }] },
        { name: 'hipWidth', min: 0.3, max: 2.5, channels: [{ bone: 'pelvis', axis: 'x', gain: 1 }] },
      ],
      groups,
      measures: [
        ...segments.map(([, , landmark]) => ({ name: landmark, kind: 'max', group: landmark, axis: 'y' })),
        { name: 'biacromialBreadth', kind: 'extent', group: 'shoulders', axis: 'x' },
        { name: 'hipBreadth', kind: 'extent', group: 'hips', axis: 'x' },
      ],
      hull: 'all',
    },
  }
}

function skinWithBones(rig, pose) {
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
  pose.boneScales.forEach((scale, index) => bones[index].scale.set(...scale))
  bones[0].updateMatrixWorld(true)
  return Array.from({ length: rig.vertices.positions.length / 3 }, (_, vertex) => {
    const bone = rig.vertices.skinBones[vertex * 4]
    const skin = new THREE.Matrix4().multiplyMatrices(bones[bone].matrixWorld, skeleton.boneInverses[bone])
    return new THREE.Vector3().fromArray(rig.vertices.positions, vertex * 3).applyMatrix4(skin)
  })
}

let bodySolves = 0
let bodyWorst = 0
for (const sex of ['female', 'male']) {
  const { authored, rig } = bodyColumnRig(sex)
  const solver = new RigSolver(rig)
  for (let stature = 900; stature <= 3048; stature += 71) {
    const targets = statureTargets(sex, authored, stature)
    const wanted = Object.fromEntries(solver.measureNames.map((name) => [name, targets[name] / 1000]))
    const solution = solver.solve(wanted)
    bodySolves += 1
    const errorMm = solution.maxError * 1000
    bodyWorst = Math.max(bodyWorst, errorMm)
    assert.ok(errorMm <= MAX_ERROR_MM, `${sex} body at ${stature} mm: off by ${errorMm.toFixed(3)} mm`)
    const three = measureWithThree(rig, skinWithBones(rig, solver.pose(solution.controls)))
    for (const [name, target] of Object.entries(wanted)) {
      assert.ok(Math.abs(three[name] - target) < 0.0001, `${sex} body at ${stature} mm: three.js puts ${name} at ${(three[name] * 1000).toFixed(2)} mm, wanted ${(target * 1000).toFixed(2)} mm`)
    }
  }
  solver.dispose()
}

// Shipped people: each rig matches its GLB, every stature from 0.9 to 3.05 m
// solves to the ANSUR targets within 0.1 mm with soles on the floor, and the
// app's own skinning (rigNode + applyPose) puts every landmark where the kernel did.
let peopleSolves = 0
let peopleWorst = 0
for (const entry of HUMAN_CATALOG) {
  const path = fileURLToPath(new URL(`../public/models/${entry.model.file}`, import.meta.url))
  const model = await readModel(path)
  const rigFile = JSON.parse(readFileSync(path.replace(/\.glb$/, '.rig.json'), 'utf8'))
  assert.equal(rigFile.version, 1)
  assert.equal(rigFile.rigs.length, 1)
  const rig = rigFile.rigs[0]
  const meshCache = new Map()
  const meshData = (name) => {
    if (!meshCache.has(name)) {
      meshCache.set(name, { positions: model.positions(name), weights: model.attribute(name, '_SKIN_WEIGHT'), indices: model.attribute(name, '_SKIN_INDEX') })
    }
    return meshCache.get(name)
  }
  rig.vertices.source.forEach((source, local) => {
    const data = meshData(rig.vertices.sourceMeshes[local])
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(data.positions[source][axis] - rig.vertices.positions[local * 3 + axis]) < 2e-6, `${entry.id} rig vertex ${local} matches the GLB`)
    }
    const total = rig.vertices.skinWeights.slice(local * 4, local * 4 + 4).reduce((sum, value) => sum + value, 0)
    assert.ok(Math.abs(total - 1) < 1e-5, `${entry.id} rig vertex ${local} weights sum to 1`)
  })

  const solver = new RigSolver(rig)
  const rest = solver.evaluate()
  const authored = Object.fromEntries(Object.entries(rest.measures).map(([name, value]) => [name, value * 1000]))
  assert.ok(Math.abs(authored.stature - entry.referenceHeightMm) <= 3, `${entry.id}: rig stature matches the catalog`)
  for (let stature = 900; stature <= 3048; stature += 113) {
    const targets = statureTargets(entry.sex, authored, stature)
    const solution = solver.solve(Object.fromEntries(Object.entries(targets).map(([name, mm]) => [name, mm / 1000])))
    peopleSolves += 1
    const errorMm = solution.maxError * 1000
    peopleWorst = Math.max(peopleWorst, errorMm)
    assert.ok(errorMm <= MAX_ERROR_MM, `${entry.id} at ${stature} mm: off by ${errorMm.toFixed(3)} mm`)
    assert.ok(solution.bounds.min[1] > -0.0005, `${entry.id} at ${stature} mm: nothing sinks below the floor (${(solution.bounds.min[1] * 1000).toFixed(1)} mm)`)
    assert.ok(Math.abs(solution.measures.stature * 1000 - stature) < MAX_ERROR_MM, `${entry.id} at ${stature} mm: stature lands exactly`)
  }

  // The app path: skin the body with rigNode at 10 ft and measure its landmarks.
  const body = meshData('Body')
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(body.positions.flat(), 3))
  geometry.setAttribute('_skin_index', new THREE.Float32BufferAttribute(body.indices.flat(), 4))
  geometry.setAttribute('_skin_weight', new THREE.Float32BufferAttribute(body.weights.flat(), 4))
  const node = new THREE.Mesh(geometry)
  node.name = 'Body'
  const person = rigNode(node, rig)
  const tall = statureTargets(entry.sex, authored, 3048)
  const solution = solver.solve(Object.fromEntries(Object.entries(tall).map(([name, mm]) => [name, mm / 1000])))
  applyPose(person, solver.pose(solution.controls))
  person.root.updateMatrixWorld(true)
  const [skinned] = person.meshes
  const points = rig.vertices.source.map((source, local) =>
    rig.vertices.sourceMeshes[local] === 'Body'
      ? skinned.applyBoneTransform(source, new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), source))
      : new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN),
  )
  const app = measureWithThree(rig, points)
  for (const [name, target] of Object.entries(tall)) {
    assert.ok(Math.abs(app[name] * 1000 - target) < MAX_ERROR_MM, `${entry.id}: the app's skinned body puts ${name} at ${(app[name] * 1000).toFixed(2)} mm, wanted ${target.toFixed(2)} mm`)
  }
  solver.dispose()
}

console.log(
  `Kernel verification passed: shipped rigs match their GLBs, ${solves} foot solves (left and right agree), worst error ${worst.toFixed(4)} mm, ` +
    `${(elapsed / solves).toFixed(2)} ms per solve, the app's three.js skinning agrees; ` +
    `${bodySolves} body-column stature solves (0.9 to 3.05 m), worst error ${bodyWorst.toFixed(4)} mm, three.js bones agree; ` +
    `${peopleSolves} solves on the shipped people, worst error ${peopleWorst.toFixed(4)} mm, the app's skinning agrees at 10 ft.`,
)
