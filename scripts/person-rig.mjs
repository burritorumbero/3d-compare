// Builds the stature rig file for a person GLB from what tools/assets/build_people.py
// authored: `_SKIN_INDEX`/`_SKIN_WEIGHT` on every mesh, `_LANDMARK` ids on the
// body, and bone pivots in the body node's extras. Bones and landmark ids must
// match BONES and LANDMARKS in build_people.py.
//
// Every segment bone moves with its parent without inheriting its scale, so a
// segment's own control changes only that segment. Joint paths and surface
// widths constrain length and girth separately using src/domain/stature.ts.

const BONES = ['root', 'foot.L', 'foot.R', 'shin.L', 'shin.R', 'thigh.L', 'thigh.R', 'pelvis', 'chest', 'neck', 'head', 'arm.L', 'arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R']
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
  'forearm.L': 'arm.L',
  'forearm.R': 'arm.R',
  'hand.L': 'forearm.L',
  'hand.R': 'forearm.R',
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
  ['neckWidth', channel(['neck'], 'xz')],
  ['stature', channel(['head'], 'xyz')],
  ['biacromialBreadth', channel(['chest'], 'xz')],
  ['hipBreadth', channel(['pelvis', ...both('thigh'), ...both('shin')], 'xz')],
  ['armLength', channel([...both('arm'), ...both('forearm')], 'y')],
  ['armWidth', channel([...both('arm'), ...both('forearm')], 'xz')],
  ['handWidth', channel(both('hand'), 'xyz')],
]

const subtract = (a, b) => a.map((value, i) => value - b[i])
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0)
const normalize = (v) => v.map((value) => value / Math.hypot(...v))
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
const toGltf = ([x, y, z]) => [round(x), round(z), round(-y)]

function limbBasis(start, end) {
  const y = normalize(subtract(end, start))
  const x = normalize(cross(y, [0, 0, 1]))
  return [...x, ...y, ...cross(x, y)]
}

const limbEnd = (name) => name.startsWith('arm.') ? name.replace('arm.', 'forearm.') : name.replace('forearm.', 'hand.')

/** Actual surface samples, separate from the joint path used for arm length. */
function widthGroups(model, heads) {
  const points = model.positions('Body')
  const indices = model.attribute('Body', '_SKIN_INDEX')
  const weights = model.attribute('Body', '_SKIN_WEIGHT')
  const pure = (bone, minimum = .99) => points.flatMap((_, i) => {
    const weight = indices[i].reduce((sum, index, slot) => sum + (Math.round(index) === BONES.indexOf(bone) ? weights[i][slot] : 0), 0)
    return weight / weights[i].reduce((a,b)=>a+b,0) > minimum ? [i] : []
  })
  const extremes = (vertices, direction) => {
    if (vertices.length < 2) throw new Error('Missing pure-region width samples.')
    const sorted = vertices.toSorted((a,b) => dot(points[a],direction)-dot(points[b],direction))
    return [sorted[0], sorted.at(-1)]
  }
  const diameter = (bone, origin, direction, at, hint) => {
    const vertices = pure(bone)
    const radial = normalize(subtract(hint, direction.map(v=>v*dot(hint,direction))))
    const band = vertices.filter(i=>Math.abs(dot(subtract(points[i],origin),direction)-at)<.008)
    return extremes(band, radial)
  }
  const upper = subtract(heads['forearm.L'], heads['arm.L'])
  const arm = diameter('arm.L', heads['arm.L'], normalize(upper), Math.hypot(...upper)*.55, [0,0,1])
  const handVertices = pure('hand.L')
  const handCenter = [0,1,2].map(axis=>handVertices.reduce((sum,i)=>sum+points[i][axis],0)/handVertices.length)
  const handDirection = normalize(subtract(handCenter,heads['hand.L']))
  const handLength = Math.max(...handVertices.map(i=>dot(subtract(points[i],heads['hand.L']),handDirection)))
  const hand = diameter('hand.L', heads['hand.L'], handDirection, handLength*.35, [1,0,0])
  return {
    headWidth: extremes(pure('head'), [1,0,0]),
    // Genesis blends the entire neck into head/chest; there is no pure neck ring.
    neckWidth: extremes(pure('neck', .7), [1,0,0]),
    armFront: [arm[0]], armBack: [arm[1]],
    handInner: [hand[0]], handOuter: [hand[1]],
  }
}

export function personRig(model) {
  const pivots = JSON.parse(model.extras('Body').rigPivots ?? 'null')
  if (!pivots) {
    throw new Error('The body node has no rigPivots extras.')
  }
  const heads = Object.fromEntries(BONES.map(name => [name, toGltf(pivots[name])]))
  const widths = widthGroups(model, heads)
  const groups = Object.fromEntries([...Object.keys(LANDMARKS), ...Object.keys(widths), 'hull'].map((name) => [name, []]))
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
      const widthMemberships = meshName === 'Body' ? Object.keys(widths).filter(name => widths[name].includes(index)) : []
      if (!landmark && !hull && !widthMemberships.length) {
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
      for (const name of widthMemberships) groups[name].push(local)
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
  return {
    version: 1,
    mesh: 'Body',
    bones: BONES.map((name) => ({
      name,
      parent: PARENTS[name],
      head: heads[name],
      ...(/^(arm|forearm)\./.test(name) ? { basis: limbBasis(heads[name], heads[limbEnd(name)]) } : {}),
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
      { name: 'armLength', kind: 'bonePath', from: 'arm.L', to: 'hand.L' },
      { name: 'headWidth', kind: 'extent', group: 'headWidth', axis: 'x' },
      { name: 'neckWidth', kind: 'extent', group: 'neckWidth', axis: 'x' },
      { name: 'armWidth', kind: 'distance', from: 'armFront', to: 'armBack' },
      { name: 'handWidth', kind: 'distance', from: 'handInner', to: 'handOuter' },
    ],
    hull: 'hull',
  }
}

export function personRigFile(model) {
  return { version: 1, rigs: [personRig(model)] }
}
