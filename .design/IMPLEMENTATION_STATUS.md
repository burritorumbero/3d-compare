# 3D Compare implementation status

## Shipped

3D Compare is a client-only React and R3F app with two persistent comparison worlds.

- Height mode has six textured human models (three female, three male, with pale, tan, and dark skin tones and distinct outfits), a 10-person cap, custom names, metric and imperial height editing, orbit controls, a meter grid on an open floor, and a free-standing 0 to 220 cm ruler post.
- Feet mode has textured female and male pairs of feet cut at mid-shin, adult US sizing to women's 20 and men's 22 and EU sizing to 58, orbit controls, table-plane inspect controls, and a centimeter table grid.
- Both modes support add, select, resize, frame, reset, remove, full-screen stage, share links, a per-device stage size, and `localStorage` persistence. Only the selected model shows its info block.

## Files owned

- `src/domain/**` owns branded millimeters, height and shoe specs, dual worlds, layout, navigation contracts, results, and persistence parsing.
- `src/app/**` owns `createCompareApp`, subscriptions, command handling, persistence hookup, the share-link codec, and React store hooks.
- `src/catalog/humans.ts` owns the six human entries and their authored statures.
- `src/catalog/feet.ts` owns the two feet entries, their authored sole lengths, and default sizes.
- `public/models/**` owns the eight Daz Genesis 9 GLB files, the pack manifest, and the asset licenses.
- `src/scene/draw.ts` derives labels, positions, and exact target-to-reference scale.
- `src/scene/models.ts` owns GLB loading, per-placement clones, and cached bounds.
- `src/scene/environment.tsx` owns the procedural image-based lighting.
- `src/scene/blob-shadow.tsx` owns the shared contact shadow.
- `src/scene/height/**` owns the concrete studio, human figures, and orbit controls.
- `src/scene/feet/**` owns the wood table, foot figures, orbit controls, and inspect controls.
- `src/scene/canvas.tsx` owns the shared R3F canvas.
- `src/ui/**` owns the responsive chrome, catalogs, inspector, lineup, mode controls, unit controls, navigation controls, and UI states.
- `scripts/verify-domain.mjs` checks domain conversions, charts, caps, commands, dual-world retention, and persistence.
- `scripts/verify-models.mjs` re-measures every GLB and fails when a catalog reference size drifts from the mesh.
- `scripts/verify-ui.mjs` drives the desktop and mobile compare flows in system Chrome and writes screenshots to `/tmp/3d-compare-verification`.

## Verify

```bash
npm install
npm run verify:domain
npm run verify:models
npm run lint
npm run build
npm run dev
curl -I http://127.0.0.1:43123/
npm run verify:ui
```

The development server binds to `127.0.0.1:43123`.

The final domain, lint, production build, browser workflow, and live WebGL frame checks pass. The HTTP check returns 200. The development server remains running.

## Known gaps

- The models are static A-pose meshes. There is no animation, pose control, or clothing control.
- Estimated decoded texture memory is 92–130 MiB per human; all eight cached models total about 733 MiB, excluding other GPU/CPU allocations. Real-device frame-rate profiling remains open.
- Catalog cards show flat color swatches rather than rendered thumbnails of the models.
- Human height uses rigged allometric scaling (Phase 5 of `PARAMETRIC_PLAN.md`).
- Shoe charts cover adult US 4–22 for men, US 4–20 for women, and EU 34–58.
- Persistence is local to one browser. Share links reproduce both lineups; there is no account or cloud sync.
- Production JavaScript totals about 1.25 MB (344 kB gzip). Three.js and React have separate cacheable chunks. `verify:budgets` enforces per-chunk and total limits.

## Follow-up: stage visibility (2026-09-06)

Removed shadow-map dependency (PCFSoft deprecation + soft-GL black composite). Height/feet studios now use brighter lights without castShadow/ContactShadows. WebGL drawing-buffer captures remain the source of truth in this VM; Playwright full-page screenshots still under-report WebGL pixels.

## Follow-up: Node.js floor (2026-09-07)

