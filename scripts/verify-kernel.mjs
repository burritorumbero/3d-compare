// Proves the WebAssembly kernel on the shipped feet rigs: each rig matches its
// GLB, and across the full range of foot shapes the solved rig measures what was
// asked within 0.1 mm, soles stay on the floor, the lower leg grows with the foot, left and
// right feet solve alike, and three.js skinning with the kernel's bone matrices
// reproduces the kernel's measurements (so the GPU draws what the kernel measured).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { footDimensionRange, typicalFootShape, setFootDimension, resizeFoot } from '../src/domain/foot-shape.ts'
import { FOOT_SPACING_M } from '../src/domain/layout.ts'
import { shoeRows } from '../src/domain/shoe-charts.ts'
import { averageLandmarks, STATURE_TOLERANCE_MM, statureTargets } from '../src/domain/stature.ts'
import { assertFootRig, footRigTargets, solveFoot } from '../src/kernel/foot.ts'
import { feetRigFile } from './foot-rig.mjs'
import { personRigFile } from './person-rig.mjs'
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
  // Placement moves the root; applyBoneTransform still returns mesh-local
  // coordinates (bindMatrixInverse already cancels the root translation).
  foot.root.position.set(0.37, 0, -0.21)
  foot.root.updateMatrixWorld(true)
  const [mesh] = foot.meshes
  return rig.vertices.source.map((source) =>
    mesh.applyBoneTransform(source, new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), source)),
  )
}

