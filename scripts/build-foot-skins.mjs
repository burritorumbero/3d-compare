// Crops independent Genesis 9 complexion maps to the shipped female foot UVs.
// No recoloring: the original local color, normal and roughness maps retain
// their own anatomical variation. Source files stay in the local Daz library.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { readModel } from './model-io.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const library = process.env.DAZ_LIBRARY ?? '/Users/Shared/My DAZ 3D Library'
const source = JSON.parse(await readFile(`${root}tools/assets/foot-skin-sources.json`, 'utf8'))
const output = `${root}public/skins`
const model = await readModel(`${root}public/models/${source.model}`)
const uvHash = createHash('sha256')
  .update(JSON.stringify(model.meshNames.map((name) => model.attribute(name, 'TEXCOORD_0'))))
  .digest('hex')
assert.equal(
  uvHash,
  source.uvSha256,
  'Foot UVs changed; recalculate the original padded crop in build_feet.cropped_material before generating skins.',
)
await mkdir(output, { recursive: true })
const manifest = { model: source.model, uvMin: source.uvMin, uvMax: source.uvMax, textures: [] }
for (const [tone, set] of Object.entries(source.presets)) {
  for (const [kind, tag, limit] of [
    ['color', 'D', 2048],
    ['normal', 'NM', 512],
    ['roughness', 'R', 512],
  ]) {
    const relative = `Runtime/Textures/DAZ/Characters/Genesis9/Base/${set}/G9${set.replace('_', '')}_Legs_${tag}_1003.jpg`
    const input = sharp(`${library}/${relative}`)
    const { width, height } = await input.metadata()
    const left = Math.floor(source.uvMin[0] * width)
    const top = Math.floor((1 - source.uvMax[1]) * height)
    const cropWidth = Math.ceil(source.uvMax[0] * width) - left
    const cropHeight = Math.ceil((1 - source.uvMin[1]) * height) - top
    const file = `female-${tone}-${kind}.webp`
    const { data, info } = await input
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize({ width: limit, height: limit, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: kind === 'color' ? 92 : 90 })
      .toBuffer({ resolveWithObject: true })
    await writeFile(`${output}/${file}`, data)
    manifest.textures.push({
      file,
      source: relative,
      width: info.width,
      height: info.height,
      bytes: data.length,
    })
    console.log(`Wrote ${file}: ${info.width} × ${info.height}, ${data.length} bytes`)
  }
}
await writeFile(`${output}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
