import { mkdir, writeFile, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { launchChrome } from '../scripts/browser.mjs'

const models = [
  ['female-pale-shorts-croptop', 'Sloane'], ['female-tan-dress', 'Ari'],
  ['female-dark-jeans-tshirt', 'Mika'], ['male-tan-shorts-tshirt', 'Luca'],
  ['male-dark-jeans-sleeveless', 'Miles'], ['male-pale-trousers-shirt', 'Owen'],
]
const directory = '/tmp/3d-compare-stature-fixed'
await mkdir(directory, { recursive: true })
const browser = await launchChrome()
const page = await browser.newPage({ viewport: { width: 420, height: 640 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(`${message.location().url}: ${message.text()}`) })
await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
const captures = []
try {
  await page.goto(`${process.env.APP_URL ?? 'http://127.0.0.1:43123'}/.audit/stature-panel.html`)
  await page.waitForFunction(() => window.statureReady)
  for (const [id, label] of models) {
    for (const heightMm of [900, null, 2000, 2400, 3048]) {
      for (const angle of ['front', 'side', 'three-quarter']) {
        const result = await page.evaluate(({ id, heightMm, angle }) => window.captureStature(id, heightMm, angle), { id, heightMm, angle })
        const path = `${directory}/${label.toLowerCase()}-${angle}-${Math.round(result.heightMm)}.png`
        const png = Buffer.from(result.url.split(',')[1], 'base64')
        const stats = await sharp(png).stats()
        if (!stats.channels.slice(0,3).some(channel => channel.max - channel.min > 100)) {
          throw new Error(`${label} ${angle} ${result.heightMm}: blank capture`)
        }
        await writeFile(path, png)
        captures.push({ label, angle, heightMm: result.heightMm, maxErrorMm: result.maxErrorMm, path })
      }
    }
    console.log(`Captured ${label}: five heights, three views`)
  }
  if (errors.length) throw new Error(errors.join('\n'))
  await writeFile('.audit/stature-fixed-captures.json', JSON.stringify(captures, null, 2) + '\n')
  const title = (text, width=400, height=45) => Buffer.from(`<svg width="${width}" height="${height}"><text x="20" y="30" fill="#e7eef1" font-size="21" font-family="Arial">${text}</text></svg>`)
  for (const angle of ['front','side','three-quarter']) {
    const composite = []
    for (let i=0; i<models.length; i++) {
      const label=models[i][1], x=i%3*400, y=Math.floor(i/3)*665
      composite.push({ input:title(`${label} · 304.8 cm`), left:x, top:y })
      composite.push({ input:await readFile(`${directory}/${label.toLowerCase()}-${angle}-3048.png`), left:x, top:y+45 })
    }
    await sharp({create:{width:1200,height:1330,channels:4,background:'#191f23'}}).composite(composite).png().toFile(`${directory}/all-${angle}.png`)
  }
  const comparison=[]
  for (const [row,label] of ['Sloane','Miles'].entries()) {
    for (const [view,angle] of ['front','side'].entries()) {
      const before=await sharp(`.design/renders/stature-${angle}-comparison.png`).extract({left:1200,top:row*680+135,width:400,height:620}).toBuffer()
      const after=await readFile(`${directory}/${label.toLowerCase()}-${angle}-3048.png`)
      for (const [column,png] of [before,after].entries()) {
        const x=(view*2+column)*400,y=row*665+65
        comparison.push({input:title(`${label} · ${angle} · ${column?'after':'before'}`),left:x,top:y})
        comparison.push({input:png,left:x,top:y+45})
      }
    }
  }
  comparison.push({input:title('Height scaling at 304.8 cm (10 ft) · identical camera and lighting',1600,65),left:0,top:0})
  await sharp({create:{width:1600,height:1395,channels:4,background:'#191f23'}}).composite(comparison).png().toFile('.design/renders/stature-fix-before-after.png')
} finally { await browser.close() }
