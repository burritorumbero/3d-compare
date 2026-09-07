import type { Sex } from './catalog.ts'
import { footLengthMm, type FootLengthMm, type ParseResult } from './measure.ts'

export type ShoeSystem = 'US' | 'EU'

export type ShoeSpec =
  | { system: 'US'; size: number }
  | { system: 'EU'; size: number }

export type MondopointRow = {
  size: number
  mm: FootLengthMm
}

function rows(values: readonly (readonly [number, number])[]): readonly MondopointRow[] {
  return values.map(([size, mm]) => ({ size, mm: footLengthMm(mm) }))
}

export const US_MEN_MONDOPOINT = rows([
  [4, 221],
  [4.5, 225],
  [5, 229],
  [5.5, 233],
  [6, 238],
  [6.5, 242],
  [7, 246],
  [7.5, 250],
  [8, 255],
  [8.5, 259],
  [9, 263],
  [9.5, 267],
  [10, 272],
  [10.5, 276],
  [11, 280],
  [11.5, 284],
  [12, 289],
  [12.5, 293],
  [13, 297],
  [13.5, 301],
  [14, 306],
  [14.5, 310],
  [15, 314],
  [15.5, 318],
  [16, 323],
  [16.5, 327],
  [17, 331],
  [17.5, 336],
  [18, 340],
  [18.5, 344],
  [19, 348],
  [19.5, 353],
  [20, 357],
  [20.5, 361],
  [21, 365],
  [21.5, 370],
  [22, 374],
])

export const US_WOMEN_MONDOPOINT = rows([
  [4, 208],
  [4.5, 212],
  [5, 217],
  [5.5, 221],
  [6, 225],
  [6.5, 229],
  [7, 234],
  [7.5, 238],
  [8, 242],
  [8.5, 246],
  [9, 251],
  [9.5, 255],
  [10, 259],
  [10.5, 263],
  [11, 268],
  [11.5, 272],
  [12, 276],
  [12.5, 280],
  [13, 285],
  [13.5, 289],
  [14, 293],
  [14.5, 297],
  [15, 301],
  [15.5, 306],
  [16, 310],
  [16.5, 314],
  [17, 318],
  [17.5, 323],
  [18, 327],
  [18.5, 331],
  [19, 335],
  [19.5, 340],
  [20, 344],
])

export const EU_MONDOPOINT = rows([
  [34, 217],
  [35, 223],
  [36, 230],
  [37, 237],
  [38, 243],
  [39, 250],
  [40, 257],
  [41, 263],
  [42, 270],
  [43, 277],
  [44, 283],
  [45, 290],
  [46, 297],
  [47, 303],
  [48, 310],
  [49, 317],
  [50, 323],
  [51, 330],
  [52, 336],
  [53, 343],
  [54, 350],
  [55, 356],
  [56, 363],
  [57, 370],
  [58, 376],
])

export function shoeRows(system: ShoeSystem, sex: Sex): readonly MondopointRow[] {
  if (system === 'EU') {
    return EU_MONDOPOINT
  }

  return sex === 'female' ? US_WOMEN_MONDOPOINT : US_MEN_MONDOPOINT
}

export function parseShoeSpec(spec: ShoeSpec, sex: Sex): ParseResult<FootLengthMm> {
  const row = shoeRows(spec.system, sex).find(
    (candidate) => Math.abs(candidate.size - spec.size) < 0.001,
  )
  if (!row) {
    return { ok: false, message: `Choose a supported ${spec.system} adult size.` }
  }

  return { ok: true, value: row.mm }
}

export function formatShoe(value: FootLengthMm, system: ShoeSystem, sex: Sex): string {
  const nearest = shoeRows(system, sex).reduce((best, row) =>
    Math.abs(row.mm - value) < Math.abs(best.mm - value) ? row : best,
  )
  return `${system} ${nearest.size}`
}
