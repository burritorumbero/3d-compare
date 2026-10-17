import type { ModelAsset } from '../domain/catalog.ts'
import { loadBrowserKernel } from '../kernel/browser.ts'
import { RigSolver, type RigFile } from '../kernel/index.ts'
import { rigUrl } from './models.ts'

/** A model's rig file: one rig per independently solved part (a person, or each foot of a pair). */
type RigFileJson = { version: 1; rigs: readonly RigFile[] }

type Entry =
  | { status: 'pending'; promise: Promise<void> }
  | { status: 'ready'; value: readonly RigSolver[] }
  | { status: 'failed'; error: unknown }

const cache = new Map<string, Entry>()

async function load(url: string): Promise<readonly RigSolver[]> {
  const [file] = await Promise.all([
    fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${url}: ${response.status}`)
      }
      return response.json() as Promise<RigFileJson>
    }),
    loadBrowserKernel(),
  ])
  if (file.version !== 1 || file.rigs.length === 0) {
    throw new Error(`${url} is not a version 1 rig file with rigs.`)
  }
  return file.rigs.map((rig) => new RigSolver(rig))
}

function entry(asset: ModelAsset): Entry {
  const url = rigUrl(asset)
  let found = cache.get(url)
  if (!found) {
    const promise = load(url).then(
      (value) => void cache.set(url, { status: 'ready', value }),
      (error: unknown) => void cache.set(url, { status: 'failed', error }),
    )
    found = { status: 'pending', promise }
    cache.set(url, found)
  }

  return found
}

/** Starts loading the kernel and a model's rig file before anything needs them. */
export function preloadRig(asset: ModelAsset): void {
  entry(asset)
}

/**
 * Suspends until the kernel and the model's rig file are ready, then returns a
 * solver per rig, in file order. Solvers are shared by every placement.
 */
export function useRigSolvers(asset: ModelAsset): readonly RigSolver[] {
  const found = entry(asset)
  if (found.status === 'pending') {
    throw found.promise
  }
  if (found.status === 'failed') {
    throw found.error
  }

  return found.value
}

/** The solver for the rig that deforms the named mesh. */
export function solverFor(solvers: readonly RigSolver[], mesh: string): RigSolver {
  const solver = solvers.find((candidate) => candidate.rig.mesh === mesh)
  if (!solver) {
    throw new Error(`No rig deforms ${mesh}.`)
  }
  return solver
}