function measureWithThree(rig, points, bones) {
  const axis = { x: 'x', y: 'y', z: 'z' }
  const values = (group, a) => rig.groups[group].map((vertex) => points[vertex][axis[a]])
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length
  return Object.fromEntries(
    rig.measures.map((measure) => {
      if (measure.kind === 'bonePath') {
        let index = rig.bones.findIndex(bone=>bone.name===measure.to)
        const end = rig.bones.findIndex(bone=>bone.name===measure.from)
        let length = 0
        while (index !== end) {
          const parent = rig.bones.findIndex(bone=>bone.name===rig.bones[index].parent)
          length += bones[index].getWorldPosition(new THREE.Vector3()).distanceTo(bones[parent].getWorldPosition(new THREE.Vector3()))
          index = parent
        }
        return [measure.name, length]
      }
      if (measure.kind === 'distance') {
        const center = group => new THREE.Vector3(...['x','y','z'].map(a=>mean(values(group,a))))
        return [measure.name, center(measure.from).distanceTo(center(measure.to))]
      }
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
  assert.deepEqual(rigFile, JSON.parse(JSON.stringify(feetRigFile(glb))), `${entry.id}: shipped rigs match the asset generator`)
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
            solution.bounds.min[1] >= -1e-9 && solution.bounds.min[1] <= rest.bounds.min[1] * solution.controls.lowerLegScale * solution.controls.thickness + 1e-6,
            `${label}: sole stays on the floor (lowest point ${(solution.bounds.min[1] * 1000).toFixed(2)} mm)`,
          )
          const pairWidth = (solution.bounds.max[0] - solution.bounds.min[0]) * 2 + 0.05
          assert.ok(pairWidth < FOOT_SPACING_M, `${label}: the complete pair fits its table column`)
          const legGrowth = (shape.lengthMm - shape.toeLengthMm) / (1000 * (rest.measures.length - rest.measures.toeLength))
          assert.ok(Math.abs(solution.bounds.max[1] - restTop * legGrowth) < 0.0001, `${label}: lower leg grows with heel-to-ball length`)
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
  for (const [name, target] of Object.entries(footRigTargets(solver, sample))) {
    assert.ok(
      Math.abs(three[name] - target) < 0.0001,
      `${entry.id}: the app's skinned foot measures ${name} ${(three[name] * 1000).toFixed(2)} mm, wanted ${(target * 1000).toFixed(2)} mm`,
    )
  }

  // Every offered shoe size goes through the real skinning path on BOTH feet.
  // In particular, US 20 used to stretch away from a completely static ankle.
  for (const system of ['US', 'EU']) {
    for (const row of shoeRows(system, entry.sex)) {
      const shape = typicalFootShape(entry.sex, row.mm)
      const solved = solveFoot(solver, shape)
      for (const footSolver of [solver, mirror]) {
        const footRig = footSolver.rig
        const points = skinWithApp(glb, footRig, footSolver.pose(solved.controls))
        const measured = measureWithThree(footRig, points)
        for (const [name, target] of Object.entries(footRigTargets(footSolver, shape))) {
          assert.ok(Math.abs(measured[name] - target) < 0.0001, `${entry.id} ${system} ${row.size} ${footRig.mesh}: skinned ${name} matches target`)
        }
        // Check the whole pure-shin region, not just its top: it must move in
        // depth and grow in girth as well as height, retaining its own shape.
        const head = footRig.bones[0].head
        const restFoot = footSolver.evaluate().measures
        const growth = (shape.lengthMm - shape.toeLengthMm) / (1000 * (restFoot.length - restFoot.toeLength))
        footRig.vertices.source.forEach((_, local) => {
          if (footRig.vertices.skinWeights[local * 4] < 0.99999) return
          for (let axis = 0; axis < 3; axis += 1) {
            const authored = footRig.vertices.positions[local * 3 + axis]
            const expected = head[axis] + (authored - head[axis]) * growth
            assert.ok(Math.abs(points[local].getComponent(axis) - expected) < 0.0001, `${entry.id} ${system} ${row.size}: shin preserves proportions on axis ${axis}: ${points[local].getComponent(axis)} vs ${expected}`)
          }
        })
      }
    }
  }

  // Shape-only edits must not turn toe length / width / instep into a leg-size
  // control. Shoe resizing still grows the leg when a foot dimension is locked.
  const base = typicalFootShape(entry.sex, 270)
  const baseLegHeight = solveFoot(solver, base).measures.lowerLegHeight
  for (const [dimension, mm] of [['toeLength', base.toeLengthMm + 10], ['ballWidth', 110], ['instepHeight', 75]]) {
    const edited = setFootDimension(base, entry.sex, dimension, mm)
    assert.ok(edited.ok)
    assert.ok(Math.abs(solveFoot(solver, edited.value).measures.lowerLegHeight - baseLegHeight) < 0.0001, `${dimension}: lower leg stays unchanged`)
    const resized = resizeFoot(edited.value, entry.sex, 344)
    assert.ok(resized.ok)
    const enlarged = solveFoot(solver, resized.value)
    assert.ok(enlarged.maxErrorMm < MAX_ERROR_MM)
    assert.ok(enlarged.measures.lowerLegHeight > baseLegHeight * 1.2, `${dimension}: locked dimension permits proportional shoe resizing`)
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
  pose.boneMatrices.forEach((matrix, index) => {
    bones[index].matrixAutoUpdate = false
    bones[index].matrix.fromArray(matrix)
    bones[index].matrixWorldNeedsUpdate = true
  })
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
// solves to the stature targets within 0.1 mm with soles on the floor, and the
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
  assert.deepEqual(rigFile, JSON.parse(JSON.stringify(personRigFile(model))), `${entry.id}: shipped rig matches the generator`)
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
    const solution = solver.solve(Object.fromEntries(Object.entries(targets).map(([name, mm]) => [name, mm / 1000])), { tolerance: STATURE_TOLERANCE_MM / 1000 })
    peopleSolves += 1
    const errorMm = solution.maxError * 1000
    peopleWorst = Math.max(peopleWorst, errorMm)
    assert.ok(errorMm <= STATURE_TOLERANCE_MM, `${entry.id} at ${stature} mm: off by ${errorMm.toFixed(3)} mm`)
    assert.ok(solution.bounds.min[1] > -0.0005, `${entry.id} at ${stature} mm: nothing sinks below the floor (${(solution.bounds.min[1] * 1000).toFixed(1)} mm)`)
    assert.ok(Math.abs(solution.measures.stature * 1000 - stature) < MAX_ERROR_MM, `${entry.id} at ${stature} mm: stature lands exactly`)
  }

  // Exercise real body, eyes, hair and clothing through the app's skinning at
  // both extremes and at rest. Head-attached geometry must grow in all axes,
  // not merely move upward with the neck while retaining its original size.
  const source = new THREE.Group()
  for (const name of model.meshNames) {
    const data = meshData(name)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions.flat(), 3))
    geometry.setAttribute('_skin_index', new THREE.Float32BufferAttribute(data.indices.flat(), 4))
    geometry.setAttribute('_skin_weight', new THREE.Float32BufferAttribute(data.weights.flat(), 4))
    const node = new THREE.Mesh(geometry)
    node.name = name
    source.add(node)
  }
  const person = rigNode(source, rig)
  const body = person.meshes.find((mesh) => mesh.name === 'Body')
  const headBone = rig.bones.findIndex((bone) => bone.name === 'head')
  const samples = person.meshes.map((mesh) => {
    const positions = mesh.geometry.getAttribute('position')
    const indices = mesh.geometry.getAttribute('skinIndex')
    const weights = mesh.geometry.getAttribute('skinWeight')
    const vertices = []
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      if (indices.getX(vertex) === headBone && weights.getX(vertex) > .9999) vertices.push(vertex)
    }
    const bounds = new THREE.Box3().setFromPoints(vertices.map((vertex) => new THREE.Vector3().fromBufferAttribute(positions, vertex)))
    return { mesh, vertices, restSize: bounds.getSize(new THREE.Vector3()) }
  }).filter((sample) => sample.vertices.length > 10)
  assert.ok(samples.length >= 3, `${entry.id}: body and head attachments are covered`)
  let previousControls
  for (const height of [900, authored.stature, 2000, 2400, 3048, 2400, authored.stature]) {
    const targets = statureTargets(entry.sex, authored, height)
    const solution = solver.solve(Object.fromEntries(Object.entries(targets).map(([name, mm]) => [name, mm / 1000])), { tolerance: STATURE_TOLERANCE_MM / 1000 })
    const warm = solver.solve(Object.fromEntries(Object.entries(targets).map(([name, mm]) => [name, mm / 1000])), { initial: previousControls, tolerance: STATURE_TOLERANCE_MM / 1000 })
    previousControls = warm.controls
    assert.ok(warm.maxError * 1000 <= STATURE_TOLERANCE_MM, `${entry.id}: warm solve matches all dimensions at ${height}`)
    for (const name of solver.controlNames) assert.ok(Math.abs(warm.controls[name]-solution.controls[name]) < .003, `${entry.id}: edit order does not change ${name}`)
    applyPose(person, solver.pose(solution.controls))
    person.root.updateMatrixWorld(true)
    const points = rig.vertices.source.map((vertex, local) => rig.vertices.sourceMeshes[local] === 'Body'
      ? body.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(body.geometry.getAttribute('position'), vertex))
      : new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN))
    const actual = measureWithThree(rig, points, person.bones)
    for (const [name, target] of Object.entries(targets)) {
      assert.ok(Math.abs(actual[name] * 1000 - target) < MAX_ERROR_MM, `${entry.id} at ${height}: app ${name} matches target`)
    }
    const growth = targets.headWidth / authored.headWidth
    for (const { mesh, vertices, restSize } of samples) {
      const bounds = new THREE.Box3().setFromPoints(vertices.map((vertex) => mesh.applyBoneTransform(vertex, new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), vertex))))
      const size = bounds.getSize(new THREE.Vector3())
      for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(size[axis] - restSize[axis] * growth) < .0001, `${entry.id} ${mesh.name}: head ${axis} grows with stature at ${height}`)
    }
    const shoulderGrowth = actual.biacromialBreadth * 1000 / authored.biacromialBreadth
    const headGrowth = actual.headWidth * 1000 / authored.headWidth
    assert.ok(headGrowth / shoulderGrowth > .94 && headGrowth / shoulderGrowth < 1.07, `${entry.id}: head stays balanced against shoulders at ${height}`)
    assert.ok(headGrowth / (height/authored.stature) > .82 && headGrowth / (height/authored.stature) < 1.25, `${entry.id}: head avoids both extreme size policies`)
    const handGrowth = actual.handWidth * 1000 / authored.handWidth
    assert.ok(handGrowth/shoulderGrowth > .92 && handGrowth/shoulderGrowth < 1.1, `${entry.id}: hands retain their scale relative to the body`)
    const bodyPositions = body.geometry.getAttribute('position')
    const bodyIndices = body.geometry.getAttribute('skinIndex')
    const bodyWeights = body.geometry.getAttribute('skinWeight')
    for (const name of ['arm.L','arm.R','forearm.L','forearm.R']) {
      const index = rig.bones.findIndex(bone=>bone.name===name)
      const basis = rig.bones[index].basis
      // Project actual pure-limb geometry perpendicular to its anatomical axis.
      // An XYZ length control fails this independent silhouette constraint.
      for (const offset of [0,6]) {
        const radial = new THREE.Vector3(...basis.slice(offset,offset+3))
        const restSpan = [], posedSpan = []
        for (let vertex=0; vertex<bodyPositions.count; vertex++) {
          if (bodyIndices.getX(vertex)!==index || bodyWeights.getX(vertex)<.9999) continue
          const point = new THREE.Vector3().fromBufferAttribute(bodyPositions,vertex)
          restSpan.push(point.dot(radial))
          posedSpan.push(body.applyBoneTransform(vertex,point).dot(radial))
        }
        assert.ok(restSpan.length>20, `${entry.id} ${name}: enough surface samples`)
        const widthGrowth = (Math.max(...posedSpan)-Math.min(...posedSpan))/(Math.max(...restSpan)-Math.min(...restSpan))
        assert.ok(widthGrowth/shoulderGrowth>.96 && widthGrowth/shoulderGrowth<1.04, `${entry.id} ${name}: transverse size stays balanced at ${height}, ratio ${widthGrowth/shoulderGrowth}`)
      }
    }
  }
  for (const mesh of person.meshes) mesh.geometry.dispose()
  solver.dispose()
}

console.log(
  `Kernel verification passed: shipped rigs match their GLBs, ${solves} foot solves (left and right agree), worst error ${worst.toFixed(4)} mm, ` +
    `${(elapsed / solves).toFixed(2)} ms per solve, the app's three.js skinning agrees; ` +
    `${bodySolves} body-column stature solves (0.9 to 3.05 m), worst error ${bodyWorst.toFixed(4)} mm, three.js bones agree; ` +
    `${peopleSolves} solves on the shipped people, worst error ${peopleWorst.toFixed(4)} mm, the app's body, head and attachments agree at minimum, authored height and 10 ft.`,
)