`npm run dev` on Node.js 18 failed inside Rolldown with `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`. Vite 8, Rolldown, oxlint, and drei's camera-controls require Node.js 20.19 or 22.12 and newer, and `verify:domain` needs the TypeScript type stripping that ships in Node.js 22. The repo now declares `engines.node >=22.12.0`, pins `.nvmrc` to 22, sets `engine-strict=true` in `.npmrc`, and runs `scripts/check-node.mjs` before `dev`, `build`, `preview`, and `verify:domain`, so an unsupported Node.js produces a readable message instead of a stack trace. The browser checks find the system Chrome through Playwright's `chrome` channel unless `CHROME_BIN` is set, and `verify:ui` ignores failed loads of the optional Google Fonts stylesheet so offline runs still pass. Placement ids fall back to `crypto.getRandomValues` where `crypto.randomUUID` is unavailable, which covers plain-http origins other than localhost.

## Follow-up: textured models (2026-09-07)

Replaced the procedural stand-ins with the eight-model CC0 GLB pack (MakeHuman Community adaptations). Humans scale uniformly from the Body mesh stature (sole to skull top, hair excluded); feet pairs scale from the sole length of each foot, with the authored stance narrowed to a 5 cm gap so pairs stay compact. Pointer events raycast an invisible hit box per figure instead of the 80k-triangle meshes. Both stages use the Three.js procedural RoomEnvironment for image-based lighting, neutral tone mapping, and a shared blob shadow. The height lineup is a single line at 1.2 m spacing on a 16 m floor; the feet table is 2.4 m wide with two heel lines. `scripts/verify-models.mjs` proves catalog sizes against the GLB vertex data. Saved lineups from the procedural catalog fail validation and start empty.

## Follow-up: stage controls and sharing (2026-09-07)

Height mode lost its walk rig and walls: it now orbits over an open floor with the ruler post as the only fixture. Info blocks render only for the selected figure, so at most one is visible and a tap reveals it. People can be renamed from the inspector (`renameHuman`, 40 characters, blank restores the catalog label). Shoe charts extend to US women's 20 (344 mm), US men's 22 (374 mm), and EU 58 (376 mm), with `FOOT_LENGTH_MM_MAX` at 380 and a 2.6 by 1.4 m table. The stage gains full screen (Fullscreen API with a fixed-position fallback for iPhone Safari) and a Share button that copies a query-string link (`src/app/share.ts`) reproducing both worlds; `main.tsx` imports such links and clears the address bar. Stage height follows the viewport below 980 px.

## Follow-up: parametric foot shape and 10 ft heights (2026-10-17)

This is Phase 1 of `.design/PARAMETRIC_PLAN.md`.

- **Foot shape.** Feet carry a `FootShape`: foot length, toe length, ball width and instep height in millimeters, plus the set of locked dimensions. Unlocked dimensions follow ANSUR II adult ratio medians, generated into `src/domain/anthropometry.ts` by `tools/anthro/fit_ansur.py`. Toe length adds to foot length, so it moves the shoe size.
- **Constraints.** Violations come back as typed `constraint-violated` results naming the dimension, and the state is left unchanged.
- **Saves and links.** Documents are version 2. Version 1 saves migrate to average feet of the saved length. Share links add `t`/`w`/`i` tags for locked dimensions, and untagged links still open.
- **Interim rendering.** Until rigged models land, the scene scales feet per axis relative to the typical shape.
- **Heights.** Heights reach 3048 mm (10 ft). The lineup is spaced by each person's scaled arm-span footprint. The overview camera fits the lineup width and the tallest person for the stage aspect ratio. The ruler post is 320 cm and the floor is 24 m.
- **Checks.** verify:domain, verify:models, lint, build and verify:ui pass.

## Follow-up: parametric kernel (2026-10-17)

This is Phase 2 of `.design/PARAMETRIC_PLAN.md`.

- **The crate.** `kernel/` is a Rust crate compiled to WebAssembly. Given target measurements, it solves for rig bone scales and morph weights.
- **Using it.** Rigs are described by `*.rig.json` (`src/kernel/rig.ts`). `src/kernel/index.ts` loads the kernel and exposes `RigSolver`, and `src/kernel/foot.ts` maps a `FootShape` onto foot rig measures.
- **Not wired into the app yet.** The scene starts using it when rigged models land in Phases 3 and 4.
- **Checks.** `npm run verify:kernel` proves 0.1 mm accuracy over the foot-shape grid on procedural rigs of the shipped feet, and checks that three.js skinning matches. verify:domain, verify:models, verify:kernel, lint, build and verify:ui pass.

