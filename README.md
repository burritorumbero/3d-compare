# 3D Compare

3D Compare is a browser tool for seeing size differences at true relative scale. Build a lineup of people by height, or compare adult foot lengths by shoe size.

## Requirements

- Node.js 22.12 or newer. The toolchain (Vite 8 on Rolldown, oxlint, and the built-in TypeScript type stripping the verification scripts use) does not run on Node.js 18 or 20.
- npm 10 or newer.
- Rust through [rustup](https://rustup.rs) and `wasm-bindgen-cli` 0.2.129 for the parametric kernel. `kernel/rust-toolchain.toml` pins Rust 1.99.1 with the WebAssembly target, and rustup installs it on first use without changing your default toolchain. Install the bindings generator once with `cargo install wasm-bindgen-cli --version 0.2.129 --locked`.

`.nvmrc` pins the major version, so `nvm install 22 && nvm use` selects a supported release. `.npmrc` sets `engine-strict=true`, so `npm install` on an unsupported Node.js stops with an "Unsupported engine" error instead of installing packages that fail later. The `dev`, `build`, `preview`, and `verify:*` scripts run the same check before starting.

If you see this when starting the dev server, your shell is on an old Node.js:

```
SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'
```

Switch to Node.js 22, delete `node_modules`, and run `npm install` again.

## Run the app

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

## Comparison modes

### Height

Add up to 10 textured human models to an open concrete floor. Choose among three female and three male people with different skin tones and outfits. Set each height from 90 cm to 10 ft (304.8 cm) in feet and inches or centimeters, and give each person a name of your own. The lineup spaces people by their size, so very tall people never overlap. Everyone stands on one line so perspective does not bias the comparison.

Drag to orbit, scroll to zoom, and right-drag to pan.

### Feet

Place pairs of female and male feet, cut at mid-shin, on a centimeter table. Choose an adult US or EU shoe size: US women's 4 to 20, US men's 4 to 22, or EU 34 to 58. 3D Compare maps the size to foot length.

Each pair also has three shape dimensions in millimeters: **toe length**, **foot width** (across the ball of the foot), and **foot thickness** (instep height at mid-foot). Until you set one, it follows the adult average for the foot length, from the ANSUR II survey. Setting one locks it, so it keeps its value when the shoe size changes; **Reset** returns it to the average. Toe length is part of foot length, so longer toes make a longer foot and a larger shoe size. Values outside the 1st to 99th percentile of adults are flagged.

Use **Orbit** to rotate around the table. Use **Inspect** for table-plane panning and close zoom.

### Stage controls

Tap or click a model to show its info block; only the selected model shows one. **Frame** centers the camera on the selection and **Reset** returns to the default view. **Full screen** expands the 3D stage to the whole screen (Esc leaves it). **Share** copies a link that reproduces the current lineup, names, sizes, and units for anyone who opens it. The stage sizes itself to the device: it fills the workspace on laptops and takes a fixed share of the screen on tablets and phones.

### Share links

A share link carries the scene in its query string, for example `?mode=height&unit=cm&shoe=US&h=female-tan-dress:1700:Ari&f=foot-male:281:t81:w110`. Feet list their foot length and then each locked dimension in millimeters (`t` toe length, `w` foot width, `i` foot thickness). Opening one replaces the saved workspace with the shared lineup and then clears the query from the address bar.

## 3D models

The models in `public/models` are glTF binaries in meters, Y up, facing +Z, with embedded textures.

- **People.** The six people are CC0 static meshes adapted from MakeHuman Community assets.
- **Feet.** The two pairs of feet are built from the Daz 3D Genesis 9 characters Laura and Matt. Each foot carries `_DEFORM_WEIGHTS` (shin, foot and toes, derived from Genesis 9's bone weights), and a `*.rig.json` ships next to each pair for the parametric kernel.
- **Records.** `public/models/ASSET_LICENSES.md` records provenance and licensing, and `public/models/manifest.json` describes each file.

### Rebuilding the feet

`npm run assets:feet` rebuilds the feet from a local Daz library. It needs Blender 4.2 or newer with the Diffeomorphic DAZ importer. Set `BLENDER_BIN` and `DAZ_LIBRARY` if they aren't at the macOS defaults. The script runs `tools/assets/build_feet.py` headless, then writes the rig files.

Scale is exact by construction. Each human is scaled uniformly from the stature of its authored mesh, measured from sole to skull top with hair excluded. Each pair of feet is rigged: for every change of shoe size, toe length, width or thickness, the WebAssembly kernel solves the bone scales that make the foot measure exactly those dimensions, and three.js skins the mesh with them. Toes, forefoot and arch deform separately, and the shin stays fixed. The checks prove the result within 0.1 mm, both in the kernel and through the app's own skinning code. Parametric proportions for people are planned in `.design/PARAMETRIC_PLAN.md`. `src/catalog` holds those reference sizes and `npm run verify:models` re-measures the GLB files to catch drift.

Models load on demand and are cached per file, so ten copies of one person download it once. Each human decodes to roughly 40 MB of GPU textures, so a full lineup of all six people uses about 240 MB of graphics memory.

## Parametric kernel

`kernel/` is a Rust crate compiled to WebAssembly (about 82 kB, 32 kB gzipped). It solves the inverse problem behind parametric sizing: given target measurements such as foot length, toe length, width and instep height, it finds the bone scales and morph weights that make the rigged mesh measure exactly that. three.js then applies them on the GPU.

- A rig is described by a `*.rig.json` file. `src/kernel/rig.ts` documents the format. Bones either inherit their parent's scale (toes grow with the foot) or only move with it (a longer shin lifts the thigh without stretching it).
- `src/domain/stature.ts` turns a height into ANSUR II landmark targets (knee, crotch, shoulder, neck, ear, breadths), so taller people get relatively longer legs and smaller heads, as real adults do.
- `npm run dev`, `npm run build` and `npm run verify:kernel` rebuild the kernel automatically into the git-ignored `src/kernel/pkg`. Cargo skips the work when nothing has changed.

## Local data only

The app has no backend, account, Go service, or AWS resource. The static catalogs and models ship with the client. Your two comparison lineups persist in browser `localStorage`, and share links carry a scene between browsers without a server.

## Verify a change

```bash
npm run verify:domain
npm run verify:models
npm run verify:kernel
npm run lint
npm run build
```

`verify:kernel` runs the kernel's Rust tests and then solves 378 foot shapes on rigs built from the shipped feet. Each must measure within 0.1 mm of its target, and three.js skinning must reproduce the kernel's measurements.

With the development server running, exercise the complete compare flow in a headless browser:

```bash
npm run verify:ui
```

The script launches the system Google Chrome through Playwright on macOS, Windows, and Linux. Point `CHROME_BIN` at a Chrome or Chromium binary to use a different browser build. Screenshots land in `/tmp/3d-compare-verification`.
