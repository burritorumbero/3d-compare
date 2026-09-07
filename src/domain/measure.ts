declare const heightMmBrand: unique symbol
export type HeightMm = number & { readonly [heightMmBrand]: 'HeightMm' }

declare const footLengthMmBrand: unique symbol
export type FootLengthMm = number & { readonly [footLengthMmBrand]: 'FootLengthMm' }

export type LengthUnit = 'cm' | 'ftin'

export type HeightSpec =
  | { unit: 'cm'; value: number }
  | { unit: 'ftin'; feet: number; inches: number }

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string }

export const HEIGHT_MM_MIN = 900
export const HEIGHT_MM_MAX = 2300
export const FOOT_LENGTH_MM_MIN = 200
export const FOOT_LENGTH_MM_MAX = 380

export function heightMm(value: number): HeightMm {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Height must be a positive number.')
  }

  return Math.round(value) as HeightMm
}

export function footLengthMm(value: number): FootLengthMm {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Foot length must be a positive number.')
  }

  return Math.round(value) as FootLengthMm
}

export function parseHeightSpec(spec: HeightSpec): ParseResult<HeightMm> {
  const rawMm =
    spec.unit === 'cm'
      ? spec.value * 10
      : (spec.feet * 12 + spec.inches) * 25.4

  if (
    !Number.isFinite(rawMm) ||
    (spec.unit === 'ftin' &&
      (!Number.isInteger(spec.feet) || spec.feet < 0 || spec.inches < 0 || spec.inches >= 12))
  ) {
    return { ok: false, message: 'Enter a valid height.' }
  }

  const roundedMm = Math.round(rawMm)
  if (roundedMm < HEIGHT_MM_MIN || roundedMm > HEIGHT_MM_MAX) {
    return { ok: false, message: 'Height must be between 90 and 230 cm.' }
  }

  return { ok: true, value: heightMm(roundedMm) }
}

export function formatHeight(value: HeightMm, unit: LengthUnit): string {
  if (unit === 'cm') {
    const centimeters = value / 10
    return `${Number.isInteger(centimeters) ? centimeters : centimeters.toFixed(1)} cm`
  }

  const roundedQuarterInches = Math.round((value / 25.4) * 4) / 4
  let feet = Math.floor(roundedQuarterInches / 12)
  let inches = roundedQuarterInches - feet * 12
  if (inches === 12) {
    feet += 1
    inches = 0
  }

  return `${feet}′ ${Number.isInteger(inches) ? inches : inches.toFixed(2).replace(/0$/, '')}″`
}

export function heightScale(reference: HeightMm, target: HeightMm): number {
  return target / reference
}

export function footScale(reference: FootLengthMm, target: FootLengthMm): number {
  return target / reference
}
