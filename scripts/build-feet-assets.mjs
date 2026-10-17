// Rebuilds the feet GLBs from Daz Genesis 9 characters and writes their rig
// files. Needs Blender 4.2+ with the Diffeomorphic DAZ importer and the Daz
// content library (see tools/assets/build_feet.py). The shipped results live in
// public/models; this only runs when the assets change.
//
//   npm run assets:feet [model id ...]
//
// BLENDER_BIN points at the Blender binary; DAZ_LIBRARY at the content library.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { feetRigFile } from './foot-rig.mjs'
import { readGlb } from './glb.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const models = `${root}public/models`
const blender = process.env.BLENDER_BIN ?? '/Applications/Blender/Blender 5.2.app/Contents/MacOS/Blender'
const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['female-feet-shins', 'male-feet-shins']

if (!existsSync(blender)) {
  console.error(`Blender not found at ${blender}. Set BLENDER_BIN to the Blender executable.`)
  process.exit(1)
}

for (const id of ids) {
  const glbPath = `${models}/${id}.glb`
  const result = spawnSync(blender, ['-b', '--python', `${root}tools/assets/build_feet.py`, '--', id, glbPath], {
    encoding: 'utf8',
  })
  for (const line of `${result.stdout}\n${result.stderr}`.split('\n')) {
    if (line.startsWith('[build_feet]') || /Error|Traceback/.test(line)) {
      console.log(line)
    }
  }
  if (result.status !== 0 || !existsSync(glbPath)) {
    console.error(`Blender failed to build ${id}.`)
    process.exit(1)
  }
  rmSync(`${models}/.${id}-textures`, { recursive: true, force: true })

  const rigPath = `${models}/${id}.rig.json`
  writeFileSync(rigPath, `${JSON.stringify(feetRigFile(readGlb(glbPath)))}\n`)
  console.log(`Wrote ${glbPath.replace(root, '')} and ${rigPath.replace(root, '')}.`)
}
