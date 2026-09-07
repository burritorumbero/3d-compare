import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchChrome } from './browser.mjs'

const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:43123'
const artifactDir = process.env.ARTIFACT_DIR ?? '/tmp/3d-compare-verification'

await mkdir(artifactDir, { recursive: true })

async function captureWebGlFrame(page, filename) {
  const frame = await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const canvas = document.querySelector('#compare-stage canvas')
          const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
          const pixels = new Uint8Array(canvas.width * canvas.height * 4)
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          let minimum = 765
          let maximum = 0
          let samples = 0
          for (let index = 0; index < pixels.length; index += 64) {
            const sum = pixels[index] + pixels[index + 1] + pixels[index + 2]
            minimum = Math.min(minimum, sum)
            maximum = Math.max(maximum, sum)
            samples += 1
          }
          resolve({
            dataUrl: canvas.toDataURL('image/png'),
            contrast: maximum - minimum,
            samples,
          })
        })
      }),
  )
  assert.ok(frame.samples > 1000)
  assert.ok(frame.contrast > 100, `WebGL frame contrast was only ${frame.contrast}.`)
  await writeFile(`${artifactDir}/${filename}`, Buffer.from(frame.dataUrl.split(',')[1], 'base64'))
}

/** The selected figure's label mounts once its model is loaded; then wait for every download to settle. */
async function waitForModels(page) {
  await page.locator('.scene-label').first().waitFor({ state: 'attached', timeout: 90_000 })
  await page.locator('.stage-status[data-loading="false"]').waitFor({ state: 'attached', timeout: 90_000 })
}

async function stageHeight(page) {
  return page.locator('.stage-panel').evaluate((element) => element.getBoundingClientRect().height)
}

/** Polls until the stage height is within `tolerance` of `expected`, for layout that settles after a frame. */
async function waitForStageHeight(page, expected, tolerance) {
  let latest = await stageHeight(page)
  for (let attempt = 0; attempt < 40 && Math.abs(latest - expected) >= tolerance; attempt += 1) {
    await page.waitForTimeout(50)
    latest = await stageHeight(page)
  }
  return latest
}

// The Google Fonts stylesheet is optional: the app falls back to system fonts
// when it does not load, so an offline or sandboxed run must not fail on it.
const optionalFontHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

function isOptionalFontFailure(message) {
  const url = message.location().url
  if (!url) {
    return false
  }
  try {
    return optionalFontHosts.has(new URL(url).hostname)
  } catch {
    return false
  }
}

