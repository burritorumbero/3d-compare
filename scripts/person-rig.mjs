// Builds the stature rig file for a person GLB from what tools/assets/build_people.py
// authored: `_SKIN_INDEX`/`_SKIN_WEIGHT` on every mesh, `_LANDMARK` ids on the
// body, and bone pivots in the body node's extras. Bones and landmark ids must
// match BONES and LANDMARKS in build_people.py.
//
// Every segment bone moves with its parent without inheriting its scale, so a
// segment's own control changes only that segment. Controls map one-to-one to
// the BodyLandmarks of src/domain/stature.ts, which the app solves for a height.

const BONES = ['root', 'foot.L', 'foot.R', 'shin.L', 'shin.R', 'thigh.L', 'thigh.R', 'pelvis', 'chest', 'neck', 'head', 'arm.L', 'arm.R']
const PARENTS = {
  root: null,
  'foot.L': 'root',
  'foot.R': 'root',
  'shin.L': 'foot.L',
  'shin.R': 'foot.R',
  'thigh.L': 'shin.L',
  'thigh.R': 'shin.R',
  // The trunk rides on one leg; both legs scale alike.
  pelvis: 'thigh.L',
  chest: 'pelvis',
  neck: 'chest',
  head: 'neck',
  'arm.L': 'chest',
  'arm.R': 'chest',
}
const LANDMARKS = {
  ankle: 1,
  knee: 2,
  crotch: 3,
  shoulderLeft: 4,
  shoulderRight: 5,
  neck: 6,
  ear: 7,
  wrist: 8,
  soleEnds: 9,
  crown: 10,
  hipLeft: 11,
  hipRight: 12,
}
const HULL_STRIDE = 16
const DECIMALS = 1e6

const round = (value) => Math.round(value * DECIMALS) / DECIMALS
const both = (bone) => [`${bone}.L`, `${bone}.R`]
const channel = (bones, axes) => bones.flatMap((bone) => [...axes].map((axis) => ({ bone, axis, gain: 1 })))

const CONTROLS = [
  ['ankle', channel(both('foot'), 'y')],
  ['footLength', channel(both('foot'), 'xz')],
  ['knee', channel(both('shin'), 'y')],
  ['crotch', channel(both('thigh'), 'y')],
  ['shoulder', channel(['pelvis'], 'y')],
  ['neck', channel(['chest'], 'y')],
  ['ear', channel(['neck'], 'y')],
  ['stature', channel(['head'], 'xyz')],
  ['biacromialBreadth', channel(['chest', 'neck'], 'xz')],
  ['hipBreadth', channel(['pelvis', ...both('thigh'), ...both('shin')], 'xz')],
  ['armLength', channel(both('arm'), 'xyz')],
]

export function personRig(model) {
  const pivots = JSON.parse(model.extras('Body').rigPivots ?? 'null')
  if (!pivots) {
    throw new Error('The body node has no rigPivots extras.')
  }

  const groups = Object.fromEntries([...Object.keys(LANDMARKS), 'hull'].map((name) => [name, []]))
  const source = []
  const sourceMeshes = []
  const positions = []
  const skinBones = []
  const skinWeights = []
  for (const meshName of model.meshNames) {
    const points = model.positions(meshName)
    const indices = model.attribute(meshName, '_SKIN_INDEX')
    const weights = model.attribute(meshName, '_SKIN_WEIGHT')
    const landmarks = meshName === 'Body' ? model.attribute(meshName, '_LANDMARK') : null
    points.forEach((point, index) => {
      const landmark = landmarks ? Math.round(landmarks[index][0]) : 0
      const hull = index % HULL_STRIDE === 0
      if (!landmark && !hull) {
        return
      }
      const local = source.length
      source.push(index)
      sourceMeshes.push(meshName)
      positions.push(...point.map(round))
      const total = weights[index].reduce((sum, value) => sum + value, 0) || 1
      const normalized = weights[index].map((value) => round(value / total))
      normalized[0] = round(1 - normalized[1] - normalized[2] - normalized[3])
      skinBones.push(...indices[index].map(Math.round))
      skinWeights.push(...normalized)
      if (landmark) {
        groups[Object.keys(LANDMARKS).find((name) => LANDMARKS[name] === landmark)].push(local)
      }
      if (hull) {
        groups.hull.push(local)
      }
    })
  }
  for (const [name, members] of Object.entries(groups)) {
    if (members.length === 0) {
      throw new Error(`Person rig group ${name} is empty.`)
    }
  }
  groups.shoulders = [...groups.shoulderLeft, ...groups.shoulderRight]
  groups.hips = [...groups.hipLeft, ...groups.hipRight]

  // Pivots are in Blender space (z up, -y forward); glTF is y up, +z forward.
  const toGltf = ([x, y, z]) => [round(x), round(z), round(-y)]
  return {
    version: 1,
    mesh: 'Body',
    bones: BONES.map((name) => ({
      name,
      parent: PARENTS[name],
      head: toGltf(pivots[name]),
      ...(name === 'root' ? {} : { inheritScale: false }),
    })),
    vertices: { source, sourceMeshes, positions, skinBones, skinWeights },
    morphs: [],
    controls: CONTROLS.map(([name, channels]) => ({ name, min: 0.3, max: 3, channels })),
    groups,
    measures: [
      { name: 'ankle', kind: 'max', group: 'ankle', axis: 'y' },
      { name: 'knee', kind: 'max', group: 'knee', axis: 'y' },
      { name: 'crotch', kind: 'max', group: 'crotch', axis: 'y' },
      { name: 'shoulder', kind: 'max', group: 'shoulderLeft', axis: 'y' },
      { name: 'neck', kind: 'max', group: 'neck', axis: 'y' },
      { name: 'ear', kind: 'max', group: 'ear', axis: 'y' },
      { name: 'stature', kind: 'max', group: 'crown', axis: 'y' },
      { name: 'biacromialBreadth', kind: 'extent', group: 'shoulders', axis: 'x' },
      { name: 'hipBreadth', kind: 'extent', group: 'hips', axis: 'x' },
      { name: 'footLength', kind: 'extent', group: 'soleEnds', axis: 'z' },
      // The arm hangs in an A-pose; scaled uniformly, its drop from shoulder to wrist tracks its length.
      { name: 'armLength', kind: 'between', from: 'wrist', to: 'shoulderLeft', axis: 'y' },
    ],
    hull: 'hull',
  }
}

export function personRigFile(model) {
  return { version: 1, rigs: [personRig(model)] }
}
