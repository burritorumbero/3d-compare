import { footEntry } from '../catalog/feet.ts'
import { humanEntry } from '../catalog/humans.ts'
import type { FootCatalogId, HumanCatalogId } from '../domain/catalog.ts'
import { emptyDocument, type CompareDocument, type Mode } from '../domain/document.ts'
import {
  placeFoot as addFoot,
  removeFoot,
  repositionFoot,
  saveFeetNav,
  selectFoot,
  setFeetCameraIntent,
  setFeetNavMode as changeFeetNavMode,
  updateFootLength,
} from '../domain/feet-world.ts'
import {
  placeHuman as addHuman,
  removeHuman,
  renameHuman as changeHumanName,
  repositionHuman,
  saveHeightNav,
  selectHuman,
  setHeightCameraIntent,
  updateHumanHeight as changeHumanHeight,
} from '../domain/height-world.ts'
import { mintPlacementId, type PlacementId } from '../domain/ids.ts'
import type { PlanarDelta } from '../domain/layout.ts'
import {
  parseHeightSpec,
  type HeightSpec,
  type LengthUnit,
} from '../domain/measure.ts'
import type {
  FeetCameraIntent,
  FeetNavMode,
  FeetNavSnapshot,
  HeightCameraIntent,
  HeightNavSnapshot,
} from '../domain/navigation.ts'
import { parseDocumentJson, serializeDocument } from '../domain/persist.ts'
import type { PlaceResult, UpdateResult } from '../domain/results.ts'
import {
  parseShoeSpec,
  type ShoeSpec,
  type ShoeSystem,
} from '../domain/shoe-charts.ts'

export type CompareAppOptions = {
  persistKey?: string
  /** Starts from this document instead of the persisted one, and persists it right away. */
  initialDocument?: CompareDocument
}

export type CompareApp = {
  getState(): CompareDocument
  subscribe(listener: () => void): () => void
  setMode(mode: Mode): void
  setHeightUnit(unit: LengthUnit): void
  setShoeSystem(system: ShoeSystem): void
  placeHuman(catalogId: HumanCatalogId): PlaceResult
  placeFoot(catalogId: FootCatalogId): PlaceResult
  updateHumanHeight(id: PlacementId, spec: HeightSpec): UpdateResult
  renameHuman(id: PlacementId, name: string): UpdateResult
  updateFootSize(id: PlacementId, spec: ShoeSpec): UpdateResult
  select(id: PlacementId | null): void
  remove(id: PlacementId): void
  reposition(id: PlacementId, delta: PlanarDelta): UpdateResult
  setFeetNavMode(mode: FeetNavMode): void
  frameSelection(): void
  resetView(): void
}

export type NavRig = {
  consumeHeightIntent(): HeightCameraIntent
  consumeFeetIntent(): FeetCameraIntent
  commitHeightSnapshot(snapshot: HeightNavSnapshot): void
  commitFeetSnapshot(snapshot: FeetNavSnapshot): void
}

const navRigs = new WeakMap<CompareApp, NavRig>()

function persistedDocument(persistKey: string | undefined): CompareDocument {
  if (!persistKey || typeof localStorage === 'undefined') {
    return emptyDocument()
  }

  try {
    const raw = localStorage.getItem(persistKey)
    if (!raw) {
      return emptyDocument()
    }

    const parsed = parseDocumentJson(raw)
    return parsed.ok ? parsed.value : emptyDocument()
  } catch {
    return emptyDocument()
  }
}

function persist(persistKey: string | undefined, document: CompareDocument): void {
  if (!persistKey || typeof localStorage === 'undefined') {
    return
  }

  try {
    localStorage.setItem(persistKey, serializeDocument(document))
  } catch {
    // Storage can be unavailable in private browsing. The in-memory document still works.
  }
}

