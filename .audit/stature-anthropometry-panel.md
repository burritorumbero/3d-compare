# Stature review: independent anthropometry/statistical-policy panel

Read-only production-code assessment, 2026-10-17. No asset or production policy changes were made by this panelist.

## Assessment

The current policy mixes incompatible growth assumptions. It forces head and neck to scale linearly with stature, retains sublinear shoulder/body breadth fits, and gives arm thickness the same superlinear growth as arm length. Those choices predict the reported visual imbalance without requiring a renderer defect. A numerical solve can hit every requested landmark while implementing an unsuitable shape policy.

`src/domain/stature.ts:81–93` first computes authored-normalized adult-fit landmark targets, then replaces shoulder, neck, and ear heights with authored heights times the stature ratio. With stature itself exact, the gaps between these upper landmarks all grow linearly. `scripts/person-rig.mjs:55–59` maps head, neck and arm controls to XYZ, including uniform arm scaling. Shoulder breadth continues to grow as stature^.7191 (female) or stature^.6296 (male), while arm length grows as stature^1.1092 or stature^1.0598. Therefore head/shoulder width and arm/shoulder width rise with height.

For example, Luca's authored 1704.3 mm to 3048 mm is a 1.788 height ratio. The current head scale is 1.788, the target shoulder-breadth scale approximately 1.442, and arm scale approximately 1.851. This predicts about 24% more head width and 28% more arm thickness relative to shoulder span. Blended shoulder weights can make the actual chest compensation more complicated; these are policy-level ratios, not independent mesh measurements.

## Data actually supporting the policy

The fitting script uses 1,986 female and 4,082 male public ANSUR II records and ordinary least squares in log(stature), log(measurement). I verified both cached CSV SHA-256 hashes against the pinned hashes in `tools/anthro/fit_ansur.py` and independently repeated that fit. These are cross-sectional associations among different people, not longitudinal observations of one person growing. `averageLandmarks` is best read as a geometric conditional-fit trend, not a biological growth law or a full statistical body-shape model.

Public-data stature ranges measured from the CSVs are female 1409–1829 mm and male 1491–1993 mm; ages in both released datasets are 17–58. The generated 1st–99th percentile stature bands are female 1483–1777 mm and male 1602–1927 mm. Thus 900 and 3048 mm are substantial extrapolations. Tests preserving landmark order there demonstrate numerical order, not anthropometric validity. A 900 mm result is not automatically a child model, nor is 3048 mm a validated giant-body prediction.

The official Army release confirms the public-record counts, survey and purpose. The ANSUR II technical report concerns Army personnel and equipment sizing; it is not a study of growth from childhood to adulthood. The larger technical-report sample and smaller released public working sample should not be conflated.

Primary sources:

