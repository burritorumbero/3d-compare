import type { PlacementId } from './ids.ts'

export type PlaceResult =
  | { ok: true; id: PlacementId }
  | { ok: false; reason: 'cap-reached' }

export type UpdateResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'out-of-range' }

/** A foot edit that would break a shape constraint names the dimension at fault. */
export type FootUpdateResult =
  | UpdateResult
  | { ok: false; reason: 'constraint-violated'; dimension: string; message: string }