export function createCompareApp(options: CompareAppOptions = {}): CompareApp {
  let state = options.initialDocument ?? persistedDocument(options.persistKey)
  if (options.initialDocument) {
    persist(options.persistKey, state)
  }
  const listeners = new Set<() => void>()

  function publish(next: CompareDocument): void {
    if (Object.is(next, state)) {
      return
    }

    state = next
    persist(options.persistKey, state)
    listeners.forEach((listener) => listener())
  }

  const app: CompareApp = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setMode(mode) {
      if (mode === state.mode) {
        return
      }

      const next =
        mode === 'height' && state.height.savedNav
          ? {
              ...state,
              mode,
              height: setHeightCameraIntent(state.height, {
                kind: 'restore',
                snapshot: state.height.savedNav,
              }),
            }
          : mode === 'feet' && state.feet.savedNav
            ? {
                ...state,
                mode,
                feet: setFeetCameraIntent(state.feet, {
                  kind: 'restore',
                  snapshot: state.feet.savedNav,
                }),
              }
            : { ...state, mode }
      publish(next)
    },
    setHeightUnit(heightUnit) {
      publish(heightUnit === state.heightUnit ? state : { ...state, heightUnit })
    },
    setShoeSystem(shoeSystem) {
      publish(shoeSystem === state.shoeSystem ? state : { ...state, shoeSystem })
    },
    placeHuman(catalogId) {
      const entry = humanEntry(catalogId)
      const change = addHuman(
        state.height,
        mintPlacementId(),
        catalogId,
        entry.referenceHeightMm,
      )
      if (change.world !== state.height) {
        publish({ ...state, height: change.world })
      }
      return change.result
    },
    placeFoot(catalogId) {
      const entry = footEntry(catalogId)
      const change = addFoot(
        state.feet,
        mintPlacementId(),
        catalogId,
        entry.defaultFootLengthMm,
      )
      if (change.world !== state.feet) {
        publish({ ...state, feet: change.world })
      }
      return change.result
    },
    updateHumanHeight(id, spec) {
      const parsed = parseHeightSpec(spec)
      if (!parsed.ok) {
        return { ok: false, reason: 'out-of-range' }
      }

      const change = changeHumanHeight(state.height, id, parsed.value)
      if (change.world !== state.height) {
        publish({ ...state, height: change.world })
      }
      return change.result
    },
    renameHuman(id, name) {
      const change = changeHumanName(state.height, id, name)
      if (change.world !== state.height) {
        publish({ ...state, height: change.world })
      }
      return change.result
    },
    updateFootSize(id, spec) {
      const placement = state.feet.placements.find((candidate) => candidate.id === id)
      if (!placement) {
        return { ok: false, reason: 'not-found' }
      }

      const parsed = parseShoeSpec(spec, footEntry(placement.catalogId).sex)
      if (!parsed.ok) {
        return { ok: false, reason: 'out-of-range' }
      }

      const change = updateFootLength(state.feet, id, parsed.value)
      if (change.world !== state.feet) {
        publish({ ...state, feet: change.world })
      }
      return change.result
    },
    select(id) {
      if (state.mode === 'height') {
        const height = selectHuman(state.height, id)
        publish(height === state.height ? state : { ...state, height })
      } else {
        const feet = selectFoot(state.feet, id)
        publish(feet === state.feet ? state : { ...state, feet })
      }
    },
    remove(id) {
      if (state.mode === 'height') {
        const height = removeHuman(state.height, id)
        publish(height === state.height ? state : { ...state, height })
      } else {
        const feet = removeFoot(state.feet, id)
        publish(feet === state.feet ? state : { ...state, feet })
      }
    },
    reposition(id, delta) {
      if (state.mode === 'height') {
        const change = repositionHuman(state.height, id, delta)
        if (change.world !== state.height) {
          publish({ ...state, height: change.world })
        }
        return change.result
      }

      const change = repositionFoot(state.feet, id, delta)
      if (change.world !== state.feet) {
        publish({ ...state, feet: change.world })
      }
      return change.result
    },
    setFeetNavMode(mode) {
      const feet = changeFeetNavMode(state.feet, mode)
      publish(feet === state.feet ? state : { ...state, feet })
    },
    frameSelection() {
      if (state.mode === 'height') {
        publish({
          ...state,
          height: setHeightCameraIntent(state.height, { kind: 'frame-selection' }),
        })
      } else {
        publish({
          ...state,
          feet: setFeetCameraIntent(state.feet, { kind: 'frame-selection' }),
        })
      }
    },
    resetView() {
      if (state.mode === 'height') {
        publish({ ...state, height: setHeightCameraIntent(state.height, { kind: 'reset' }) })
      } else {
        publish({ ...state, feet: setFeetCameraIntent(state.feet, { kind: 'reset' }) })
      }
    },
  }

  navRigs.set(app, {
    consumeHeightIntent() {
      const intent = state.height.cameraIntent
      if (intent.kind !== 'none') {
        publish({
          ...state,
          height: setHeightCameraIntent(state.height, { kind: 'none' }),
        })
      }
      return intent
    },
    consumeFeetIntent() {
      const intent = state.feet.cameraIntent
      if (intent.kind !== 'none') {
        publish({
          ...state,
          feet: setFeetCameraIntent(state.feet, { kind: 'none' }),
        })
      }
      return intent
    },
    commitHeightSnapshot(snapshot) {
      publish({ ...state, height: saveHeightNav(state.height, snapshot) })
    },
    commitFeetSnapshot(snapshot) {
      publish({ ...state, feet: saveFeetNav(state.feet, snapshot) })
    },
  })

  return app
}

export function attachNavRig(app: CompareApp): NavRig {
  const rig = navRigs.get(app)
  if (!rig) {
    throw new Error('Navigation rig requires an app created by createCompareApp.')
  }

  return rig
}
