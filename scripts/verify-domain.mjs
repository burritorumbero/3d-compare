import assert from 'node:assert/strict'
import { createCompareApp } from '../src/app/compare-app.ts'
import { decodeShareQuery, encodeShareQuery, isShareQuery } from '../src/app/share.ts'
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { FOOT_CATALOG_SEX } from '../src/domain/catalog.ts'
import {
  footDimensionEditRange,
  resetFootDimension,
  resizeFoot,
  setFootDimension,
  typicalFootShape,
} from '../src/domain/foot-shape.ts'
import { HUMAN_NAME_MAX_LENGTH } from '../src/domain/height-world.ts'
import { mintPlacementId } from '../src/domain/ids.ts'
import { parseDocumentJson, serializeDocument } from '../src/domain/persist.ts'
import {
  FOOT_LENGTH_MM_MAX,
  HEIGHT_MM_MAX,
  footLengthMm,
  footScale,
  heightMm,
  heightScale,
  parseHeightSpec,
} from '../src/domain/measure.ts'
import { parseShoeSpec } from '../src/domain/shoe-charts.ts'
import { humanLineupX } from '../src/scene/draw.ts'
import { BODY_LANDMARKS, LANDMARK_HEIGHT_ORDER, averageLandmarks, statureTargets } from '../src/domain/stature.ts'

assert.equal(HUMAN_CATALOG.length, 6)
assert.equal(new Set(HUMAN_CATALOG.map((entry) => entry.id)).size, 6)
assert.equal(FEET_CATALOG.length, 2)
for (const entry of FEET_CATALOG) {
  assert.equal(FOOT_CATALOG_SEX[entry.id], entry.sex, `${entry.id} sex matches the domain map`)
}

const centimeters = parseHeightSpec({ unit: 'cm', value: 180 })
const imperial = parseHeightSpec({ unit: 'ftin', feet: 5, inches: 10.866 })
assert.equal(centimeters.ok && centimeters.value, heightMm(1800))
assert.equal(imperial.ok && imperial.value, heightMm(1800))
// Heights reach 10 feet (3048 mm) exactly, in either unit, and no further.
assert.equal(HEIGHT_MM_MAX, 3048)
const tenFeet = parseHeightSpec({ unit: 'ftin', feet: 10, inches: 0 })
assert.equal(tenFeet.ok && tenFeet.value, heightMm(3048))
assert.equal(parseHeightSpec({ unit: 'cm', value: 304.8 }).ok, true)
assert.equal(parseHeightSpec({ unit: 'cm', value: 240 }).ok, true)
assert.equal(parseHeightSpec({ unit: 'cm', value: 305 }).ok, false)
assert.equal(parseHeightSpec({ unit: 'ftin', feet: 10, inches: 0.5 }).ok, false)
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
assert.equal(app.getState().feet.placements[0].shape.lengthMm, footLengthMm(257))
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
  shared.feet.placements.map((placement) => [placement.catalogId, placement.shape]),
  app.getState().feet.placements.map((placement) => [placement.catalogId, placement.shape]),
)
assert.equal(shared.height.selected, null)
const lenient = decodeShareQuery('?mode=feet&h=bogus:1700,female-tan-dress:5:x,female-tan-dress:1700:ok%2Cthen&f=foot-male:999,foot-female:250')
assert.equal(lenient.mode, 'feet')
assert.deepEqual(lenient.height.placements.map((placement) => placement.name), ['ok,then'])
assert.deepEqual(lenient.feet.placements.map((placement) => placement.shape.lengthMm), [footLengthMm(250)])

// Foot shape: typical proportions, locks, toe length moving foot length, and constraints.
const typical = typicalFootShape('male', footLengthMm(270))
assert.deepEqual(typical.locked, [])
assert.equal(typical.toeLengthMm, Math.round(270 * 0.2587))
assert.equal(typical.ballWidthMm, Math.round(270 * 0.3755))
assert.equal(typical.instepHeightMm, Math.round(270 * 0.25))

const longerToes = setFootDimension(typical, 'male', 'toeLength', typical.toeLengthMm + 12)
assert.ok(longerToes.ok)
assert.equal(longerToes.value.lengthMm, 282, 'toe length adds to foot length')
assert.deepEqual(longerToes.value.locked, ['toeLength'])
assert.equal(longerToes.value.ballWidthMm, Math.round(282 * 0.3755), 'unlocked width follows the new length')

