// Rebuilds the people GLBs from Daz Genesis 9 characters, clothing, and hair,
// optimizes them for the web, and writes their rig files. Needs Blender 4.2+
// with the Diffeomorphic DAZ importer and the Daz content libraries (see
// tools/assets/build_people.py). Results ship in public/models.
//
//   npm run assets:people [--optimize-only] [model id ...]
//
// BLENDER_BIN points at Blender; DAZ_LIBRARY and DAZ_EXTRA_LIBRARIES at content.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, prune, reorder, textureCompress } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { modelIO, readModel } from './model-io.mjs'
import { personRigFile } from './person-rig.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const models = `${root}public/models`
const work = `${root}tools/assets/.work`
const blender = process.env.BLENDER_BIN ?? '/Applications/Blender/Blender 5.2.app/Contents/MacOS/Blender'
const ALL = [
  'female-tan-dress',
  'female-dark-jeans-tshirt',
  'female-pale-shorts-croptop',
  'male-tan-shorts-tshirt',
  'male-dark-jeans-sleeveless',
  'male-pale-trousers-shirt',
]
const optimizeOnly = process.argv.includes('--optimize-only')
const requested = process.argv.slice(2).filter((arg) => arg !== '--optimize-only')
const ids = requested.length > 0 ? requested : ALL
for (const id of ids) {
  if (!ALL.includes(id)) throw new Error(`Unknown person: ${id}`)
}

if (!optimizeOnly && !existsSync(blender)) {
  console.error(`Blender not found at ${blender}. Set BLENDER_BIN to the Blender executable.`)
  process.exit(1)
}
mkdirSync(work, { recursive: true })

/**
 * Web delivery: skin indices and landmark ids as bytes, skin weights as normalized
 * bytes, WebP textures, and meshopt-compressed geometry. Positions stay float
 * (no quantization), so meshes carry no dequantization transforms.
 */
async function optimize(input, output) {
  const io = await modelIO()
  const document = await io.read(input)
  for (const primitive of document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())) {
    for (const name of ['_SKIN_INDEX', '_LANDMARK']) {
      const accessor = primitive.getAttribute(name)
      accessor?.setArray(Uint8Array.from(accessor.getArray(), Math.round))
    }
    const weights = primitive.getAttribute('_SKIN_WEIGHT')
    weights?.setArray(Uint8Array.from(weights.getArray(), (value) => Math.round(value * 255))).setNormalized(true)
  }
  // Detail maps do not need the color maps' resolution. Keep face/albedo/alpha
  // detail, but cap normal and roughness maps at 512 px to reduce GPU memory.
  await document.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [512, 512], slots: /^(normalTexture|metallicRoughnessTexture)$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, slots: /^(?!normalTexture$|metallicRoughnessTexture$)/ }),
  )
  await document.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }))
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
  await io.write(output, document)
}

for (const id of ids) {
  const raw = `${work}/${id}.glb`
  if (!optimizeOnly) {
    const result = spawnSync(blender, ['-b', '--python-exit-code', '1', '--python', `${root}tools/assets/build_people.py`, '--', id, raw], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    for (const line of `${result.stdout}\n${result.stderr}`.split('\n')) {
      if (line.startsWith('[build_people]') || /Error|Traceback/.test(line)) {
        console.log(line.length > 400 ? `${line.slice(0, 400)}…` : line)
      }
    }
    if (result.status !== 0) {
      throw new Error(`Blender failed to build ${id}.`)
    }
  }
  if (!existsSync(raw)) {
    throw new Error(`Missing raw asset ${raw}; run npm run assets:people ${id} first.`)
  }

  const glb = `${models}/${id}.glb`
  await optimize(raw, glb)
  rmSync(`${work}/.${id}-textures`, { recursive: true, force: true })
  // Optimization reorders vertices, so the rig is written from the shipped file.
  const model = await readModel(glb)
  writeFileSync(`${models}/${id}.rig.json`, `${JSON.stringify(personRigFile(model))}\n`)
  const manifestPath = `${models}/manifest.json`
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = manifest.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`Missing manifest entry: ${id}`)
  entry.bytes = statSync(glb).size
  entry.triangles = model.triangles
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote public/models/${id}.glb (${(statSync(glb).size / 1e6).toFixed(2)} MB, raw ${(statSync(raw).size / 1e6).toFixed(1)} MB) and its rig.`)
}