function watchErrors(page, errors) {
  page.on('console', (message) => {
    if (message.type() === 'error' && !isOptionalFontFailure(message)) {
      errors.push(`console: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
}

const browser = await launchChrome()
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const errors = []
watchErrors(page, errors)

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.scene-empty').waitFor({ state: 'visible', timeout: 20_000 })
  assert.equal(await page.locator('#compare-stage canvas').count(), 1)
  assert.match(await page.locator('.stage-title strong').innerText(), /Concrete studio/)
  // Height mode only orbits: no navigation toggle, and the hint invites a tap.
  assert.equal(await page.locator('.nav-toggle').count(), 0)
  assert.match(await page.locator('.navigation-hint').innerText(), /Tap a person/)

  await page.getByRole('button', { name: 'Add Ari', exact: true }).click()
  await page.locator('.inspector-heading h2').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.inspector-heading h2').innerText(), 'Ari')

  await page.getByRole('button', { name: 'cm', exact: true }).click()
  await page.locator('.inspector-panel input[type="number"]').fill('190')
  await page.getByRole('button', { name: 'Update height', exact: true }).click()
  assert.equal(await page.locator('.selection-summary strong').innerText(), '190 cm')

  // Custom names flow to the inspector, the lineup, and the on-stage label.
  await page.locator('.name-field input').fill('Mom')
  await page.locator('.name-field input').press('Enter')
  assert.equal(await page.locator('.inspector-heading h2').innerText(), 'Mom')
  assert.equal(await page.locator('.lineup-list li strong').first().innerText(), 'Mom')
  await waitForModels(page)
  assert.match(await page.locator('.scene-label').first().innerText(), /Mom · 190 cm/)

  const firstCatalogCard = page.locator('.catalog-card').first()
  for (let index = 0; index < 9; index += 1) {
    await firstCatalogCard.click()
  }
  assert.equal(await page.locator('.lineup-list li').count(), 10)
  assert.match(await page.locator('.cap-message').innerText(), /Stage full/)
  assert.equal(await firstCatalogCard.isDisabled(), true)
  await waitForModels(page)
  // Only the selected figure shows its info block.
  assert.equal(await page.locator('.scene-label').count(), 1)

  // Full screen pins the stage over the whole viewport, then releases it.
  const windowedHeight = await stageHeight(page)
  await page.getByRole('button', { name: 'Full screen', exact: true }).click()
  await page.locator('.stage-panel.is-fullscreen').waitFor({ state: 'visible' })
  assert.ok((await stageHeight(page)) >= 940, 'Full screen stage should fill the viewport height.')
  await page.getByRole('button', { name: 'Exit full screen', exact: true }).click()
  await page.locator('.stage-panel.is-fullscreen').waitFor({ state: 'detached' })
  const restoredHeight = await waitForStageHeight(page, windowedHeight, 4)
  assert.ok(
    Math.abs(restoredHeight - windowedHeight) < 4,
    `Stage should return to its windowed size (was ${windowedHeight}px, now ${restoredHeight}px).`,
  )

  const heightScreenshot = await page.screenshot({
    path: `${artifactDir}/height-desktop.png`,
    fullPage: true,
  })
  assert.ok(heightScreenshot.byteLength > 30_000)
  await captureWebGlFrame(page, 'height-webgl.png')

  await page.locator('.mode-switch button').nth(1).evaluate((button) => button.click())
  await page.locator('.mode-feet').waitFor({ state: 'visible' })
  assert.match(await page.locator('.stage-title strong').innerText(), /Oak measure table/)
  assert.equal(await page.locator('.nav-toggle button').first().getAttribute('aria-pressed'), 'true')
  await page
    .getByRole('button', { name: 'Add female feet', exact: true })
    .evaluate((button) => button.click())
  assert.equal(await page.locator('.lineup-list li').count(), 1)

  await page.getByRole('button', { name: 'EU', exact: true }).evaluate((button) => button.click())
  await page.locator('.shoe-field select').selectOption('40')
  assert.equal(await page.locator('.selection-summary strong').innerText(), 'EU 40')
  assert.match(await page.locator('.selection-summary small').innerText(), /257 mm/)
  // Extended charts reach EU 58, US women's 20, and US men's 22.
  await page.locator('.shoe-field select').selectOption('58')
  assert.match(await page.locator('.selection-summary small').innerText(), /376 mm/)
  await page.getByRole('button', { name: 'US', exact: true }).evaluate((button) => button.click())
  await page.locator('.shoe-field select').selectOption('20')
  assert.equal(await page.locator('.selection-summary strong').innerText(), 'US 20')
  await page.locator('.shoe-field select').selectOption('8')

  await page.locator('.feet-catalog .catalog-card').nth(1).evaluate((button) => button.click())
  assert.equal(await page.locator('.lineup-list li').count(), 2)
  await page.locator('.shoe-field select').selectOption('22')
  assert.match(await page.locator('.selection-summary small').innerText(), /374 mm/)
  await page
    .getByRole('button', { name: 'Inspect', exact: true })
    .evaluate((button) => button.click())
  assert.match(await page.locator('.navigation-hint').innerText(), /Drag to pan/)
  await waitForModels(page)

  const feetScreenshot = await page.screenshot({
    path: `${artifactDir}/feet-desktop.png`,
    fullPage: true,
  })
  assert.ok(feetScreenshot.byteLength > 30_000)
  await captureWebGlFrame(page, 'feet-webgl.png')

  // Share copies a link that reproduces both worlds.
  await page.getByRole('button', { name: 'Share link', exact: true }).evaluate((button) => button.click())
  await page.locator('.notice-toast.is-visible').waitFor({ state: 'visible' })
  assert.match(await page.locator('.notice-toast').innerText(), /Link copied/)
  const link = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(link.startsWith(`${baseUrl}/?`), `Share link should point at the app: ${link}`)
  assert.match(link, /mode=feet/)
  assert.match(link, /h=female-tan-dress:1900:Mom/)
  assert.match(link, /f=foot-female:242,foot-male:374/)

  // Responsive stage: phone and tablet viewports size the stage to the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('#compare-stage canvas').waitFor({ state: 'visible', timeout: 20_000 })
  assert.equal(await page.locator('.lineup-list li').count(), 2)
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  assert.ok(scrollWidth <= 390, `Mobile layout overflows to ${scrollWidth}px.`)
  const phoneStage = await stageHeight(page)
  assert.ok(phoneStage >= 360 && phoneStage <= 844, `Phone stage height was ${phoneStage}px.`)
  await page.screenshot({
    path: `${artifactDir}/feet-mobile.png`,
    fullPage: true,
  })

  await page.setViewportSize({ width: 900, height: 1200 })
  const tabletStage = await stageHeight(page)
  assert.ok(tabletStage >= 420 && tabletStage <= 800, `Tablet stage height was ${tabletStage}px.`)
  assert.notEqual(Math.round(tabletStage), Math.round(phoneStage))

  await page.locator('.mode-switch button').first().evaluate((button) => button.click())
  assert.equal(await page.locator('.lineup-list li').count(), 10)
  assert.match(await page.locator('.cap-message').innerText(), /Stage full/)
  assert.deepEqual(errors, [])
  // Free the software renderer before the guest profile starts loading models.
  await page.close()

  // Someone else opens the link in a fresh browser profile and sees the same lineup.
  const guest = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const guestErrors = []
  watchErrors(guest, guestErrors)
  // A share link mounts every figure at once, so wait on the app rather than on network idle.
  // The optional fonts stylesheet can stall the load event offline, so wait on the DOM and the app instead.
  await guest.goto(link, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await guest.locator('.mode-feet').waitFor({ state: 'visible', timeout: 60_000 })
  await guest.locator('.stage-status[data-loading="false"]').waitFor({ state: 'attached', timeout: 90_000 })
  assert.equal(new URL(guest.url()).search, '', 'Share query should be cleared after import.')
  assert.equal(await guest.locator('.lineup-list li').count(), 2)
  assert.match(await guest.locator('.lineup-list li small').nth(1).innerText(), /US 22/)
  await guest.locator('.mode-switch button').first().evaluate((button) => button.click())
  assert.equal(await guest.locator('.lineup-list li').count(), 10)
  assert.equal(await guest.locator('.lineup-list li strong').first().innerText(), 'Mom')
  assert.match(await guest.locator('.lineup-list li small').first().innerText(), /190 cm/)
  assert.deepEqual(guestErrors, [])
  await guest.close()

  console.log(`UI verification passed. Screenshots: ${artifactDir}`)
} finally {
  await browser.close()
}
