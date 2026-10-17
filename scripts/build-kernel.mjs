// Builds the Rust parametric kernel to WebAssembly and generates its JS
// bindings in src/kernel/pkg. Cargo skips work when nothing changed, so the
// dev, build, and verify scripts run this every time.
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const kernel = `${root}kernel`
const outDir = `${root}src/kernel/pkg`
const wasm = `${kernel}/target/wasm32-unknown-unknown/release/parametric_kernel.wasm`

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error?.code === 'ENOENT') {
    return { missing: true }
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
  return { missing: false }
}

function fail(lines) {
  console.error(lines.join('\n'))
  process.exit(1)
}

const expected = readFileSync(`${kernel}/Cargo.toml`, 'utf8').match(/wasm-bindgen = "=([\d.]+)"/)?.[1]
const version = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' })
if (version.error?.code === 'ENOENT' || !version.stdout.includes(expected)) {
  fail([
    `The kernel needs wasm-bindgen-cli ${expected}${version.stdout ? `, but found ${version.stdout.trim()}` : ''}.`,
    '',
    `  cargo install wasm-bindgen-cli --version ${expected} --locked`,
  ])
}

// rust-toolchain.toml in kernel/ selects the pinned Rust and installs the wasm target.
if (run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: kernel }).missing) {
  fail(['The kernel needs Rust. Install it from https://rustup.rs, then run this again.'])
}

run('wasm-bindgen', ['--target', 'web', '--out-dir', outDir, '--out-name', 'kernel', wasm])
const bytes = statSync(`${outDir}/kernel_bg.wasm`).size
console.log(`Kernel built: src/kernel/pkg/kernel_bg.wasm (${(bytes / 1024).toFixed(1)} kB).`)
