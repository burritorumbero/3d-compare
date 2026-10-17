import { footEntry } from '../catalog/feet.ts'
import { FOOT_CATALOG_IDS, HUMAN_CATALOG_IDS } from '../domain/catalog.ts'
import { emptyDocument, type CompareDocument, type Mode } from '../domain/document.ts'
import { placeFoot } from '../domain/feet-world.ts'
import { FOOT_DIMENSIONS, footDimensionMm, resizeFoot, type FootDimension } from '../domain/foot-shape.ts'
import { placeHuman } from '../domain/height-world.ts'
import { mintPlacementId } from '../domain/ids.ts'
import {
  FOOT_LENGTH_MM_MAX,
  FOOT_LENGTH_MM_MIN,
  HEIGHT_MM_MAX,
  HEIGHT_MM_MIN,
  footLengthMm,
  heightMm,
  type LengthUnit,
} from '../domain/measure.ts'
import type { ShoeSystem } from '../domain/shoe-charts.ts'

/**
 * A scene travels in the query string so a link reproduces it anywhere:
 *
 *   ?mode=height&unit=cm&shoe=US
 *     &h=female-tan-dress:1700:Ari,male-pale-trousers-shirt:1850:Dad
 *     &f=foot-female:242,foot-male:281:t81:w110
 *
 * Placements list catalog id, size in millimeters, and (for people) a custom
 * name. Feet add each locked dimension in millimeters with a one-letter tag
 * (t toe length, w foot width, i foot thickness); unlocked ones follow foot
 * length, so links stay short and older links without tags still open. Poses are
 * recomputed from order.
 */
export const SHARE_KEYS = ['mode', 'unit', 'shoe', 'h', 'f'] as const

export function encodeShareQuery(document: CompareDocument): string {
  const parts = [`mode=${document.mode}`, `unit=${document.heightUnit}`, `shoe=${document.shoeSystem}`]
  if (document.height.placements.length > 0) {
    const people = document.height.placements.map((placement) =>
      [placement.catalogId, placement.heightMm, encodeURIComponent(placement.name ?? '')]
        .join(':')
        .replace(/:$/, ''),
    )
    parts.push(`h=${people.join(',')}`)
  }
  if (document.feet.placements.length > 0) {
    const feet = document.feet.placements.map((placement) =>
      [
        placement.catalogId,
        placement.shape.lengthMm,
        ...placement.shape.locked.map(
          (dimension) => `${DIMENSION_TAGS[dimension]}${footDimensionMm(placement.shape, dimension)}`,
        ),
      ].join(':'),
    )
    parts.push(`f=${feet.join(',')}`)
  }

  return parts.join('&')
}

const DIMENSION_TAGS: Record<FootDimension, string> = {
  toeLength: 't',
  ballWidth: 'w',
  instepHeight: 'i',
}

/** Reads `t81`-style tags into locked dimensions. Unknown or malformed tags are ignored. */
function lockedDimensions(tags: readonly string[]): Partial<Record<FootDimension, number>> {
  const values: Partial<Record<FootDimension, number>> = {}
  for (const tag of tags) {
    const dimension = FOOT_DIMENSIONS.find((candidate) => DIMENSION_TAGS[candidate] === tag[0])
    const value = integerInRange(tag.slice(1), 1, FOOT_LENGTH_MM_MAX)
    if (dimension && value !== null) {
      values[dimension] = value
    }
  }

  return values
}

export function shareUrl(document: CompareDocument, base: string): string {
  return `${base}?${encodeShareQuery(document)}`
}

/** Keeps percent-escapes intact so ',' and ':' inside names survive the split. */
function rawParams(query: string): Map<string, string> {
  const params = new Map<string, string>()
  for (const pair of query.replace(/^\?/, '').split('&')) {
    if (!pair) {
      continue
    }

    const separator = pair.indexOf('=')
    const key = separator === -1 ? pair : pair.slice(0, separator)
    const value = separator === -1 ? '' : pair.slice(separator + 1)
    params.set(key, value)
  }

  return params
}

function decodePart(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return ''
  }
}

function integerInRange(raw: string | undefined, min: number, max: number): number | null {
  const value = Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : null
}

export function isShareQuery(query: string): boolean {
  const params = rawParams(query)
  return SHARE_KEYS.some((key) => params.has(key))
}

/** Rebuilds a document from a share link. Unknown or out-of-range entries are skipped. */
export function decodeShareQuery(query: string): CompareDocument | null {
  const params = rawParams(query)
  if (!SHARE_KEYS.some((key) => params.has(key))) {
    return null
  }

  const mode: Mode = params.get('mode') === 'feet' ? 'feet' : 'height'
  const heightUnit: LengthUnit = params.get('unit') === 'cm' ? 'cm' : 'ftin'
  const shoeSystem: ShoeSystem = params.get('shoe') === 'EU' ? 'EU' : 'US'
  let height = emptyDocument().height
  let feet = emptyDocument().feet

  for (const token of (params.get('h') ?? '').split(',')) {
    const [rawId, rawMm, rawName] = token.split(':')
    const catalogId = HUMAN_CATALOG_IDS.find((id) => id === rawId)
    const mm = integerInRange(rawMm, HEIGHT_MM_MIN, HEIGHT_MM_MAX)
    if (!catalogId || mm === null) {
      continue
    }

    const change = placeHuman(height, mintPlacementId(), catalogId, heightMm(mm), decodePart(rawName ?? ''))
    if (!change.result.ok) {
      break
    }
    height = change.world
  }

  for (const token of (params.get('f') ?? '').split(',')) {
    const [rawId, rawMm, ...tags] = token.split(':')
    const catalogId = FOOT_CATALOG_IDS.find((id) => id === rawId)
    const mm = integerInRange(rawMm, FOOT_LENGTH_MM_MIN, FOOT_LENGTH_MM_MAX)
    if (!catalogId || mm === null) {
      continue
    }

    const locks = lockedDimensions(tags)
    const locked = FOOT_DIMENSIONS.filter((dimension) => locks[dimension] !== undefined)
    const shaped = resizeFoot(
      {
        lengthMm: footLengthMm(mm),
        toeLengthMm: locks.toeLength ?? 0,
        ballWidthMm: locks.ballWidth ?? 0,
        instepHeightMm: locks.instepHeight ?? 0,
        locked,
      },
      footEntry(catalogId).sex,
      footLengthMm(mm),
    )
    if (!shaped.ok) {
      continue
    }

    const placed = placeFoot(feet, mintPlacementId(), catalogId, shaped.value)
    if (!placed.result.ok) {
      break
    }
    feet = placed.world
  }

  return {
    version: 2,
    mode,
    heightUnit,
    shoeSystem,
    height: { ...height, selected: null, cameraIntent: { kind: 'none' } },
    feet: { ...feet, selected: null, cameraIntent: { kind: 'none' } },
  }
}
