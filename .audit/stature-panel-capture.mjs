// Baseline sheets are preserved; this helper now writes stature-current-* sheets.
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { launchChrome } from '../scripts/browser.mjs'

const browser = await launchChrome()
const page = await browser.newPage({ viewport: { width: 420, height: 640 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const directory = new URL('file:///tmp/3d-compare-stature-audit/')
const renderDirectory = new URL('../.design/renders/', import.meta.url)
await mkdir(directory, { recursive: true })
const panels = []
try {
  await page.goto('http://127.0.0.1:43123/.audit/stature-panel.html')
  await page.waitForFunction(() => window.statureReady, null, { timeout: 30000 })
  for (const [id, label] of [['female-pale-shorts-croptop','Sloane'], ['male-dark-jeans-sleeveless','Miles']]) {
    for (const angle of ['front', 'side']) {
      for (const heightMm of [null, 2000, 2400, 3048]) {
        const result = await page.evaluate(({id,heightMm,angle}) => window.captureStature(id,heightMm,angle), {id,heightMm,angle})
        const path = new URL(`${label.toLowerCase()}-${angle}-${Math.round(result.heightMm)}.png`, directory)
        const png = Buffer.from(result.url.split(',')[1], 'base64')
        await writeFile(path, png)
        panels.push({label,angle,heightMm:result.heightMm,png})
        console.log(`${label} ${angle} ${result.heightMm.toFixed(1)}mm captured; error ${result.maxErrorMm.toFixed(4)}mm`)
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
  for (const angle of ['front','side']) {
    const selected = panels.filter(p=>p.angle===angle)
    const composite = []
    for (let i=0; i<selected.length; i++) {
      const p = selected[i]
      const x = (i%4)*400, y = Math.floor(i/4)*680+90
      const label = `${p.label} · ${(p.heightMm/10).toFixed(1)} cm${i%4===0 ? ' (authored)' : ''}`
      composite.push({input:p.png,left:x,top:y+45})
      composite.push({input:Buffer.from(`<svg width="400" height="45"><text x="200" y="30" fill="#dce6e8" font-size="21" font-family="Arial" text-anchor="middle">${label}</text></svg>`),left:x,top:y})
    }
    composite.push({input:Buffer.from(`<svg width="1600" height="90"><text x="30" y="38" fill="#f0f6f6" font-size="28" font-family="Arial">Current height scaling · ${angle} view</text><text x="30" y="70" fill="#9fb2bc" font-size="20" font-family="Arial">Equal displayed stature / orthographic camera. Compare relative dimensions independently of camera zoom.</text></svg>`),left:0,top:0})
    await sharp({create:{width:1600,height:1450,channels:4,background:'#191f23'}}).composite(composite).png().toFile(new URL(`stature-current-${angle}-comparison.png`,renderDirectory).pathname)
  }
} finally { await browser.close() }
