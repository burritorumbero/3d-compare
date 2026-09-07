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
- `public/models/**` owns the eight CC0 GLB files, the pack manifest, and the asset licenses.
- `src/scene/draw.ts` derives labels, positions, and exact target-to-reference scale.
- `src/scene/models.ts` owns GLB loading, per-placement clones, and cached bounds.
- `src/scene/environment.tsx` owns the procedural image-based lighting.
- `src/scene/blob-shadow.tsx` owns the shared contact shadow.
- `src/scene/height/**` owns the concrete studio, human figures, orbit controls, and walk controls.
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
- Each human model decodes to about 40 MB of GPU textures; all eight models total about 280 MB if every one is on stage.
- Catalog cards show flat color swatches rather than rendered thumbnails of the models.
- Human height uses uniform scaling. It does not solve body segments independently.
- Shoe charts cover adult US 4 to 16 for men, US 4 to 14 for women, and EU 34 to 50.
- Persistence is local to one browser. There is no account, cloud sync, or shareable URL.
- The production JavaScript bundle includes Three.js and is about 1.16 MB before gzip. Vite reports its default 500 kB chunk warning.

## Follow-up: stage visibility (2026-09-06)

Removed shadow-map dependency (PCFSoft deprecation + soft-GL black composite). Height/feet studios now use brighter lights without castShadow/ContactShadows. WebGL drawing-buffer captures remain the source of truth in this VM; Playwright full-page screenshots still under-report WebGL pixels.

## Follow-up: Node.js floor (2026-09-07)

`npm run dev` on Node.js 18 failed inside Rolldown with `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`. Vite 8, Rolldown, oxlint, and drei's camera-controls require Node.js 20.19 or 22.12 and newer, and `verify:domain` needs the TypeScript type stripping that ships in Node.js 22. The repo now declares `engines.node >=22.12.0`, pins `.nvmrc` to 22, sets `engine-strict=true` in `.npmrc`, and runs `scripts/check-node.mjs` before `dev`, `build`, `preview`, and `verify:domain`, so an unsupported Node.js produces a readable message instead of a stack trace. The browser checks find the system Chrome through Playwright's `chrome` channel unless `CHROME_BIN` is set, and `verify:ui` ignores failed loads of the optional Google Fonts stylesheet so offline runs still pass. Placement ids fall back to `crypto.getRandomValues` where `crypto.randomUUID` is unavailable, which covers plain-http origins other than localhost.

## Follow-up: textured models (2026-09-07)

Replaced the procedural stand-ins with the eight-model CC0 GLB pack (MakeHuman Community adaptations). Humans scale uniformly from the Body mesh stature (sole to skull top, hair excluded); feet pairs scale from the sole length of each foot, with the authored stance narrowed to a 5 cm gap so pairs stay compact. Pointer events raycast an invisible hit box per figure instead of the 80k-triangle meshes. Both stages use the Three.js procedural RoomEnvironment for image-based lighting, neutral tone mapping, and a shared blob shadow. The height lineup is a single line at 1.2 m spacing on a 16 m floor; the feet table is 2.4 m wide with two heel lines. `scripts/verify-models.mjs` proves catalog sizes against the GLB vertex data. Saved lineups from the procedural catalog fail validation and start empty.

## Follow-up: stage controls and sharing (2026-09-07)

Height mode lost its walk rig and walls: it now orbits over an open floor with the ruler post as the only fixture. Info blocks render only for the selected figure, so at most one is visible and a tap reveals it. People can be renamed from the inspector (`renameHuman`, 40 characters, blank restores the catalog label). Shoe charts extend to US women's 20 (344 mm), US men's 22 (374 mm), and EU 58 (376 mm), with `FOOT_LENGTH_MM_MAX` at 380 and a 2.6 by 1.4 m table. The stage gains full screen (Fullscreen API with a fixed-position fallback for iPhone Safari) and a Share button that copies a query-string link (`src/app/share.ts`) reproducing both worlds; `main.tsx` imports such links and clears the address bar. Stage height follows the viewport below 980 px.
