import assert from 'node:assert/strict'
import { createCompareApp } from '../src/app/compare-app.ts'
import { decodeShareQuery, encodeShareQuery, isShareQuery } from '../src/app/share.ts'
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { HUMAN_NAME_MAX_LENGTH } from '../src/domain/height-world.ts'
import { mintPlacementId } from '../src/domain/ids.ts'
import { parseDocumentJson, serializeDocument } from '../src/domain/persist.ts'
import {
  FOOT_LENGTH_MM_MAX,
  footLengthMm,
  footScale,
  heightMm,
  heightScale,
  parseHeightSpec,
} from '../src/domain/measure.ts'
import { parseShoeSpec } from '../src/domain/shoe-charts.ts'

assert.equal(HUMAN_CATALOG.length, 6)
assert.equal(new Set(HUMAN_CATALOG.map((entry) => entry.id)).size, 6)
assert.equal(FEET_CATALOG.length, 2)

const centimeters = parseHeightSpec({ unit: 'cm', value: 180 })
const imperial = parseHeightSpec({ unit: 'ftin', feet: 5, inches: 10.866 })
assert.equal(centimeters.ok && centimeters.value, heightMm(1800))
assert.equal(imperial.ok && imperial.value, heightMm(1800))
assert.equal(parseHeightSpec({ unit: 'cm', value: 240 }).ok, false)
assert.equal(heightScale(heightMm(1800), heightMm(1980)), 1.1)
assert.equal(footScale(footLengthMm(240), footLengthMm(264)), 1.1)

const womensEight = parseShoeSpec({ system: 'US', size: 8 }, 'female')
const mensEight = parseShoeSpec({ system: 'US', size: 8 }, 'male')
assert.equal(womensEight.ok && womensEight.value, footLengthMm(242))
assert.equal(mensEight.ok && mensEight.value, footLengthMm(255))
// Charts reach US women's 20, US men's 22, and EU 58; the domain range covers them.
const womensTwenty = parseShoeSpec({ system: 'US', size: 20 }, 'female')
const mensTwentyTwo = parseShoeSpec({ system: 'US', size: 22 }, 'male')
const euFiftyEight = parseShoeSpec({ system: 'EU', size: 58 }, 'male')
assert.equal(womensTwenty.ok && womensTwenty.value, footLengthMm(344))
assert.equal(mensTwentyTwo.ok && mensTwentyTwo.value, footLengthMm(374))
assert.equal(euFiftyEight.ok && euFiftyEight.value, footLengthMm(376))
assert.equal(parseShoeSpec({ system: 'US', size: 22.5 }, 'male').ok, false)
assert.ok(FOOT_LENGTH_MM_MAX >= 376)

const uuidPattern = /^placement-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
assert.match(mintPlacementId(), uuidPattern)
// Browsers hide crypto.randomUUID outside secure contexts. Simulate that and
// check the getRandomValues fallback still mints unique, well-formed ids.
Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
try {
  const fallbackIds = new Set(Array.from({ length: 50 }, () => mintPlacementId()))
  assert.equal(fallbackIds.size, 50)
  for (const id of fallbackIds) {
    assert.match(id, uuidPattern)
  }
} finally {
  delete globalThis.crypto.randomUUID
}
assert.equal(typeof globalThis.crypto.randomUUID, 'function')

const app = createCompareApp()
for (let index = 0; index < 10; index += 1) {
  assert.equal(app.placeHuman(HUMAN_CATALOG[index % HUMAN_CATALOG.length].id).ok, true)
}
const beforeCap = app.getState()
assert.deepEqual(app.placeHuman(HUMAN_CATALOG[0].id), { ok: false, reason: 'cap-reached' })
assert.equal(app.getState(), beforeCap)

const firstHuman = app.getState().height.placements[0]
assert.deepEqual(app.updateHumanHeight(firstHuman.id, { unit: 'cm', value: 205 }), {
  ok: true,
})
assert.equal(app.getState().height.placements[0].heightMm, heightMm(2050))
// Names: trimmed and capped; blank restores the catalog label.
assert.deepEqual(app.renameHuman(firstHuman.id, '  Mom, the: boss  '), { ok: true })
assert.equal(app.getState().height.placements[0].name, 'Mom, the: boss')
assert.deepEqual(app.renameHuman(firstHuman.id, 'x'.repeat(80)), { ok: true })
assert.equal(app.getState().height.placements[0].name.length, HUMAN_NAME_MAX_LENGTH)
assert.deepEqual(app.renameHuman(firstHuman.id, '   '), { ok: true })
assert.equal(app.getState().height.placements[0].name, undefined)
assert.deepEqual(app.renameHuman('missing', 'Nope'), { ok: false, reason: 'not-found' })
assert.deepEqual(app.renameHuman(firstHuman.id, 'Mom, the: boss'), { ok: true })
assert.deepEqual(app.updateHumanHeight(firstHuman.id, { unit: 'cm', value: 20 }), {
  ok: false,
  reason: 'out-of-range',
})

app.setMode('feet')
const footResult = app.placeFoot(FEET_CATALOG[0].id)
assert.equal(footResult.ok, true)
if (!footResult.ok) {
  throw new Error('Expected a placed foot.')
}
assert.deepEqual(app.updateFootSize(footResult.id, { system: 'EU', size: 40 }), {
  ok: true,
})
assert.equal(app.getState().feet.placements[0].footLengthMm, footLengthMm(257))
app.setMode('height')
assert.equal(app.getState().height.placements.length, 10)
assert.equal(app.getState().feet.placements.length, 1)

const persisted = parseDocumentJson(serializeDocument(app.getState()))
assert.equal(persisted.ok, true)
assert.equal(persisted.ok && persisted.value.height.placements.length, 10)
assert.equal(persisted.ok && persisted.value.feet.placements.length, 1)
assert.equal(persisted.ok && persisted.value.height.placements[0].name, 'Mom, the: boss')
assert.equal(parseDocumentJson('{"version":1,"height":[]}').ok, false)

// Share links: both worlds, units, names with separators, and bad entries skipped.
const query = encodeShareQuery(app.getState())
assert.ok(isShareQuery(`?${query}`))
assert.equal(isShareQuery('?utm_source=x'), false)
assert.equal(decodeShareQuery(''), null)
const shared = decodeShareQuery(`?${query}`)
assert.ok(shared)
assert.equal(shared.mode, 'height')
assert.equal(shared.heightUnit, app.getState().heightUnit)
assert.equal(shared.shoeSystem, app.getState().shoeSystem)
assert.deepEqual(
  shared.height.placements.map((placement) => [placement.catalogId, placement.heightMm, placement.name]),
  app.getState().height.placements.map((placement) => [placement.catalogId, placement.heightMm, placement.name]),
)
assert.deepEqual(
  shared.feet.placements.map((placement) => [placement.catalogId, placement.footLengthMm]),
  app.getState().feet.placements.map((placement) => [placement.catalogId, placement.footLengthMm]),
)
assert.equal(shared.height.selected, null)
const lenient = decodeShareQuery('?mode=feet&h=bogus:1700,female-tan-dress:5:x,female-tan-dress:1700:ok%2Cthen&f=foot-male:999,foot-female:250')
assert.equal(lenient.mode, 'feet')
assert.deepEqual(lenient.height.placements.map((placement) => placement.name), ['ok,then'])
assert.deepEqual(lenient.feet.placements.map((placement) => placement.footLengthMm), [footLengthMm(250)])

console.log('Domain verification passed: units, charts, cap, dual worlds, names, updates, persistence, and share links.')
