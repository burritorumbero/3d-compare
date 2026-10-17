# Parametric sizing: assessment and work plan

Status, 2026-10-17: Phases 1–6 are done, and Phase 0 is partly done. See the checkboxes below.

## Goal

Replace uniform (affine) scaling with parametric, constraint-driven sizing:

- **Feet**: independent controls for foot length (still drivable by shoe size), forefoot width, foot thickness (instep height) and toe length. The shape has to stay organic and realistic.
- **Humans**: stature changes that follow human proportions (allometry) instead of enlarging the whole body. The current policy preserves proportional head and neck growth while legs and body widths follow adult allometry (updated 2026-10-17). Heights range from 90 cm to **10 ft (3048 mm)**.
- **Models**: keep, or raise, realism comparable to a base Daz3D Genesis figure.
- **Exactness**: the product exists to compare sizes, so every requested measurement must be the measured measurement of the rendered mesh, within ±1 mm. Today `verify:models` guarantees this for uniform scaling. The new system must keep that guarantee.

## Assessment of the current state

| Area | Today | Problem for parametric sizing |
| --- | --- | --- |
| Feet assets | `*-feet-shins.glb`: two static meshes (`LeftFootAndShin`, `RightFootAndShin`), about 7.5k vertices each, one diffuse JPEG, no normal or roughness map | No morph targets, no skeleton, no landmark data, so there is nothing to deform except the whole object. Detail and shading sit below Daz level (no normal map, toes are low poly). |
| Human assets | 6 static meshes, ~23k body vertices, 6–9 meshes each, ~5 MB, ~40 MB of GPU textures each | Not rigged. Clothing, hair and eyes are separate meshes that would all have to deform consistently. |
| Asset reproducibility | `source-assets/` is git-ignored and **missing on this machine**, and no Blender build script is in the repo | The models cannot be regenerated. Any revamp has to rebuild the pipeline first. |
| Domain | `PlacedFoot.footLengthMm` is a single scalar. `footScale()`/`heightScale()` return one ratio. | The data model has no place for shape parameters. |
| Persistence | `CompareDocument.version: 1`. A version mismatch drops the saved lineup. | A schema change needs a v1→v2 migration so existing users keep their lineups. |
| Share links | `f=foot-male:272` | The link format needs room for shape parameters and must still accept old links. |
| Scene | `draw.scale` passed to `<primitive scale>`; bounds come from the authored mesh × scale; `narrowStance` moves rigid per-foot meshes | Bounds, hit box, ring, label and blob shadow all assume uniform scale. Skinned or morphed meshes also need explicit bounds, or frustum culling and the hit boxes will be wrong. |
| Cloning | `gltf.scene.clone(true)` | Breaks with skinned meshes (bones aren't rebound). Needs `SkeletonUtils.clone`. |
| UI | Foot inspector has one shoe-size `<select>` | Needs the four parameter controls, locks, units and a reset. |
| Verification | `verify-models.mjs` asserts static meshes: no skins, no `extensionsRequired`, transforms baked in | These assertions will fail by design after the change and must be rewritten. They should prove landmark measurements across a grid of parameters. |
| Toolchain | Blender 5.2 LTS (works headless), Daz Studio + Genesis 8/9 library, Diffeomorphic `import_daz`, Rust + `wasm32-unknown-unknown` | No `wasm-bindgen-cli`/`wasm-pack` yet. |

## Technical direction

### WASM geometry kernel: where it helps and where it doesn't

A B-rep CAD kernel (OpenCascade.js, Manifold) is the **wrong** tool. It works on watertight boundary representations with sharp features and booleans. Converting an organic, UV-mapped skin mesh to B-rep and back loses smoothness and UVs, and adds a 10–30 MB wasm payload. Deformation speed also isn't the bottleneck: the GPU applies skinning and morph targets in the vertex shader for 15–25k vertices in well under a millisecond.

"Parametric/CAD" here means **CAD-style constraints over a deformable mesh**: named dimensions, locks, derived defaults, and a solver that guarantees the dimensions. The plan splits it like this:

- **GPU (three.js)** renders the deformation through a small deform-bone rig plus corrective morph targets. Each frame costs almost nothing.
- **Rust → WASM kernel** (`kernel/`, `wasm-bindgen`, no external CAD dependency, target < 150 kB) owns the math the GPU can't report back:
  1. evaluating the same deformation on the CPU (linear blend skinning + morphs) for the landmark vertices only, or for the full mesh when bounds are needed;
  2. measuring landmarks: heel-to-toe length, ball width, instep height, toe length, stature, bounds;
  3. **the inverse solve**: from requested measurements to bone scales and morph weights. This is a damped Gauss–Newton/Levenberg–Marquardt solve on a 4–6 dimensional problem, converging to ±0.5 mm in a few iterations;
  4. the same binary runs in Node, so `verify:*` scripts prove "requested = measured" with production code.

  This is where WASM genuinely helps: one exact, deterministic, fast solver shared by the browser and CI. Without the solver, smooth bone weights make the dimensions interact (for example, widening the forefoot slightly lengthens the toes), and the sizes would be approximate. (The local Qwen 3.8 model reviewed this split independently and came to the same conclusion.)

### Feet rig and parameters

Deform bones for each foot: `heel`, `midfoot`, `metatarsal`, `toes`, plus a fixed `shin` root. Weights are painted smooth, and the shin is excluded from width and thickness changes. Correctives:

- `width+` and `width-` to spread or narrow the toes and keep the forefoot rounded;
- `instep+` and `instep-` to raise the dorsum while keeping the sole flat;
- `toes-long` and `toes-short` to lengthen the phalanges without stretching the nails.

Parameters are stored in mm. Defaults derive from length by sex ratio unless locked:

| Parameter | Landmark definition | Default | Allowed range |
| --- | --- | --- | --- |
| `lengthMm` | pternion → tip of longest toe (shoe size maps here, as today) | from shoe size | 200–380 |
| `ballWidthMm` | horizontal distance between the 1st and 5th MTP heads | ANSUR II width ratio median (F 0.377, M 0.376) | ratio 0.30–0.48 |
| `instepHeightMm` | floor → dorsum at 50% of length | provisional ratio 0.25 (ANSUR II has no instep column; confirmed). The current MakeHuman meshes measure 0.29 | ratio 0.18–0.34 |
| `toeLengthMm` | 1st MTP → tip, so it equals `length − balloffootlength` | ANSUR II toe ratio median (F 0.261, M 0.259) | ratio 0.18–0.34 |

Constraint semantics, decided as the default and reversible:

- Foot length is primary because shoe size depends on it. Changing toe length **adds to or removes from** foot length, so the shoe size moves with it (owner decision 2).
- Defaults use ratio medians, not linear fits. Fits with an intercept drift outside the surveyed range: a 380 mm foot would get a width ratio of 0.32 against a median of 0.376.
- Any unlocked parameter follows its ratio when the length changes. A locked parameter keeps its millimeters. This is the CAD "driven vs driving dimension" model.
- Out-of-range values come back as a typed `constraint-violated` result naming the parameter. Values are never silently clamped.

### Humans: allometric stature

The user-facing input stays a single height. Internally, the stature solve sets segment bone scales from per-sex regressions of ANSUR II segment heights on stature: head, neck, trunk, thigh, shank, foot, plus breadth with a slower exponent. The solver then pins the measured skull-top height to the requested stature exactly. A later phase can add breadth/build parameters; they are out of scope unless requested.

### Models revamp

Rigging and correctives require a rebuild in any case. The pipeline lives in the repo as Blender Python under `tools/assets/`, so models become reproducible:

1. Base: Daz Genesis 9 through Diffeomorphic (see Decisions). The feet are cut from the G9 body at mid-shin and capped.
2. Detail: 2K diffuse, normal and roughness maps for skin, with the normal map baked from a sculpt pass for creases, knuckles and nail beds. Materials use `MeshPhysicalMaterial` with sheen and wrap lighting to approximate subsurface scattering.
3. Rig, weights, corrective shape keys and landmark vertex groups. The export is a GLB with morph targets, plus a `*.rig.json` sidecar: landmark vertex indices, bone rest data, parameter→bone map, and default ratios.
4. Compression: meshopt geometry and KTX2/Basis textures. KTX2 should cut the ~40 MB of GPU memory per human by about 4×. This adds `EXT_meshopt_compression`/`KHR_texture_basisu`, so the loader needs `MeshoptDecoder` and `KTX2Loader`.
5. Acceptance: renders under fixed lights side by side with a Genesis 9 reference render from the local Daz library, checked at the same camera.

## Decisions (owner, 2026-10-17)

1. **Ship Daz Genesis 9 models.** The owner handles licensing. Daz source files stay out of git (`source-assets/` is ignored). The exported GLBs in `public/models` are published with the site.
2. **Toe length changes foot length and shoe size.** Foot length = heel-to-ball + toe length. Editing toes keeps heel-to-ball and moves the toe tip. Choosing a shoe size sets foot length, and unlocked toes follow the adult ratio.
3. **Human height reaches 10 ft (3048 mm).** Beyond the ANSUR II stature range (1.41–1.99 m), the allometric power laws extrapolate. The raw adult fits grow head height with stature^0.24–0.29. Following visual review, the application overrides the upper-body targets to preserve each model’s head and neck proportions; it does not model gigantism.

### Asset source: Daz Genesis 9 (replaces the MakeHuman/MPFB plan)

Verified on this machine:

- Diffeomorphic `import_daz` 5.1 runs headless in Blender 5.2. `api.set_selection([duf]); bpy.ops.daz.import_daz_manually()` imported `Laura for Genesis 9.duf` in under 1 s: a 138-bone armature, a 25,182-vertex mesh, and per-region diffuse, normal, roughness and SSS maps.
- There are six G9 characters: Amala, Kat and Laura (female); Fabrice, Matt and Ty (male). They replace the six MakeHuman people one for one.
- Clothing: G9 Base Shirt, Shorts, Bikini and Bra, Worker Uniform, and the BW Strapless Beach 02 outfit. Hair: G9 Base Pixie, Eirgrid, and Mavick Hair and Beard.
- G9 has **no foot shape morphs**, only pose controls such as toe bends and spread. It does have per-toe bones, so the deform-bone rig is still needed, and the toe bones help with toe length.
- Still to check: whether the character `.duf` presets apply their body shape morph on import, or only the base mesh plus skin. Eyes, brows and lashes are separate G9 figures and need their own import.

## Work plan

Each phase ends green on `verify:domain`, `verify:models`, `lint`, `build` and `verify:ui`, and is one commit series.

### Phase 0: groundwork

- [x] Install `wasm-bindgen-cli` 0.2.129 (pinned to the crate). `kernel/rust-toolchain.toml` pins Rust 1.99.1, and the machine default stays unchanged.
- [x] Confirm the Daz → Blender path works headless (Diffeomorphic 5.1, Blender 5.2).
- [ ] Record G9 product versions and checksums in `source-assets/provenance.json` (local, git-ignored).
- [x] ANSUR II: `tools/anthro/fit_ansur.py` downloads the CSVs (SHA-256 pinned, cached in the git-ignored `tools/anthro/.cache`) and generates `src/domain/anthropometry.ts`.
- [x] Owner decisions recorded above.

### Phase 1: domain model (pure TS, no new assets)

- [x] `src/domain/foot-shape.ts`: `FootShape { lengthMm, toeLengthMm, ballWidthMm, instepHeightMm, locked }`, with `typicalFootShape`, `resizeFoot`, `setFootDimension`, `resetFootDimension` and `validateFootShape`. Errors are typed `constraint-violated` results that name the dimension.
- [x] `PlacedFoot.footLengthMm` → `PlacedFoot.shape`. The app gains `setFootDimension` and `resetFootDimension`. `updateFootSize` re-derives the unlocked dimensions.
- [x] `CompareDocument` v2 with a v1→v2 migration. Old saves become average feet of the saved length.
- [x] Share codec: `f=foot-male:281:t81:w110` (locked dimensions only). Old untagged links still decode.
- [x] Inspector: a slider and mm field per dimension, an Average/Reset state, and hints when a value is outside the 1st–99th percentile. The lineup tags custom shapes.
- [x] Interim rendering until the rig landed: per-axis scale relative to the typical shape. Phase 4 replaced it with kernel-driven skinning.
- [x] Heights up to 10 ft. The lineup is spaced by scaled footprints (`humanLineupX`). The camera framing accounts for the stage aspect ratio and the tallest person. A 320 cm ruler and a wider floor were added.
- [x] Tests: `verify-domain` (shapes, locks, constraints, migration, links, 10 ft heights, no lineup overlap), `verify-models` (footprint widths), `verify-ui` (toe edit, rejected width, 304.8 cm limit, share link).

### Phase 2: kernel (`kernel/`, Rust → WASM)

- [x] Crate `parametric-kernel` (`kernel/src/core.rs`, with a wasm-bindgen surface in `lib.rs`). It handles hierarchical axis-aligned bone scales about floor-level heads, plus clamped morph channels. Measures are `extent`, `max` and `between`. The solver is Levenberg–Marquardt with a central-difference Jacobian, a prior pull, bounds, and a warm start. Solver iterations deform only the measured vertices, and bounds come from a hull sample once at the end.
- [x] Rig file format (`src/kernel/rig.ts`): names for bones, controls, groups and measures, encoded into typed arrays, so the kernel needs no JSON parser. Contract: deform bones have an identity rest rotation and heads at y = 0, which makes `bone.scale` in three.js equal the kernel's math.
- [x] TS API: `loadKernel`, `RigSolver.solve/evaluate/pose/dispose`, `loadBrowserKernel` (Vite `?url`). Feet: `FOOT_RIG_MEASURES`, `footTargets` and `solveFoot`.
- [x] `npm run build:kernel`, which also runs before dev, build and `verify:kernel`. Output: 81.6 kB wasm (32 kB gzipped) in the git-ignored `src/kernel/pkg`.
- [x] `npm run verify:kernel`: 8 Rust unit tests, then 378 solves over the full foot-shape grid on procedural rigs of the shipped feet (`scripts/procedural-foot-rig.mjs`). Results: worst error 0.047 mm, about 0.46 ms per cold solve in Node, warm starts in 3 iterations or fewer, soles stay on the floor, and the shin is untouched. three.js `Bone`/`Skeleton` skinning with the kernel's pose reproduces the measurements within 0.1 mm.
- [x] `verify:ui` loads the kernel in Chrome through Vite and solves a rig.
- [x] CI: pinned Rust via rustup, `Swatinem/rust-cache`, prebuilt `wasm-bindgen` via `taiki-e/install-action`, plus `verify:kernel`.
- Fixture lesson for Phase 3: shin weights must hand over above the malleolus (about 0.30–0.42 × foot length). Otherwise the instep is partly shin-weighted and thin-foot targets become unreachable.

### Phase 3: feet asset rebuild (Blender pipeline)

- [x] `tools/assets/build_feet.py` runs headless in about 3 s per pair. Steps:
  1. Import the character with Diffeomorphic and apply its body shape. Character presets drive their shape through formulas (for example, Laura = 0.8 BaseFeminine − 1 BaseMasculine + proportion shapes). Headless Blender doesn't evaluate those drivers, so the script reads the formula weights from `<Name>_body_bs_body.dsf` and sets the shape keys directly. Bone-scale `_ctrl_…_scl` controls are skipped; the kernel sets the final sizes anyway.
  2. Keep the lower legs, subdivide once, cut at 1.3 × foot length, and cap with a single skin UV.
  3. Weights: the `_DEFORM_WEIGHTS` attribute (shin, foot, toes) comes from Genesis 9's own groups (shin; foot + metatarsal; toes + every toe bone). Shin weight hands over at 0.30–0.42 × foot length. Toenails are 100% toes.
  4. Materials: plain PBR (diffuse map as albedo, normal, roughness), cropped from the 4K UDIM tiles with the OpenImageIO bundled in Blender.
- [x] Characters: Laura (female, tan) and Matt (male, pale), matching the catalog. Each mesh has about 10.1–10.3k vertices per foot (40–41k triangles per pair), and each GLB is about 2.4 MB.
- [x] `scripts/build-feet-assets.mjs` (`npm run assets:feet`) runs Blender, then writes `*.rig.json` from the exported GLB (`scripts/foot-rig.mjs`), so rig vertex indices always match the GLB. The ball line is where the toes weight crosses 0.5 on the sole.
- [x] Bones are rebuilt at runtime from the rig file (identity rest rotation, heads on the floor), not exported from Blender. Blender's bone axes would break the contract that `bone.scale` equals the kernel's math.
- [x] `verify-models`:
  - checks for the rig file and that every vertex has deform weights;
  - the "faces +Z" check now asks which way the toes point.
- [x] `verify-kernel` now runs on the shipped rigs:
  - every rig vertex matches its GLB vertex and weights, and weights sum to 1;
  - left and right feet solve to the same controls;
  - 378 solves with a worst error of 0.049 mm.
- [x] Instep ratio confirmed at 0.25: standing dorsum height at 50% foot length is 65.3 mm on a 259.5 mm foot, a ratio of 0.252 (IJERPH 2020, 17(4):1274). Genesis 9 sculpts measure 0.29–0.30, so the rig will lower them toward the average.
- [x] Acceptance screenshots from the app are in `.design/renders/`.
- Material finding: Diffeomorphic's Cycles conversion of Genesis 9 skin renders at about 4% reflectance under uniform light. Its subsurface scale looks centimeter-based on a meter mesh, so it isn't a usable color reference. The diffuse map as albedo matches Daz's Iray promo renders well. A skin subsurface approximation in three.js stays a Phase 6 polish item.
- Deferred to Phase 4, where skinning becomes visible: corrective shape keys, for example so a long toe scale doesn't stretch the nails, if renders at the range extremes need them.

### Phase 4: feet runtime and UI

- [x] `src/scene/feet/rigged-foot.ts` (pure three.js):
  - `rigFoot` rebuilds the rig's bones (identity rest rotation, heads from the rig file);
  - it adds `skinIndex`/`skinWeight` from `_deform_weights` once per shared geometry;
  - it binds a `SkinnedMesh` per material primitive under a movable root;
  - `poseFoot` sets the kernel's bone scales.
  - Cloning isn't needed: each placement builds its own bones and shares geometry and materials.
- [x] `src/scene/feet/foot-rigs.ts`: a Suspense cache that loads the kernel and the pair's `*.rig.json` once per model. The feet catalog preloads them on hover with the GLB.
- [x] `figures.tsx`:
  - each placement solves its `FootShape` on the left rig and mirrors the controls to the right;
  - solves warm-start from the placement's last controls;
  - ring, hit box, label and shadow come from the solved bounds;
  - the stance narrowing moves the foot roots.
  - The interim per-axis scale (`footAxisScale`) is gone.
- [x] The inspector controls, locks, reset, percentile hints and lineup tag shipped in Phase 1. Slider ticks commit directly: a solve costs about 0.5 ms and only the edited placement re-solves.
- [x] `verify-kernel` now drives the app's `rigFoot`/`poseFoot` through three's `SkinnedMesh.applyBoneTransform`, with the root moved off-origin, and requires the kernel's measurements within 0.1 mm.
- [x] `verify-ui` exercises the full path: feet labels only mount after the GLB, the rig, the kernel and the solve, and any console or page error fails the run.
- [x] The production build serves `kernel_bg-*.wasm` as `application/wasm` and the rig files as JSON. Rigged feet render from `vite preview` with no errors.
- [x] Visual check at the extremes (280 mm with long toes and a wide forefoot; 230 mm with short toes, narrow and flat; a high instep): no tearing, nails only slightly stretched, shin unchanged. Corrective shape keys aren't needed for now.
- Deferred:
  - inch display for the shape fields (they stay in mm alongside shoe charts);
  - a frame-rate measurement on real GPU hardware (headless runs use software WebGL).

### Phase 5a: stature solver

- [x] **Kernel:** per-bone `inherit_scale`. A non-inheriting bone moves with its parent but keeps only its own scale, so a longer shin lifts the thigh without stretching it. `Pose` returns the world scales and the three.js local scales (own ÷ parent's world). Skinning uses `offset = parent(head) − world·head`. The rig file's `inheritScale` is optional and defaults to true, so the feet rigs are unchanged. The kernel is now 83.0 kB.
- [x] **Domain** (`src/domain/stature.ts`):
  - `averageLandmarks(sex, stature)` comes from the ANSUR II power laws: ankle, knee, crotch, shoulder, neck, ear and stature heights, plus biacromial and hip breadth and foot length.
  - `statureTargets(sex, authored, stature)` scales a model's own landmarks by the population ratio, so individual proportions carry over and stature lands exactly.
  - Predicted order holds from 0.9 to 3.05 m. At 3.05 m the head above the ear is 5.0% of stature (7.7% at 1.65 m) and the crotch is at 55% (48%).
- [x] **Tests:**
  - `verify-domain`: landmark order and monotonic growth at every height in range; head shrinks and legs lengthen relative to stature; individual proportions carry over.
  - Rust: a non-inheriting column test.
  - `verify-kernel`: a 9-control body column solved to stature targets at 62 heights from 0.9 to 3.05 m, worst error 0.030 mm, with three.js bones using the kernel's local scales placing every landmark the same.

### Phase 5b: Genesis 9 people

- [x] `tools/assets/build_people.py`, driven by `npm run assets:people`. About 40 s per person.
  - **Import:** character, Genesis 9 Eyes, Eyelashes, Mouth and Eyebrows Card, then clothing. Hair imports separately, so whatever it adds counts as hair, whatever its mesh is called.
  - **Shape:** body and head formula weights are set directly. Clothing, hair and eyes follow through an inverse-distance displacement field from the base body (k = 8).
  - **Cleanup:** hair is thinned by whole cards to 30k faces. The eye moisture and tear films are dropped. Clothing hems are clamped to the floor (people are barefoot).
  - **Weights:** regions come from Genesis 9 groups (toe groups excluded from the arms: they share finger prefixes). Within a region, segments split at landmark heights with smooth blends. Add-ons take the nearest body weights. Thirteen non-inheriting segment bones.
  - **Landmarks** found by anatomy rules: outer ankle bone above the foot, front of the knee at the mid thigh-to-shin handover, crotch, outer shoulder tip, back of the neck base, front of the ear, crown, widest hips, sole ends and wrist ring. At authored stature they match ANSUR ratios: knee 0.276, crotch 0.477, shoulder 0.826, neck 0.857, ear 0.927.
  - **Materials:**
    - texture roles are found by following node links, then file names;
    - Daz material presets (eyes, lashes, brows, mouth, hair colors) are parsed from their animation keys and layered image library;
    - layers composite unscaled from the top-left in linear light, and preset tints are treated as sRGB;
    - textures use straight alpha (OpenImageIO would otherwise premultiply);
    - per-person `hair_tint` and `wear_tints` handle products shipped in neutral colors.
- [x] People: Laura (dress), Amala (jeans and T-shirt), Kat (shorts and crop top), Ty (shorts and T-shirt), Fabrice (jeans and tank top), Matt (trousers and sweater). Each is 150–220k triangles and 4.8–6.4 MB after `build-people-assets.mjs` (8-bit skin attributes, WebP, meshopt FILTER, unquantized positions). Rigs are written from the shipped GLB, because meshopt reorders vertices.
- [x] Runtime:
  - `src/scene/rigged.ts` (generalized from the feet) skins every mesh under a node from `_skin_index`/`_skin_weight` or `_deform_weights`;
  - card materials use alpha-to-coverage (MSAA) instead of blending (a 0.5 cutoff erased soft hair);
  - `src/scene/rig-cache.ts` loads any rig file;
  - people solve `statureTargets` for their height, warm-started;
  - bounds drive the hit box, ring, label and shadow;
  - lineup footprints follow the ANSUR arm-length ratio.
- [x] Checks:
  - `verify-models` now reads every model through glTF-Transform (meshopt and WebP allowed) and checks skin and landmark attributes;
  - `verify-kernel`: shipped person rigs match their GLBs; 120 stature solves (0.9–3.05 m) with a worst error of 0.031 mm and nothing below the floor; the app's skinning agrees at 10 ft;
  - `verify-ui` passes.
- Known: 150–220k triangles per person (mostly hair cards and the body), so ten people is about 2M triangles. Hair and brows are textured cards, not strands.

### Phase 6: closeout and proportional lower legs

- [x] README, `IMPLEMENTATION_STATUS.md`, `.audit` entries and `.design/PERFORMANCE.md`.
- [x] Bundle and GPU budget check: `verify:budgets` enforces GLB/rig sizes, triangles, draw calls, decoded texture memory, JavaScript chunks/total and WASM size; it runs after the production build in CI. `.audit/performance.json` records the measurements.
- [x] Normal/roughness maps capped at 512 px: all cached model textures drop from approximately 1,082 to 733 MiB. Geometry and color texture bytes are unchanged. Three.js and React have separate cacheable chunks; the 750 kB per-chunk limit is enforced alongside a 1.3 MB total JS limit.
- [x] User correction: shoe size now grows and moves the ankle/shin with heel-to-ball length. A fifth rig control drives uniform lower-leg growth; local foot controls preserve exact measurements. Toe-only edits leave the leg alone. The stance can widen to keep grown calves apart; automatic table columns reflow at 62 cm spacing, including old saves.
- [x] Regression coverage: the 378-shape grid, both skinned feet at every US/EU size, locked dimensions, and toe-only edits. Worst foot error 0.045 mm.
- [x] Browser rendering checks work on the production build and capture people at normal/10 ft height, US 20 feet, and small/large chart endpoints.
- Resource checks are complete; real-device frame-rate profiling and additional skin shaders remain future work. Software WebGL cannot establish mobile GPU performance.

## Local model (MLX-Serve, `localhost:11234`) usage

Use `Qwen3.8-27B-MLX-8bit` (≈45 s per 900-token answer) for bounded, verifiable side work:

- drafting Blender `bpy` boilerplate;
- generating parameter-grid test tables;
- summarizing ANSUR II column documentation;
- second-opinion reviews of solver math and diffs.

Its output is always checked against tests or a run. It never commits code that hasn't been executed here.

## Risks

0. **Daz figure fidelity vs web budget**: G9 skins ship 4K UDIM-style maps for each region, and the hair is dense. Mitigation: bake down to 2K atlases, use KTX2, and decimate the hair cards. Budget 8 MB per human.
1. **Correctives vs linear blending**: large length ranges (200–380 mm) on a single morph look rubbery. That is why length and toes go through bones and morphs only shape. Mitigation: render checks at the range extremes.
2. **Clothing on rigged humans** can poke through skin at extreme statures. Mitigation: hide body faces under clothing (geometry-shell / delete groups), plus a test grid at 0.9, 1.7 and 3.05 m.
3. **Landmark stability** after subdivision and decimation. Mitigation: store landmarks as vertex groups and re-resolve the indices at export.
4. **Asset size**: morphs plus normal maps grow the GLBs. Mitigation: meshopt + KTX2, budget 2 MB per feet pair and 6 MB per human.
5. **Pipeline reproducibility**: the current source assets are lost. Phase 0 is mandatory, not optional.

### Visual correction after Phase 6

At the user's request, the application now preserves head and neck proportions as height changes. `averageLandmarks` still exposes the original adult-survey fits; `statureTargets` supplies the application policy by scaling shoulder, neck and ear heights directly with stature. `person-rig.mjs` scales the neck in XYZ with its own control. Regression checks measure the actual skinned body and head attachments, not only target landmarks. The dark UI revamp and visual verification are recorded in `IMPLEMENTATION_STATUS.md`.

### Panel correction: balanced heads and independent arm dimensions

The earlier proportional-head policy above is superseded by [the completed stature correction](STATURE_IMPLEMENTATION.md). All six people now use 17 bones, anatomical arm axes, independent length/girth/hand controls, chest-owned shoulder landmarks, and bounded shape extrapolation. The kernel and renderer share complete affine matrices; actual-mesh tests constrain head/shoulder and arm/shoulder balance and repeated height edits. Baseline evidence remains in `STATURE_PANEL_REVIEW.md`.
