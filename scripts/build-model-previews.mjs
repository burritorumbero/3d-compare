// Render small library thumbnails from shipped assets. Run against the Vite dev server.
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { HUMAN_CATALOG } from '../src/catalog/humans.ts'
import { FEET_CATALOG } from '../src/catalog/feet.ts'
import { defaultFootSkinTone, FOOT_SKIN_TONES } from '../src/domain/foot-skin.ts'
import { launchChrome } from './browser.mjs'

const baseUrl = process.env.APP_URL ?? 'http://127.0.0.1:43123'
const browser = await launchChrome()
const page = await browser.newPage()
try {
  await page.route('**/__model_previews', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }),
  )
  await page.goto(`${baseUrl}/__model_previews`)
  await mkdir('public/previews', { recursive: true })
  const entries = process.argv.includes('--feet-only') ? FEET_CATALOG : [...HUMAN_CATALOG, ...FEET_CATALOG]
  const variants = entries.flatMap((entry) => entry.id.startsWith('foot-')
    ? FOOT_SKIN_TONES.map((skinTone) => ({ entry, skinTone }))
    : [{ entry, skinTone: undefined }])
  for (const { entry, skinTone } of variants) {
    const image = await page.evaluate(
      async ({ file, feet, catalogId, skinTone }) => {
        const THREE = await import('/node_modules/three/build/three.module.js')
        const { GLTFLoader } = await import(
          '/node_modules/three/examples/jsm/loaders/GLTFLoader.js'
        )
        const { MeshoptDecoder } = await import(
          '/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js'
        )
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
        })
        renderer.setSize(360, 400)
        renderer.setPixelRatio(1)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.NeutralToneMapping
        const scene = new THREE.Scene()
        const model = (
          await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/models/${file}`)
        ).scene
        model.traverse((child) => {
          if (child.isMesh)
            for (const material of Array.isArray(child.material)
              ? child.material
              : [child.material]) {
              if (material.transparent) {
                material.transparent = false
                material.alphaToCoverage = true
                material.alphaTest = 0.1
                material.depthWrite = true
              }
            }
        })
        let restoreMaterials = () => {}
        if (feet) {
          const { applyFootSkinTone } = await import('/src/scene/feet/skin-materials.ts')
          const meshes = []
          model.traverse((child) => { if (child.isMesh) meshes.push(child) })
          restoreMaterials = applyFootSkinTone(meshes, catalogId, skinTone)
        }
        scene.add(model)
        const bounds = new THREE.Box3().setFromObject(model)
        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        const frame = Math.max(size.y * 1.08, (size.x / 0.9) * 1.06)
        const camera = new THREE.OrthographicCamera(
          -frame * 0.45,
          frame * 0.45,
          frame / 2,
          -frame / 2,
          0.01,
          30,
        )
        camera.position
          .copy(center)
          .add(new THREE.Vector3(feet ? 0.5 : 0.15, feet ? 0.45 : 0.03, feet ? 0.9 : 4))
        camera.lookAt(center)
        scene.add(new THREE.HemisphereLight('#f5f6f6', '#667782', 2))
        const key = new THREE.DirectionalLight('#fff7ee', 2.8)
        key.position.set(-3, 5, 5)
        scene.add(key)
        const fill = new THREE.DirectionalLight('#d9eaff', 1.4)
        fill.position.set(3, 2, 1)
        scene.add(fill)
        renderer.render(scene, camera)
        const data = renderer.domElement.toDataURL('image/png')
        restoreMaterials()
        scene.traverse((child) => {
          if (child.isMesh) {
            child.geometry.dispose()
            for (const material of Array.isArray(child.material)
              ? child.material
              : [child.material]) {
              for (const value of Object.values(material)) if (value?.isTexture) value.dispose()
              material.dispose()
            }
          }
        })
        renderer.dispose()
        renderer.forceContextLoss()
        return data
      },
      { file: entry.model.file, feet: entry.id.startsWith('foot-'), catalogId: entry.id, skinTone },
    )
    const suffix = skinTone && skinTone !== defaultFootSkinTone(entry.id) ? `-${skinTone}` : ''
    const file = `public/previews/${entry.model.file.replace('.glb', `${suffix}.webp`)}`
    await writeFile(
      file,
      await sharp(Buffer.from(image.split(',')[1], 'base64'))
        .webp({ quality: 86 })
        .toBuffer(),
    )
    console.log(`Rendered ${file}`)
  }
} finally {
  await browser.close()
}
