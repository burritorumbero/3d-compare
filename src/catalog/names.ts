import type { HumanCatalogId } from '../domain/catalog.ts'
import { humanEntry } from './humans.ts'

/** The label a person shows on stage and in lists: their custom name, else the catalog label. */
export function humanDisplayName(placement: { catalogId: HumanCatalogId; name?: string }): string {
  return placement.name ?? humanEntry(placement.catalogId).label
}
