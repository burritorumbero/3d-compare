// Proves the catalog's reference sizes against the shipped GLB files, because
// "true relative scale" depends on scaling each model from its authored size.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { bounds, meshAttribute, meshPositions, readGlb } from './glb.mjs'

const modelsDir = new URL('../public/models/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', modelsDir), 'utf8'))
const STATURE_TOLERANCE_MM = 3
const FOOT_TOLERANCE_MM = 2

function packEntry(entry) {
  const id = entry.model.file.replace(/\.glb$/, '')
  const pack = manifest.find((candidate) => candidate.id === id)
  assert.ok(pack, `${entry.model.file} is listed in manifest.json`)
  return pack
}

function openModel(entry) {
  const path = fileURLToPath(new URL(entry.model.file, modelsDir))
  const pack = packEntry(entry)
  assert.equal(statSync(path).size, pack.bytes, `${entry.model.file} matches the packed byte size`)
  assert.equal(entry.sex, pack.sex, `${entry.id} sex matches the pack`)
  assert.equal(entry.skin, pack.skin, `${entry.id} skin tone matches the pack`)
  assert.equal(entry.model.triangles, pack.triangles, `${entry.id} triangle count matches the pack`)

  const glb = readGlb(path)
  assert.deepEqual(glb.json.extensionsRequired ?? [], [], `${entry.model.file} needs no loader extensions`)
  assert.equal(glb.json.skins?.length ?? 0, 0, `${entry.model.file} is a static mesh`)
  assert.equal(glb.json.animations?.length ?? 0, 0, `${entry.model.file} has no animation`)
  const transformed = glb.json.nodes.filter((node) => node.matrix || node.translation || node.rotation || node.scale)
  assert.equal(transformed.length, 0, `${entry.model.file} bakes all transforms into vertices`)

  const whole = bounds(glb.json.meshes.flatMap((mesh) => meshPositions(glb, mesh.name)))
  assert.ok(Math.abs(whole.min[1]) < 0.005, `${entry.model.file} rests its soles on y = 0`)
  assert.ok(Math.abs(whole.min[0] + whole.max[0]) < 0.01, `${entry.model.file} is centered on x = 0`)
  assert.ok(whole.max[2] > -whole.min[2] && whole.max[2] < 0.5, `${entry.model.file} faces +Z`)
  return glb
}

for (const entry of HUMAN_CATALOG) {
  const glb = openModel(entry)
  const skullTopMm = bounds(meshPositions(glb, 'Body')).max[1] * 1000
  const all = bounds(glb.json.meshes.flatMap((mesh) => meshPositions(glb, mesh.name)))
  const widthMm = (all.max[0] - all.min[0]) * 1000
  assert.ok(
    Math.abs(widthMm - entry.footprintWidthMm) <= 3,
    `${entry.id}: A-pose width ${widthMm.toFixed(1)} mm vs catalog footprint ${entry.footprintWidthMm} mm`,
  )
  assert.ok(
    Math.abs(skullTopMm - entry.referenceHeightMm) <= STATURE_TOLERANCE_MM,
    `${entry.id}: Body mesh stature ${skullTopMm.toFixed(1)} mm vs catalog ${entry.referenceHeightMm} mm`,
  )
}

for (const entry of FEET_CATALOG) {
  const glb = openModel(entry)
  // Rigged feet: a rig file ships next to the GLB (verify:kernel proves it against the mesh).
  assert.ok(existsSync(fileURLToPath(new URL(entry.model.file.replace(/\.glb$/, '.rig.json'), modelsDir))), `${entry.model.file} has a rig file`)
  for (const meshName of ['LeftFootAndShin', 'RightFootAndShin']) {
    const weights = meshAttribute(glb, meshName, '_DEFORM_WEIGHTS')
    assert.equal(weights.length, meshPositions(glb, meshName).length, `${entry.id}: ${meshName} has deform weights on every vertex`)
    // The shin leans back past the heel, so measure the sole slab only.
    const sole = meshPositions(glb, meshName).filter((point) => point[1] < 0.03)
    const soleBounds = bounds(sole)
    const lengthMm = (soleBounds.max[2] - soleBounds.min[2]) * 1000
    assert.ok(soleBounds.max[2] > -soleBounds.min[2], `${entry.id}: ${meshName} toes point toward +Z`)
    assert.ok(
      Math.abs(lengthMm - entry.referenceFootLengthMm) <= FOOT_TOLERANCE_MM,
      `${entry.id}: ${meshName} sole length ${lengthMm.toFixed(1)} mm vs catalog ${entry.referenceFootLengthMm} mm`,
    )
  }
}

console.log(
  `Model verification passed: ${HUMAN_CATALOG.length} human and ${FEET_CATALOG.length} feet GLBs match their catalog sizes.`,
)
