// Diagnostic views: production assets, stature policy, WASM solver and skinning.
// Orthographic framing normalizes total stature to isolate changes in proportions.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { loadKernel, RigSolver } from '../src/kernel/index.ts'
import { statureTargets, STATURE_TOLERANCE_MM } from '../src/domain/stature.ts'
import { applyPose, rigNode } from '../src/scene/rigged.ts'

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(400, 620)
renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1
document.body.append(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color('#191f23')
const environment = new THREE.PMREMGenerator(renderer)
const room = new RoomEnvironment()
const environmentMap = environment.fromScene(room, 0.04)
scene.environment = environmentMap.texture
scene.environmentIntensity = 0.85
scene.add(new THREE.HemisphereLight('#f4f6f2', '#343d44', 0.5))
const key = new THREE.DirectionalLight('#fff9f2', 2.2)
key.position.set(4, 7, 5)
scene.add(key)
const fill = new THREE.DirectionalLight('#c9d7dc', 0.7)
fill.position.set(-4, 3.5, -2)
scene.add(fill)
await loadKernel('/src/kernel/pkg/kernel_bg.wasm')
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const cached = new Map()

window.captureStature = async (id, heightMm, angle = 'front') => {
  if (!cached.has(id)) {
    const gltf = await loader.loadAsync(`/models/${id}.glb`)
    const { rigs: [rig] } = await (await fetch(`/models/${id}.rig.json`)).json()
    const solver = new RigSolver(rig)
    const authored = Object.fromEntries(Object.entries(solver.evaluate().measures).map(([k,v])=>[k,v*1000]))
    cached.set(id, { person: rigNode(gltf.scene, rig), solver, authored })
  }
  const { person, solver, authored } = cached.get(id)
  const mm = heightMm ?? authored.stature
  const targets = statureTargets(id.startsWith('female') ? 'female' : 'male', authored, mm)
  const solved = solver.solve(Object.fromEntries(Object.entries(targets).map(([k,v])=>[k,v/1000])), { tolerance: STATURE_TOLERANCE_MM / 1000 })
  applyPose(person, solver.pose(solved.controls))
  person.root.rotation.y = angle === 'side' ? -Math.PI/2 : angle === 'three-quarter' ? -Math.PI/4 : 0
  scene.add(person.root)
  const height = mm / 1000
  const halfY = height * .64
  const halfX = halfY * 400/620
  const camera = new THREE.OrthographicCamera(-halfX,halfX,halfY,-halfY,.01,20)
  camera.position.set(0,height*.5,6)
  camera.lookAt(0,height*.5,0)
  scene.updateMatrixWorld(true)
  renderer.render(scene,camera)
  renderer.getContext().finish()
  const url = renderer.domElement.toDataURL('image/png')
  scene.remove(person.root)
  return { url, heightMm: mm, maxErrorMm: solved.maxError * 1000 }
}
window.statureReady = true
