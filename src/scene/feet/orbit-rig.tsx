import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import type { NavRig } from '../../app/compare-app.ts'
import type { FeetWorld } from '../../domain/feet-world.ts'
import type { FeetOrbitSnapshot } from '../../domain/navigation.ts'

function defaultView(): FeetOrbitSnapshot {
  return {
    kind: 'orbit',
    target: [0, 0.08, 0],
    position: [1.15, 1.2, 1.55],
  }
}

function selectionView(world: FeetWorld): FeetOrbitSnapshot {
  const selected = world.placements.find((placement) => placement.id === world.selected)
  if (!selected) {
    return defaultView()
  }

  const length = selected.shape.lengthMm / 1000
  return {
    kind: 'orbit',
    target: [selected.pose.x, length * 0.6, selected.pose.z + length * 0.35],
    position: [
      selected.pose.x + length * 1.9,
      length * 2.4,
      selected.pose.z + length * 2.9,
    ],
  }
}

export function FeetOrbitRig({ world, rig }: { world: FeetWorld; rig: NavRig }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const initialized = useRef(false)
  const { camera } = useThree()

  const apply = useCallback(
    (snapshot: FeetOrbitSnapshot): void => {
      camera.position.set(...snapshot.position)
      camera.near = 0.005
      camera.far = 20
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
    apply(saved?.kind === 'orbit' ? saved : defaultView())
    initialized.current = true
  })

  useEffect(() => {
    if (world.cameraIntent.kind === 'none') {
      return
    }

    const intent = rig.consumeFeetIntent()
    if (intent.kind === 'frame-selection') {
      apply(selectionView(world))
    } else if (intent.kind === 'reset') {
      apply(defaultView())
    } else if (intent.kind === 'restore' && intent.snapshot.kind === 'orbit') {
      apply(intent.snapshot)
    }
  }, [apply, rig, world, world.cameraIntent])

  function snapshot(): FeetOrbitSnapshot {
    const target = controls.current?.target ?? new THREE.Vector3(0, 0.08, 0)
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
      dampingFactor={0.08}
      minDistance={0.25}
      maxDistance={4}
      minPolarAngle={0.08}
      maxPolarAngle={Math.PI / 2 - 0.025}
      target={[0, 0.08, 0]}
      onEnd={() => rig.commitFeetSnapshot(snapshot())}
    />
  )
}
