import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import type { NavRig } from '../../app/compare-app.ts'
import type { HeightWorld } from '../../domain/height-world.ts'
import type { HeightOrbitSnapshot } from '../../domain/navigation.ts'
import { humanLineupX } from '../draw.ts'

/** Matches the canvas camera in scene/canvas.tsx. */
const VERTICAL_FOV_DEG = 38

/**
 * Frames the whole lineup: backs off until both the lineup's width and the
 * tallest person fit the stage at its current aspect ratio.
 */
function defaultView(world: HeightWorld, aspect: number): HeightOrbitSnapshot {
  const placements = world.placements
  const xs = [...humanLineupX(placements).values()]
  const centerX = xs.length === 0 ? 0 : (Math.max(...xs) + Math.min(...xs)) / 2
  const span = xs.length < 2 ? 2.4 : Math.max(...xs) - Math.min(...xs)
  const tallest = Math.max(1.9, ...placements.map((placement) => placement.heightMm / 1000))
  const halfVertical = THREE.MathUtils.degToRad(VERTICAL_FOV_DEG / 2)
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect)
  // The outermost people extend about one arm span past their stance points.
  const fitWidth = (span / 2 + Math.max(1.2, tallest * 0.45)) / Math.tan(halfHorizontal)
  const fitHeight = (tallest * 0.6) / Math.tan(halfVertical)
  const distance = Math.max(5.2, fitWidth, fitHeight)
  return {
    kind: 'orbit',
    target: [centerX, Math.max(0.95, tallest * 0.5), 0],
    position: [centerX + distance * 0.42, Math.max(2.35, tallest * 0.8), distance],
  }
}

function selectionView(world: HeightWorld, aspect: number): HeightOrbitSnapshot {
  const selected = world.placements.find((placement) => placement.id === world.selected)
  if (!selected) {
    return defaultView(world, aspect)
  }

  const height = selected.heightMm / 1000
  const x = humanLineupX(world.placements).get(selected.id) ?? 0
  return {
    kind: 'orbit',
    target: [x, height * 0.52, selected.pose.z],
    position: [x + height * 0.8, height * 0.72, selected.pose.z + height * 2.1],
  }
}

export function HeightOrbitRig({
  world,
  rig,
}: {
  world: HeightWorld
  rig: NavRig
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const initialized = useRef(false)
  const { camera, size } = useThree()
  const aspect = size.width / Math.max(1, size.height)

  const apply = useCallback(
    (snapshot: HeightOrbitSnapshot): void => {
      camera.position.set(...snapshot.position)
      camera.near = 0.03
      camera.far = 90
      camera.updateProjectionMatrix()
      controls.current?.target.set(...snapshot.target)
      controls.current?.update()
    },
    [camera],
  )

  useEffect(() => {
    if (initialized.current) {
      return
    }

    const saved = world.savedNav
    apply(saved?.kind === 'orbit' ? saved : defaultView(world, aspect))
    initialized.current = true
  })

  useEffect(() => {
    if (world.cameraIntent.kind === 'none') {
      return
    }

    const intent = rig.consumeHeightIntent()
    if (intent.kind === 'frame-selection') {
      apply(selectionView(world, aspect))
    } else if (intent.kind === 'reset') {
      apply(defaultView(world, aspect))
    } else if (intent.kind === 'restore' && intent.snapshot.kind === 'orbit') {
      apply(intent.snapshot)
    }
  }, [apply, aspect, rig, world, world.cameraIntent])

  function snapshot(): HeightOrbitSnapshot {
    const target = controls.current?.target ?? new THREE.Vector3(0, 0.95, 0)
    return {
      kind: 'orbit',
      target: [target.x, target.y, target.z],
      position: [camera.position.x, camera.position.y, camera.position.z],
    }
  }

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      minDistance={1.2}
      maxDistance={32}
      maxPolarAngle={Math.PI / 2 - 0.025}
      target={[0, 0.95, 0]}
      onEnd={() => rig.commitHeightSnapshot(snapshot())}
    />
  )
}