const wide = setFootDimension(longerToes.value, 'male', 'ballWidth', 120)
assert.ok(wide.ok)
assert.equal(wide.value.lengthMm, 282, 'width does not move foot length')
assert.deepEqual(wide.value.locked, ['toeLength', 'ballWidth'])

const resized = resizeFoot(wide.value, 'male', footLengthMm(300))
assert.ok(resized.ok)
assert.equal(resized.value.toeLengthMm, typical.toeLengthMm + 12, 'locked toe keeps its millimeters')
assert.equal(resized.value.ballWidthMm, 120, 'locked width keeps its millimeters')
assert.equal(resized.value.instepHeightMm, 75, 'unlocked thickness follows the shoe size')

const resetToes = resetFootDimension(longerToes.value, 'male', 'toeLength')
assert.ok(resetToes.ok)
assert.equal(resetToes.value.lengthMm - resetToes.value.toeLengthMm, 270 - typical.toeLengthMm, 'reset keeps heel-to-ball')
assert.deepEqual(resetToes.value.locked, [])

const tooWide = setFootDimension(typical, 'male', 'ballWidth', 200)
assert.equal(tooWide.ok, false)
assert.equal(!tooWide.ok && tooWide.dimension, 'ballWidth')
const tooLong = setFootDimension(typicalFootShape('male', footLengthMm(375)), 'male', 'toeLength', 120)
assert.equal(!tooLong.ok && tooLong.dimension, 'length', 'toes cannot push a foot past 380 mm')
const lockedThenShrunk = resizeFoot(resized.value, 'male', footLengthMm(221))
assert.equal(!lockedThenShrunk.ok && lockedThenShrunk.dimension, 'toeLength', 'locked toes too long for a small size are reported')
const onlyWide = resizeFoot({ ...resized.value, locked: ['ballWidth'] }, 'male', footLengthMm(221))
assert.equal(!onlyWide.ok && onlyWide.dimension, 'ballWidth', 'a locked width too wide for a small size is reported')

const toeRange = footDimensionEditRange(typical, 'toeLength')
for (const toe of [toeRange.min, toeRange.max]) {
  assert.ok(setFootDimension(typical, 'male', 'toeLength', toe).ok, `toe length ${toe} at the edge of its range is valid`)
}

const shapes = createCompareApp()
shapes.setMode('feet')
const shaped = shapes.placeFoot('foot-female')
assert.ok(shaped.ok)
assert.deepEqual(shapes.setFootDimension(shaped.id, 'toeLength', 70), { ok: true })
assert.deepEqual(shapes.setFootDimension(shaped.id, 'instepHeight', 66), { ok: true })
const shapedFoot = shapes.getState().feet.placements[0].shape
assert.equal(shapedFoot.lengthMm, 242 - Math.round(242 * 0.2609) + 70)
assert.equal(shapes.setFootDimension(shaped.id, 'ballWidth', 5).reason, 'constraint-violated')
assert.equal(shapes.getState().feet.placements[0].shape, shapedFoot, 'a rejected edit leaves the shape alone')
assert.deepEqual(shapes.updateFootSize(shaped.id, { system: 'US', size: 10 }), { ok: true })
assert.equal(shapes.getState().feet.placements[0].shape.toeLengthMm, 70)

// Saved shapes round-trip; version 1 saves migrate to average feet of the saved length.
const savedShapes = parseDocumentJson(serializeDocument(shapes.getState()))
assert.ok(savedShapes.ok)
assert.deepEqual(savedShapes.value.feet.placements[0].shape, shapes.getState().feet.placements[0].shape)
const legacy = JSON.parse(serializeDocument(shapes.getState()))
legacy.version = 1
legacy.feet.placements = legacy.feet.placements.map(({ shape: _shape, ...rest }) => ({ ...rest, footLengthMm: 251 }))
const migrated = parseDocumentJson(JSON.stringify(legacy))
assert.ok(migrated.ok)
assert.equal(migrated.value.version, 2)
assert.deepEqual(migrated.value.feet.placements[0].shape, typicalFootShape('female', footLengthMm(251)))