## Follow-up: Genesis 9 feet (2026-10-17)

This is Phase 3 of `.design/PARAMETRIC_PLAN.md`.

- **New feet.** Both pairs are rebuilt from Daz Genesis 9 (Laura, Matt) by `npm run assets:feet`: realistic toes and nails, plus normal and roughness maps.
- **Rigging.** Each foot carries shin/foot/toes deform weights, and a generated `*.rig.json` ships beside each GLB.
- **Catalog.** Reference sole lengths are now 226 mm (female) and 248 mm (male).
- **Rendering.** The app still renders feet with the interim per-axis scale. Skinning through the kernel is Phase 4.
- **Checks.** verify:domain, verify:models, verify:kernel, lint, build and verify:ui pass.

## Follow-up: rigged feet in the app (2026-10-17)

This is Phase 4 of `.design/PARAMETRIC_PLAN.md`.

- **How it works.** Feet are skinned meshes now. The WebAssembly kernel solves each placement's shape (foot length, toe length, ball width, instep height) to bone scales, and three.js deforms the Genesis 9 mesh with them.
- **What you see.** Toes lengthen on their own, the forefoot widens, the arch rises, and the shin stays put.
- **Checks.** verify:domain, verify:models, verify:kernel (including the app's skinning code), lint, build and verify:ui pass. The production build serves the kernel and the rigs.

## Follow-up: stature solver (2026-10-17)

This is Phase 5a of `.design/PARAMETRIC_PLAN.md`.

- **Kernel.** It supports non-inheriting bones, so body segments lengthen independently while staying attached.
- **Domain.** `src/domain/stature.ts` predicts ANSUR II landmark heights and breadths for any stature from 0.9 to 3.05 m, and carries a model's own proportions to a new height.
- **Not wired in yet.** People still scale uniformly in the app until the rigged Genesis 9 people land (Phase 5b).
- **Checks.** verify:domain, verify:models, verify:kernel, lint, build and verify:ui pass.

## Follow-up: Genesis 9 people (2026-10-17)

This is Phase 5b of `.design/PARAMETRIC_PLAN.md`.

- **The people.** The six are now Daz Genesis 9 characters (Laura, Amala, Kat, Ty, Fabrice, Matt), with clothing, hair, eyes, lashes and brows, rebuilt by `npm run assets:people`.
- **Sizing.** People are rigged with thirteen segment bones and sized by the kernel to ANSUR II proportions for their height, from 0.9 m to 3.05 m.
- **Delivery.** GLBs use meshopt geometry and WebP textures.
- **Checks.** verify:domain, verify:models, verify:kernel, lint, build and verify:ui pass.

## Follow-up: closeout and proportional lower legs (2026-10-17)

Phase 6 resumes after PR #6 merged. The previous fixed-shin policy caused the reported US 20 distortion and is superseded here.

- **Feet:** the rig grows the ankle and lower leg uniformly about the heel, in proportion to the requested heel-to-ball length. The toes, width and instep retain independent local controls. Toe-only edits leave the leg unchanged. Stance spacing now permits outward shifts when large calves would touch. Automatic columns reflow old saves and removals at 62 cm spacing on a 3.2 m table.
- **Accuracy:** the 378-shape grid stays within 0.045 mm. Both feet at every US/EU chart size are measured through the app’s skinning code; shin position/girth/height, locked dimensions, and toe-only edits have regression coverage.
- **Performance:** 512 px normal/roughness maps reduce estimated texture memory for the whole cache from about 1,082 to 733 MiB. Color maps, geometry, skin weights and landmarks are unchanged. `assets:people -- --optimize-only` uses cached raw Blender exports; the pipeline updates the manifest automatically.
- **Budgets:** `verify:budgets` checks asset sizes, triangle/draw-call counts, decoded texture memory, JS chunks/total and WASM; CI runs it after build. The measured snapshot is `.audit/performance.json`, with methodology and limits in `.design/PERFORMANCE.md`.
- **Rendering:** `verify:rendering` now works on dev and production preview and checks six scenarios, including US 20 and chart endpoints. The old script waited for two labels even though only one selection label is shown; that stale assertion is removed.
- **Final checks:** domain, models, kernel, lint, build, budgets, desktop/mobile UI and six production rendering scenarios pass. US 20 before/after captures are in `.design/renders` and linked from the performance report.
