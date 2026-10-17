import type { FootCatalogId } from './catalog.ts'

/** Appearance presets; these affect color only, never foot shape or measurements. */
export const FOOT_SKIN_TONES = ['white', 'black', 'hispanic', 'asian'] as const
export type FootSkinTone = (typeof FOOT_SKIN_TONES)[number]

export const FOOT_SKIN_PRESETS: Record<FootSkinTone, { label: string; color: string }> = {
  white: { label: 'White', color: '#e6c2a6' },
  black: { label: 'Black', color: '#704b36' },
  hispanic: { label: 'Hispanic', color: '#c7936f' },
  asian: { label: 'Asian', color: '#d9b489' },
}

export function isFootSkinTone(value: unknown): value is FootSkinTone {
  return FOOT_SKIN_TONES.some((tone) => tone === value)
}

/** Older saves and links keep the original appearance of each authored asset. */
export function defaultFootSkinTone(catalogId: FootCatalogId): FootSkinTone {
  return catalogId === 'foot-female' ? 'hispanic' : 'white'
}
