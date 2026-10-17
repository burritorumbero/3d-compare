// Browser smoke/visual regression captures, usable on Vite dev OR preview.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { FOOT_SKIN_TONES } from '../src/domain/foot-skin.ts'
import { launchChrome } from './browser.mjs'

const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:43123'
const artifactDir = process.env.ARTIFACT_DIR ?? '/tmp/3d-compare-rendering'
await mkdir(artifactDir, { recursive: true })
const browser = await launchChrome()
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(message.location().url)) {
    errors.push(message.text())
  }
})

try {
  const scenarios = [
    { name: 'people', query: `mode=height&h=${HUMAN_CATALOG.map((entry) => `${entry.id}:${entry.referenceHeightMm}`).join(',')}` },
    { name: 'people-10ft', query: `mode=height&h=${HUMAN_CATALOG.map((entry) => `${entry.id}:3048`).join(',')}` },
    { name: 'female-us20', query: 'mode=feet&shoe=US&f=foot-female:344', frame: true },
    { name: 'male-us20', query: 'mode=feet&shoe=US&f=foot-male:357', frame: true },
    { name: 'female-small', query: 'mode=feet&shoe=US&f=foot-female:208', frame: true },
    { name: 'male-eu58', query: 'mode=feet&shoe=EU&f=foot-male:376', frame: true },
    ...['female', 'male'].map((sex) => ({
      name: `${sex}-skin-tones`,
      query: `mode=feet&shoe=US&f=${FOOT_SKIN_TONES.map((tone) => `foot-${sex}:${sex === 'female' ? 242 : 272}:s${tone}`).join(',')}`,
    })),
  ]
  for (const scenario of scenarios) {
    await page.goto(`${baseUrl}/?${scenario.query}`, { waitUntil: 'networkidle' })
    await page.locator('.lineup-select').first().evaluate((button) => button.click())
    await page.locator('.scene-label').waitFor({ state: 'attached', timeout: 90_000 })
    await page.locator('.stage-status[data-loading="false"]').waitFor({ state: 'attached', timeout: 90_000 })
    // The selected label proves only ONE model is ready. Select each person
    // before a lineup capture so slow meshopt decodes cannot leave stand-ins.
    if (scenario.name.startsWith('people')) {
      for (let index = 0; index < HUMAN_CATALOG.length; index += 1) {
        await page.locator('.lineup-select').nth(index).evaluate((button) => button.click())
        await page.waitForFunction((name) => document.querySelector('.scene-label')?.textContent?.startsWith(`${name} ·`), HUMAN_CATALOG[index].label)
      }
    }
    if (scenario.frame) await page.locator('button[title="Frame selection"]').evaluate((button) => button.click())
    // Let camera damping and texture uploads settle before capturing.
    await page.waitForTimeout(700)
    const labelHeight = await page.locator('.scene-label').evaluate((label) => label.getBoundingClientRect().height)
    assert.ok(labelHeight >= 26 && labelHeight <= 40, `${scenario.name}: label stays readable at any camera distance (${labelHeight}px)`)
    // Flush a compositor frame first. Software WebGL can otherwise return a
    // stale drawing buffer even after React has mounted the ready label.
    await page.screenshot({ path: `${artifactDir}/${scenario.name}-ui.png` })
    const dataUrl = await page.locator('#compare-stage canvas').evaluate((canvas) => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        canvas.getContext('webgl2').finish()
        resolve(canvas.toDataURL('image/png'))
      }))
    }))
    const pixels = Buffer.from(dataUrl.split(',')[1], 'base64')
    const stats = await sharp(pixels).stats()
    const channels = stats.channels.slice(0, 3)
    assert.ok(channels.reduce((sum, channel) => sum + channel.mean, 0) / 3 > 15, `${scenario.name}: visible stage`)
    assert.ok(channels.some((channel) => channel.max - channel.min > 100), `${scenario.name}: visible geometry`)
    await writeFile(`${artifactDir}/${scenario.name}-webgl.png`, pixels)
    assert.deepEqual(errors, [], `${scenario.name}: no browser errors`)
    console.log(`Rendered ${scenario.name}`)
  }
  console.log(`Rendering verification passed. Captures: ${artifactDir}`)
} finally {
  await browser.close()
}