- [U.S. Army public ANSUR II data release](https://www.army.mil/article/188601/for_good_measure_natick_releases_raw_data_from_army_wide_anthropometric_survey)
- [Government catalog for the ANSUR II methods and summary-statistics report](https://ntrl.ntis.gov/NTRL/dashboard/searchResults/titleDetail/ADA611869.xhtml)
- [Defense Centers for Public Health: ANSUR II working databases](https://ph.health.mil/topics/workplacehealth/ergo/Pages/Anthropometric-Database.aspx)
- [University of Michigan anthropometry researcher Matthew Reed's primary resource guidance](https://mreed.umtri.umich.edu/mreed/downloads.html), specifically his warning that the military sample is not representative of an arbitrary target population.

Local calculations below are our analysis of the pinned raw data, not numbers quoted from those publications.

Reproduce them with `python3 .audit/stature-anthropometry.py > .audit/stature-anthropometry.json`. The standard-library-only script reuses the existing digest-checked data loader, emits source hashes and measurement-column names, and leaves production code unchanged. The saved JSON parsed successfully; a second execution produced byte-identical output and reproduced the existing arm-length and tragion-to-crown exponents to four decimal places.

## Independent regressions

Exponent b in dimension = a * stature^b; R² from the same log-log OLS model. F/M retain the dataset's separate sex strata. No causal interpretation is implied.

| Measurement | Female b | Female R² | Male b | Male R² |
|---|---:|---:|---:|---:|
| Tragion to top of head | .2896 | .0482 | .2395 | .0392 |
| Head breadth | .1411 | .0251 | .0692 | .0057 |
| Head length (front to back) | .3587 | .1296 | .3361 | .1379 |
| Head circumference | .2763 | .1009 | .2465 | .1187 |
| Neck circumference | .4363 | .0892 | .3247 | .0390 |
| Flexed upper-arm circumference (ANSUR biceps circumference, flexed) | .6346 | .0631 | .4707 | .0360 |
| Forearm circumference, flexed | .6354 | .1290 | .5481 | .0912 |
| Wrist circumference | .6969 | .2971 | .6414 | .2423 |
| Shoulder breadth | .7191 | .3176 | .6296 | .2834 |
| Shoulder-to-wrist length (sum of upper/lower arm) | 1.1092 | .6576 | 1.0598 | .6687 |
| Hand length | .9072 | .4188 | .8873 | .4548 |
| Hand breadth | .5898 | .2242 | .5957 | .2188 |

Arm girths have much weaker height relationships than arm length. As a diagnostic comparison, separate univariate log-weight fits explain .7355/.6692 of log flexed upper-arm circumference variance (female/male) and .6730/.6576 of log flexed forearm circumference variance, versus .0631/.0360 and .1290/.0912 for stature. This supports keeping body build/muscularity distinct from arm length. It does not justify directly fitting an unflexed A-pose circumference to a flexed-arm measurement or claiming a causal weight rule.

The existing head exponent is specifically *tragion to crown*, not chin to crown or whole-head scale. Applying it as an isotropic whole-head growth law is an unsupported proxy. Height explains little of head breadth or upper-head height in this dataset. Conversely, exponent 1.0 for the head is also a product choice, not an ANSUR result.

## Recommended replacement policy

1. Separate upper-body landmark positions from head/neck size. Allocate enough neck/shoulder space while choosing a slower, identity-preserving head-size curve. Preserve the authored mesh exactly at its own reference stature.
2. Give each arm longitudinal growth in its anatomical direction and independent radial growth. Keep authored muscle definition and hand identity; do not reuse the length control for thickness or hand size. Refit or explicitly choose radial policies independently, taking pose mismatch and weak height-only fit into account.
3. Do not simply restore the previous raw head extrapolation: the user already found it too small, and a head-above-ear fit is not a full-head model. A head exponent around .6–.7 is a reasonable *visual experiment*, because it roughly tracks the existing .63–.72 shoulder-breadth slopes and could stabilize head-to-torso balance. It is not an evidence-validated anatomical prescription. Compare a small candidate range using consistent, normalized front/side silhouettes and full-head measurements before selecting it.
4. Keep a documented adult-data interval and a deliberately bounded art-direction extension beyond it. Smooth the transition so changes in the slider do not produce shape or derivative discontinuities. Maintain full supported stature range if required, but avoid presenting extrapolated extremes as survey-validated human anatomy. Preserve authored identity and coherent relative ratios in that extension.
5. Prefer normalized segment lengths to multiplying all floor-height landmarks independently. Subtracting independently scaled heights can create accidental local-size effects. For example, old ear-floor normalization gives head-above-ear H - a*(H - c*H^b), where a is authored-ear/average-ear at reference stature; this contains a residual linear term and is not the simple normalized local segment rule head0*(H/H0)^b. These happen to be close in the shipped assets but are conceptually distinct and can diverge for other assets.

## Verification needed

- Authored-height identity for all six bodies and attachments; exact requested stature and grounded feet.
- Full head width/depth/chin-to-crown, head-to-shoulder span, neck-to-head width, upper/lower arm perpendicular cross-sections, wrist/hand dimensions and limb segment lengths measured from the deformed mesh.
- Within-model trends and cross-model envelopes at 900 mm, a short adult, authored stature, 2000, 2400 and 3048 mm. Numeric fit error alone is insufficient.
- Front, side and three-quarter images using consistent orthographic framing, plus height-normalized silhouettes. Such normalization separates bigger overall size from changes in shape.
- Smoothness and monotonicity through any policy transition; symmetry, correct shoulder/wrist alignment and clothing continuity.
- Replace current tests that require head/neck XYZ to equal the full height ratio (`scripts/verify-kernel.mjs:413–417`) and fixed upper landmark proportions (`scripts/verify-domain.mjs:338–339`), because they currently enshrine the disputed behavior. Retain exact-size and attachment tests.

The statistical recommendation is strong on *decoupling controls and limiting the interpretation of the data*. It does not identify a uniquely correct giant-head exponent; that remains a deliberate visual design decision requiring render review.
