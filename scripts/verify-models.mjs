// Proves the catalog's reference sizes against the shipped GLB files, because
// "true relative scale" depends on scaling each model from its authored size.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { defaultFootSkinTone, FOOT_SKIN_TONES } from '../src/domain/foot-skin.ts'
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { applyFootSkinTone } from '../src/scene/feet/skin-materials.ts'
import { bounds } from './glb.mjs'
import { readModel } from './model-io.mjs'

const modelsDir = new URL('../public/models/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', modelsDir), 'utf8'))
const STATURE_TOLERANCE_MM = 3
const FOOT_TOLERANCE_MM = 2
// Web delivery extensions the app's loader decodes (meshopt geometry, WebP textures).
const ALLOWED_EXTENSIONS = new Set(['EXT_meshopt_compression', 'EXT_texture_webp'])

function packEntry(entry) {
  const id = entry.model.file.replace(/\.glb$/, '')
  const pack = manifest.find((candidate) => candidate.id === id)
  assert.ok(pack, `${entry.model.file} is listed in manifest.json`)
  return pack
}

async function openModel(entry) {
  const path = fileURLToPath(new URL(entry.model.file, modelsDir))
  const pack = packEntry(entry)
  assert.equal(statSync(path).size, pack.bytes, `${entry.model.file} matches the packed byte size`)
  assert.equal(entry.sex, pack.sex, `${entry.id} sex matches the pack`)
  assert.equal(entry.skin, pack.skin, `${entry.id} skin tone matches the pack`)
  assert.equal(entry.model.triangles, pack.triangles, `${entry.id} triangle count matches the pack`)

  const model = await readModel(path)
  for (const extension of model.extensionsRequired) {
    assert.ok(ALLOWED_EXTENSIONS.has(extension), `${entry.model.file} requires only extensions the app decodes, not ${extension}`)
  }
  assert.equal(model.hasSkins, false, `${entry.model.file} carries no skin: the app builds bones from the rig file`)
  assert.equal(model.hasAnimations, false, `${entry.model.file} has no animation`)
  assert.equal(model.transformedNodes.length, 0, `${entry.model.file} bakes all transforms into vertices`)
  assert.equal(model.triangles, pack.triangles, `${entry.model.file} triangle count matches the pack`)
  // Rigged models ship a rig file next to the GLB (verify:kernel proves it against the mesh).
  assert.ok(existsSync(path.replace(/\.glb$/, '.rig.json')), `${entry.model.file} has a rig file`)

  const whole = bounds(model.meshNames.flatMap((name) => model.positions(name)))
  assert.ok(Math.abs(whole.min[1]) < 0.005, `${entry.model.file} rests its soles on y = 0`)
  assert.ok(Math.abs(whole.min[0] + whole.max[0]) < 0.01, `${entry.model.file} is centered on x = 0`)
  // Facing: along the floor the toes reach further forward than the heels reach back.
  const floorSlab = bounds(model.meshNames.flatMap((name) => model.positions(name)).filter((point) => point[1] < 0.03))
  assert.ok(floorSlab.max[2] > -floorSlab.min[2] && whole.max[2] < 0.5, `${entry.model.file} faces +Z`)
  return model
}

for (const entry of HUMAN_CATALOG) {
  const model = await openModel(entry)
  const skullTopMm = bounds(model.positions('Body')).max[1] * 1000
  const all = bounds(model.meshNames.flatMap((name) => model.positions(name)))
  for (const name of model.meshNames) {
    const count = model.positions(name).length
    assert.equal(model.attribute(name, '_SKIN_INDEX').length, count, `${entry.id}: ${name} has skin indices on every vertex`)
    assert.equal(model.attribute(name, '_SKIN_WEIGHT').length, count, `${entry.id}: ${name} has skin weights on every vertex`)
  }
  assert.equal(model.attribute('Body', '_LANDMARK').length, model.positions('Body').length, `${entry.id}: the body marks its landmarks`)
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
  const model = await openModel(entry)
  // Recreate the shipped material names/factors with shared texture handles.
  // A new tone must not recolor other instances of the cached GLB or its nails.
  const materials = model.document.getRoot().listMaterials().map((material) => {
    const copy = new THREE.MeshStandardMaterial({
      name: material.getName(),
      color: new THREE.Color().fromArray(material.getBaseColorFactor()),
      map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture(),
    })
    return copy
  })
  const skin = materials.find((material) => material.name.endsWith('_Skin'))
  const nails = materials.find((material) => material.name.endsWith('_Toenails'))
  assert.ok(skin && nails, `${entry.id}: actual materials support skin-only tinting`)
  const geometry = new THREE.BufferGeometry()
  const pair = [new THREE.Mesh(geometry, materials), new THREE.Mesh(geometry, materials)]
  const neighbor = new THREE.Mesh(geometry, materials)
  const sourceColor = skin.color.clone()
  let textureDisposals = 0
  for (const material of materials) {
    for (const map of [material.map, material.normalMap, material.roughnessMap]) {
      map.addEventListener('dispose', () => { textureDisposals += 1 })
    }
  }
  const colors = new Set()
  for (const tone of FOOT_SKIN_TONES) {
    const restore = applyFootSkinTone(pair, entry.id, tone)
    const tinted = pair[0].material.find((material) => material.name.endsWith('_Skin'))
    colors.add(tinted.color.toArray().join(','))
    assert.notEqual(tinted, skin)
    assert.equal(pair[1].material.find((material) => material.name.endsWith('_Skin')), tinted, 'both feet and shins use the same tone')
    assert.equal(pair[0].material.find((material) => material.name.endsWith('_Toenails')), nails, 'toenails keep their authored material')
    assert.equal(neighbor.material, materials, 'neighboring pair keeps its original materials')
    assert.deepEqual(skin.color, sourceColor, 'cached skin is never mutated')
    assert.equal(pair[0].geometry, geometry, 'appearance leaves geometry alone')
    for (const key of ['map', 'normalMap', 'roughnessMap']) assert.equal(tinted[key], skin[key], `shares the original ${key}`)
    assert.equal(tinted.depthWrite, true, 'skin stays opaque and occludes ruler text')
    if (tone === defaultFootSkinTone(entry.id)) assert.deepEqual(tinted.color, sourceColor, 'default exactly preserves authored color')
    let disposed = false
    tinted.addEventListener('dispose', () => { disposed = true })
    restore()
    assert.ok(disposed, 'replaced skin material is released')
    assert.equal(pair[0].material, materials)
    assert.equal(pair[1].material, materials)
    assert.equal(textureDisposals, 0, 'shared textures survive color changes/unmounts')
  }
  assert.equal(colors.size, 4, `${entry.id}: all four tones are distinct`)
  for (const material of materials) {
    material.map.dispose()
    material.normalMap.dispose()
    material.roughnessMap.dispose()
    material.dispose()
  }
  geometry.dispose()
  for (const meshName of ['LeftFootAndShin', 'RightFootAndShin']) {
    const weights = model.attribute(meshName, '_DEFORM_WEIGHTS')
    assert.equal(weights.length, model.positions(meshName).length, `${entry.id}: ${meshName} has deform weights on every vertex`)
    // The shin leans back past the heel, so measure the sole slab only.
    const sole = model.positions(meshName).filter((point) => point[1] < 0.03)
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
  `Model verification passed: ${HUMAN_CATALOG.length} human and ${FEET_CATALOG.length} feet GLBs match their catalog sizes; four skin tones preserve shared textures, nails and neighboring instances.`,
)