// Share links carry locked dimensions as tags and keep accepting untagged links.
const shapeQuery = encodeShareQuery(shapes.getState())
assert.match(shapeQuery, /f=foot-female:\d+:t70:i66(&|$)/)
const sharedShapes = decodeShareQuery(`?${shapeQuery}`)
assert.deepEqual(sharedShapes.feet.placements[0].shape, shapes.getState().feet.placements[0].shape)
const oldLink = decodeShareQuery('?mode=feet&f=foot-male:272')
assert.deepEqual(oldLink.feet.placements[0].shape, typicalFootShape('male', footLengthMm(272)))
const junkTags = decodeShareQuery('?mode=feet&f=foot-male:272:x9:t:w999,foot-male:272:w300')
assert.deepEqual(junkTags.feet.placements.map((placement) => placement.shape.locked), [[]], 'bad tags are ignored and impossible shapes skipped')

// The lineup spaces people by their scaled footprints, so ten 10-foot people never overlap.
const giants = createCompareApp()
for (let index = 0; index < 10; index += 1) {
  const placed = giants.placeHuman(HUMAN_CATALOG[index % HUMAN_CATALOG.length].id)
  assert.ok(placed.ok)
  assert.deepEqual(giants.updateHumanHeight(placed.id, { unit: 'ftin', feet: 10, inches: 0 }), { ok: true })
}
const giantLineup = humanLineupX(giants.getState().height.placements)
const spans = giants.getState().height.placements
  .map((placement) => {
    const entry = HUMAN_CATALOG.find((candidate) => candidate.id === placement.catalogId)
    const growth = averageLandmarks(entry.sex, placement.heightMm).armLength / averageLandmarks(entry.sex, entry.referenceHeightMm).armLength
    const half = (entry.footprintWidthMm / 2000) * growth
    const x = giantLineup.get(placement.id)
    return [x - half, x + half]
  })
  .sort((a, b) => a[0] - b[0])
for (let index = 1; index < spans.length; index += 1) {
  assert.ok(spans[index][0] - spans[index - 1][1] >= 0.149, 'neighbors keep their gap at 10 feet')
}
assert.equal(giantLineup.get(giants.getState().height.placements[0].id), 0, 'the first person stands at the center')

// Stature allometry: landmarks stay in anatomical order from 0.9 to 3.05 m, the
// head shrinks and the legs lengthen relative to stature as people get taller,
// and a person's own proportions carry over while stature lands exactly.
for (const sex of ['female', 'male']) {
  let previous = null
  for (let stature = 900; stature <= 3048; stature += 37) {
    const average = averageLandmarks(sex, stature)
    for (let index = 1; index < LANDMARK_HEIGHT_ORDER.length; index += 1) {
      assert.ok(
        average[LANDMARK_HEIGHT_ORDER[index]] > average[LANDMARK_HEIGHT_ORDER[index - 1]],
        `${sex} ${stature} mm: ${LANDMARK_HEIGHT_ORDER[index]} sits above ${LANDMARK_HEIGHT_ORDER[index - 1]}`,
      )
    }
    if (previous) {
      for (const landmark of BODY_LANDMARKS) {
        assert.ok(average[landmark] > previous[landmark], `${sex}: ${landmark} grows with stature`)
      }
      assert.ok((stature - average.ear) / stature < (previous.stature - previous.ear) / previous.stature, `${sex}: head shrinks relative to stature`)
      assert.ok(average.crotch / stature > previous.crotch / previous.stature, `${sex}: legs lengthen relative to stature`)
    }
    previous = average
  }
  const authored = { ...averageLandmarks(sex, 1700), knee: averageLandmarks(sex, 1700).knee * 1.04 }
  assert.deepEqual(statureTargets(sex, authored, 1700), authored, 'targets at the authored stature are the authored landmarks')
  const tall = statureTargets(sex, authored, 3048)
  assert.ok(Math.abs(tall.stature - 3048) < 1e-9, 'stature lands exactly')
  const tallAverage = averageLandmarks(sex, 3048)
  assert.ok(Math.abs(tall.knee / tallAverage.knee - 1.04) < 1e-9, 'a long-shinned person stays long-shinned')
}

console.log('Domain verification passed: units, charts, cap, dual worlds, names, updates, foot shapes, stature allometry, persistence with migration, and share links.')
