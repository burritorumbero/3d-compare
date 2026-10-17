import wasmUrl from './pkg/kernel_bg.wasm?url'
import { loadKernel } from './index.ts'

/** Loads the kernel from the fingerprinted asset Vite emits for the wasm file. */
export function loadBrowserKernel(): Promise<void> {
  return loadKernel(wasmUrl)
}
