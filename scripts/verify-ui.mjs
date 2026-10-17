import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { launchChrome } from './browser.mjs'

const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:43123'
const artifactDir = process.env.ARTIFACT_DIR ?? '/tmp/3d-compare-verification'

await mkdir(artifactDir, { recursive: true })

async function captureWebGlFrame(page, filename) {
  // Use the compositor's captured frame. A second synchronous readPixels on
  // the ten-person software-WebGL scene can stall Chrome's GPU indefinitely.
  const pixels = await page.locator('#compare-stage canvas').screenshot({ timeout: 60_000 })
  const stats = await sharp(pixels).stats()
  assert.ok(stats.channels.slice(0, 3).some(channel => channel.max - channel.min > 100), 'WebGL frame contains visible geometry.')
  await writeFile(`${artifactDir}/${filename}`, pixels)
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

  // The parametric kernel loads in the browser through Vite and solves a rig.
  const kernelCheck = await page.evaluate(async () => {
    const { loadBrowserKernel } = await import('/src/kernel/browser.ts')
    const { RigSolver } = await import('/src/kernel/index.ts')
    await loadBrowserKernel()
    const solver = new RigSolver({
      version: 1,
      mesh: 'bar',
      bones: [{ name: 'root', parent: null, head: [0, 0, 0] }],
      vertices: { source: [0, 1], positions: [0, 0, 0, 0, 0, 0.25], skinBones: [0, 0, 0, 0, 0, 0, 0, 0], skinWeights: [1, 0, 0, 0, 1, 0, 0, 0] },
      morphs: [],
      controls: [{ name: 'length', min: 0.5, max: 2, channels: [{ bone: 'root', axis: 'z', gain: 1 }] }],
      groups: { all: [0, 1] },
      measures: [{ name: 'length', kind: 'extent', group: 'all', axis: 'z' }],
      hull: 'all',
    })
    const solution = solver.solve({ length: 0.3 })
    solver.dispose()
    return solution
  })
  assert.ok(Math.abs(kernelCheck.measures.length - 0.3) < 0.0001, `the kernel solves in the browser: ${JSON.stringify(kernelCheck)}`)
  assert.ok(Math.abs(kernelCheck.controls.length - 1.2) < 0.0005)
  assert.equal(await page.locator('#compare-stage canvas').count(), 1)
  assert.match(await page.locator('.stage-title strong').innerText(), /Height comparison/)
  // Height mode only orbits: no navigation toggle, and the hint invites a tap.
  assert.equal(await page.locator('.nav-toggle').count(), 0)
  assert.match(await page.locator('.navigation-hint').innerText(), /Tap a person/)

  await page.getByRole('button', { name: 'Choose a person', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.catalog-card').count(), 6)
  await page.locator('.catalog-card').last().focus()
  await page.keyboard.press('Tab')
  assert.equal(await page.getByRole('button', { name: 'Close model library' }).evaluate((button) => button === document.activeElement), true, 'Tab stays in the modal')
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Choose a person', exact: true }).evaluate((button) => button === document.activeElement), true, 'closing the picker restores focus')
  await page.getByRole('button', { name: 'Choose a person', exact: true }).click()
  await page.getByRole('button', { name: 'Add Ari', exact: true }).click()
  await page.locator('.inspector-panel h2').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.inspector-panel h2').innerText(), 'Ari')

  await page.getByRole('button', { name: 'cm', exact: true }).click()
  await page.locator('.inspector-panel input[type="number"]').fill('190')
  await page.locator('.inspector-panel input[type="number"]').press('Enter')
  assert.equal(await page.locator('.selection-summary strong').innerText(), '190 cm')
  // Heights reach 10 feet (304.8 cm) and stop there.
  await page.locator('.inspector-panel input[type="number"]').fill('304.8')
  await page.locator('.inspector-panel input[type="number"]').press('Enter')
  assert.equal(await page.locator('.selection-summary strong').innerText(), '304.8 cm')
  await page.locator('.inspector-panel input[type="number"]').fill('305')
  await page.locator('.inspector-panel input[type="number"]').press('Enter')
  assert.equal(
    await page.locator('.inspector-panel input[type="number"]').evaluate((input) => input.validity.rangeOverflow),
    true,
    'out-of-range height is flagged and does not update the model',
  )
  assert.equal(await page.locator('.selection-summary strong').innerText(), '304.8 cm')
  await page.locator('.inspector-panel input[type="number"]').fill('190')
  await page.locator('.inspector-panel input[type="number"]').press('Enter')
  assert.equal(await page.locator('.selection-summary strong').innerText(), '190 cm')

  // Direct edits apply on blur as well as Enter; sliders, resets and units agree.
  await page.locator('.inspector-panel input[type="number"]').fill('180')
  await page.locator('.name-field input').focus()
  assert.equal(await page.locator('.selection-summary strong').innerText(), '180 cm')
  await page.getByRole('button', { name: 'Reset to model height', exact: true }).click()
  assert.equal(await page.locator('.selection-summary strong').innerText(), '170.5 cm')
  await page.getByRole('slider', { name: 'Height slider', exact: true }).press('End')
  assert.equal(await page.locator('.selection-summary strong').innerText(), '304.8 cm')
  await page.getByRole('button', { name: 'ft + in', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Feet', exact: true }).fill('6')
  await page.getByRole('spinbutton', { name: 'Inches', exact: true }).fill('0')
  await page.getByRole('spinbutton', { name: 'Inches', exact: true }).press('Enter')
  assert.equal(await page.locator('.selection-summary strong').innerText(), '6′ 0″')
  await page.getByRole('button', { name: 'cm', exact: true }).click()
  assert.equal(await page.locator('.inspector-panel input[type="number"]').inputValue(), '182.9')
  await page.locator('.inspector-panel input[type="number"]').fill('')
  await page.locator('.inspector-panel input[type="number"]').press('Enter')
  assert.equal(await page.locator('.field-error').count(), 1)
  assert.equal(await page.locator('.selection-summary strong').innerText(), '182.9 cm')
  await page.locator('.inspector-panel input[type="number"]').fill('190')
  await page.locator('.inspector-panel input[type="number"]').press('Enter')

  // Custom names flow to the inspector, the lineup, and the on-stage label.
  await page.locator('.name-field input').fill('Mom')
  await page.locator('.name-field input').press('Enter')
  assert.equal(await page.locator('.inspector-panel h2').innerText(), 'Mom')
  assert.equal(await page.locator('.lineup-list li strong').first().innerText(), 'Mom')
  await waitForModels(page)
  assert.match(await page.locator('.scene-label').first().innerText(), /Mom · 190 cm/)

  const firstCatalogCard = page.locator('.catalog-card').first()
  for (let index = 0; index < 9; index += 1) {
    await page.getByRole('button', { name: 'Add person', exact: true }).click()
    await firstCatalogCard.click()
  }
  assert.equal(await page.locator('.lineup-list li').count(), 10)
  assert.match(await page.locator('.cap-message').innerText(), /Lineup full/)
  assert.equal(await page.getByRole('button', { name: 'Add person', exact: true }).isDisabled(), true)
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
  assert.match(await page.locator('.stage-title strong').innerText(), /Foot comparison/)
  assert.equal(await page.locator('.nav-toggle button').first().getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Choose a pair', exact: true }).click()
  await page
    .getByRole('button', { name: 'Add female feet', exact: true })
    .evaluate((button) => button.click())
  assert.equal(await page.locator('.lineup-list li').count(), 1)

  // Native radios support keyboard selection; previews and the model follow.
  assert.deepEqual(await page.getByRole('radio').evaluateAll((radios) => radios.map((radio) => radio.labels[0].textContent.trim())), ['White', 'Black', 'Hispanic', 'Asian'])
  assert.equal(await page.getByRole('radio', { name: 'Hispanic', exact: true }).isChecked(), true)
  await page.getByRole('radio', { name: 'Hispanic', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('radio', { name: 'Asian', exact: true }).isChecked(), true)
  await page.getByText('Black', { exact: true }).click()
  assert.equal(await page.getByRole('radio', { name: 'Black', exact: true }).isChecked(), true)
  assert.match(await page.locator('.selection-summary img').getAttribute('src'), /female-feet-shins-black.webp$/)
  assert.match(await page.locator('.lineup-select img').getAttribute('src'), /female-feet-shins-black.webp$/)

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

  // Shape: toe length locks, follows into foot length, and resets to the average.
  assert.equal(await page.locator('.dimension-status').count(), 3)
  const toeField = page.locator('.dimension-toeLength input[type="number"]')
  assert.equal(await toeField.inputValue(), '63')
  await toeField.fill('70')
  await toeField.press('Enter')
  assert.match(await page.locator('.selection-summary small').innerText(), /249 mm long/)
  assert.equal(await page.locator('.dimension-toeLength .dimension-reset').count(), 1)
  assert.match(await page.locator('.lineup-list li small').first().innerText(), /custom shape/)
  const widthField = page.locator('.dimension-ballWidth input[type="number"]')
  await widthField.fill('200')
  await widthField.press('Enter')
  assert.match(await page.locator('.foot-dimensions .field-error').innerText(), /Foot width must be between/)
  assert.equal(await widthField.inputValue(), String(Math.round(249 * 0.3766)), 'a rejected width leaves the shape alone')

  await page.getByRole('button', { name: 'Add feet', exact: true }).click()
  await page.locator('.feet-catalog .catalog-card').nth(1).evaluate((button) => button.click())
  assert.equal(await page.locator('.lineup-list li').count(), 2)
  assert.equal(await page.getByRole('radio', { name: 'White', exact: true }).isChecked(), true)
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
  assert.match(link, /f=foot-female:249:sblack:t70,foot-male:374/)

  // Responsive stage: phone and tablet viewports size the stage to the screen.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('#compare-stage canvas').waitFor({ state: 'visible', timeout: 20_000 })
  assert.equal(await page.locator('.lineup-list li').count(), 2)
  assert.equal(await page.locator('.detail-column').isVisible(), true)
  await page.getByRole('button', { name: 'Lineup 2', exact: true }).click()
  assert.equal(await page.locator('.lineup-column').isVisible(), true)
  assert.equal(await page.locator('.detail-column').isVisible(), false)
  await page.locator('.lineup-select').first().click()
  assert.equal(await page.locator('.detail-column').isVisible(), true, 'selecting a model opens its measurements on mobile')
  assert.equal(await page.locator('.inspector-panel h2').innerText(), 'Female feet')
  assert.equal(await page.getByRole('radio', { name: 'Black', exact: true }).isChecked(), true, 'saved tone survives a reload and selection change')
  await page.locator('.dimension-toeLength .dimension-reset').click()
  assert.equal(await page.getByRole('radio', { name: 'Black', exact: true }).isChecked(), true, 'shape reset keeps the chosen tone')
  assert.equal(await page.locator('.dimension-status').count(), 3)
  await page.getByRole('button', { name: 'Lineup 2', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Female feet', exact: true }).click()
  assert.equal(await page.locator('.lineup-list li').count(), 1)
  await page.getByRole('button', { name: 'Add feet', exact: true }).click()
  await page.getByRole('button', { name: 'Add female feet', exact: true }).click()
  assert.equal(await page.locator('.detail-column').isVisible(), true)
  assert.equal(await page.locator('.lineup-list li').count(), 2)
  await page.getByText('Asian', { exact: true }).click()
  assert.equal(await page.getByRole('radio', { name: 'Asian', exact: true }).isChecked(), true, 'skin controls are usable on a phone')
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
  assert.match(await page.locator('.cap-message').innerText(), /Lineup full/)
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
  await guest.locator('.lineup-select').first().click()
  assert.equal(await guest.getByRole('radio', { name: 'Black', exact: true }).isChecked(), true, 'shared links retain skin tone')
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
