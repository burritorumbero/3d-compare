import type { ModelAsset } from '../../domain/catalog.ts'
import { loadBrowserKernel } from '../../kernel/browser.ts'
import { assertFootRig } from '../../kernel/foot.ts'
import { RigSolver, type RigFile } from '../../kernel/index.ts'
import { rigUrl } from '../models.ts'

/** Solvers for both feet of a pair; the left one is solved, the right one mirrors its controls. */
export type FeetRig = {
  left: RigSolver
  right: RigSolver
}

type Entry =
  | { status: 'pending'; promise: Promise<void> }
  | { status: 'ready'; value: FeetRig }
  | { status: 'failed'; error: unknown }

const cache = new Map<string, Entry>()

async function load(url: string): Promise<FeetRig> {
  const [file] = await Promise.all([
    fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${url}: ${response.status}`)
      }
      return response.json() as Promise<{ version: 1; rigs: readonly RigFile[] }>
    }),
    loadBrowserKernel(),
  ])
  const [left, right] = ['LeftFootAndShin', 'RightFootAndShin'].map((mesh) => {
    const rig = file.rigs.find((candidate) => candidate.mesh === mesh)
    if (!rig) {
      throw new Error(`${url} has no rig for ${mesh}.`)
    }
    const solver = new RigSolver(rig)
    assertFootRig(solver)
    return solver
  })
  return { left, right }
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

/** Starts loading the kernel and a pair's rig before anything needs it. */
export function preloadFeetRig(asset: ModelAsset): void {
  entry(asset)
}

/**
 * Suspends until the kernel and the pair's rig file are ready. Solvers are
 * shared by every placement of the model, like its geometry.
 */
export function useFeetRig(asset: ModelAsset): FeetRig {
  const found = entry(asset)
  if (found.status === 'pending') {
    throw found.promise
  }
  if (found.status === 'failed') {
    throw found.error
  }

  return found.value
}
