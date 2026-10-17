// Delivery/GPU estimates from shipped assets and the production build.
// Resource budgets do not claim a frame rate on real GPU hardware.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import sharp from 'sharp'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { FEET_CAP } from '../src/domain/feet-world.ts'
import { defaultFootSkinTone, FOOT_SKIN_TONES } from '../src/domain/foot-skin.ts'
import { HEIGHT_CAP } from '../src/domain/height-world.ts'
import { modelIO } from './model-io.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const MiB = 1024 * 1024
const budget = (actual, limit, name) => assert.ok(actual <= limit, `${name}: ${actual} exceeds budget ${limit}`)

// WebP/JPEG shrink downloads; WebGL uploads decoded RGBA8 plus mipmaps.
// Count each texture per asset once: placements share geometry and textures.
// Driver overhead, framebuffers, environment maps and CPU copies are excluded.
function textureBytes(texture) {
  const [width, height] = texture.getSize() ?? []
  assert.ok(width > 0 && height > 0, `Cannot measure texture ${texture.getName()}`)
  return decodedTextureBytes(width, height)
}

function decodedTextureBytes(width, height) {
  let bytes = 0
  while (true) {
    bytes += width * height * 4
    if (width === 1 && height === 1) return bytes
    width = Math.max(1, Math.floor(width / 2))
    height = Math.max(1, Math.floor(height / 2))
  }
}

const models = []
const io = await modelIO()
for (const entry of [...HUMAN_CATALOG, ...FEET_CATALOG]) {
  const file = entry.model.file
  const path = `${root}public/models/${file}`
  const isFoot = FEET_CATALOG.some((foot) => foot.id === entry.id)
  const model = (await io.read(path)).getRoot()
  const primitives = model.listMeshes().flatMap((mesh) => mesh.listPrimitives())
  const previewFiles = isFoot
    ? FOOT_SKIN_TONES.map((tone) => file.replace(/\.glb$/, `${tone === defaultFootSkinTone(entry.id) ? '' : `-${tone}`}.webp`))
    : [file.replace(/\.glb$/, '.webp')]
  const previewBytes = previewFiles.map((preview) => {
    const bytes = statSync(`${root}dist/previews/${preview}`).size
    budget(bytes, 30_000, preview)
    return bytes
  }).reduce((sum, bytes) => sum + bytes, 0)
  const stats = {
    file,
    glbBytes: statSync(path).size,
    rigBytes: statSync(path.replace(/\.glb$/, '.rig.json')).size,
    previewBytes,
    triangles: primitives.reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0),
    drawCalls: primitives.length,
    textures: model.listTextures().length,
    textureBytes: model.listTextures().reduce((sum, texture) => sum + textureBytes(texture), 0),
  }
  budget(stats.glbBytes, isFoot ? 2_500_000 : 6_000_000, `${file} download`)
  budget(stats.rigBytes, 1_000_000, `${file} rig`)
  budget(stats.triangles, isFoot ? 43_000 : 230_000, `${file} triangles`)
  budget(stats.drawCalls, isFoot ? 4 : 35, `${file} draw calls`)
  budget(stats.textureBytes, (isFoot ? 40 : 140) * MiB, `${file} texture memory`)
  models.push(stats)
}

// Optional complexion maps are cached across pairs, in addition to GLB maps.
const skinManifest = JSON.parse(readFileSync(`${root}dist/skins/manifest.json`, 'utf8'))
const skinTextures = await Promise.all(skinManifest.textures.map(async (entry) => {
  const path = `${root}dist/skins/${entry.file}`
  const bytes = statSync(path).size
  const { width, height } = await sharp(path).metadata()
  assert.equal(bytes, entry.bytes, `${entry.file} manifest bytes`)
  assert.equal(width, entry.width, `${entry.file} manifest width`)
  assert.equal(height, entry.height, `${entry.file} manifest height`)
  budget(bytes, 150_000, `${entry.file} download`)
  budget(Math.max(width, height), entry.file.endsWith('-color.webp') ? 2048 : 512, `${entry.file} resolution`)
  return { file: entry.file, bytes, textureBytes: decodedTextureBytes(width, height) }
}))

const assets = readdirSync(`${root}dist/assets`).filter((file) => /\.(js|css|wasm)$/.test(file)).sort().map((file) => {
  const bytes = readFileSync(`${root}dist/assets/${file}`)
  return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length }
})
const javascript = assets.filter((asset) => asset.file.endsWith('.js'))
const wasm = assets.filter((asset) => asset.file.endsWith('.wasm'))
assert.ok(javascript.length > 0 && wasm.length === 1, 'Run npm run build before verify:budgets')
const sum = (values, field) => values.reduce((total, value) => total + value[field], 0)
const totals = {
  javascriptBytes: sum(javascript, 'bytes'),
  javascriptGzipBytes: sum(javascript, 'gzipBytes'),
  allModelBytes: sum(models, 'glbBytes'),
  allPreviewBytes: sum(models, 'previewBytes'),
  allSkinDownloadBytes: sum(skinTextures, 'bytes'),
  allSkinTextureBytes: sum(skinTextures, 'textureBytes'),
  allTextureBytes: sum(models, 'textureBytes') + sum(skinTextures, 'textureBytes'),
  maxHeightTriangles: Math.max(...models.slice(0, HUMAN_CATALOG.length).map((model) => model.triangles)) * HEIGHT_CAP,
  maxHeightDrawCalls: Math.max(...models.slice(0, HUMAN_CATALOG.length).map((model) => model.drawCalls)) * HEIGHT_CAP,
  maxFeetTriangles: Math.max(...models.slice(HUMAN_CATALOG.length).map((model) => model.triangles)) * FEET_CAP,
}
for (const asset of javascript) budget(asset.bytes, 750_000, `${asset.file} chunk`)
budget(totals.javascriptBytes, 1_300_000, 'total JavaScript')
budget(totals.javascriptGzipBytes, 360_000, 'total JavaScript gzip')
budget(totals.allPreviewBytes, 150_000, 'all model previews')
budget(totals.allSkinDownloadBytes, 300_000, 'all optional skin textures')
budget(wasm[0].bytes, 90_000, 'WASM')
budget(wasm[0].gzipBytes, 35_000, 'WASM gzip')
budget(totals.allTextureBytes, 768 * MiB, 'all model and complexion texture memory')
budget(totals.maxHeightTriangles, 2_300_000, 'ten-person triangles')
budget(totals.maxHeightDrawCalls, 350, 'ten-person draw calls')
budget(totals.maxFeetTriangles, 430_000, 'ten-pair triangles')

console.table(models.map((model) => ({
  file: model.file, MB: (model.glbBytes / 1e6).toFixed(2), triangles: model.triangles,
  draws: model.drawCalls, textureMiB: (model.textureBytes / MiB).toFixed(1),
})))
console.log(`Budget verification passed: JS ${(totals.javascriptBytes / 1000).toFixed(1)} kB / ${(totals.javascriptGzipBytes / 1000).toFixed(1)} kB gzip; WASM ${(wasm[0].bytes / 1000).toFixed(1)} kB; all cached model textures ${(totals.allTextureBytes / MiB).toFixed(1)} MiB.`)
if (process.env.BUDGET_REPORT) {
  mkdirSync(dirname(process.env.BUDGET_REPORT), { recursive: true })
  writeFileSync(process.env.BUDGET_REPORT, `${JSON.stringify({ models, skinTextures, assets, totals }, null, 2)}\n`)
}
