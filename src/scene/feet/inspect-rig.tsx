import { MapControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import type { NavRig } from '../../app/compare-app.ts'
import { footLineupPose, type FeetWorld } from '../../domain/feet-world.ts'
import type { FeetInspectSnapshot } from '../../domain/navigation.ts'

function defaultView(): FeetInspectSnapshot {
  return {
    kind: 'inspect',
    target: [0, 0.04, 0],
    position: [0, 1.7, 0.75],
  }
}

function selectionView(world: FeetWorld): FeetInspectSnapshot {
  const selected = world.placements.find((placement) => placement.id === world.selected)
  if (!selected) {
    return defaultView()
  }

  const { x, z } = footLineupPose(world, selected.id)
  return {
    kind: 'inspect',
    target: [x, 0.04, z + 0.09],
    position: [x, 0.95, z + 0.45],
  }
}

export function FeetInspectRig({ world, rig }: { world: FeetWorld; rig: NavRig }) {
  const controls = useRef<ComponentRef<typeof MapControls>>(null)
  const initialized = useRef(false)
  const { camera } = useThree()

  const apply = useCallback(
    (snapshot: FeetInspectSnapshot): void => {
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
    apply(saved?.kind === 'inspect' ? saved : defaultView())
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
    } else if (intent.kind === 'restore' && intent.snapshot.kind === 'inspect') {
      apply(intent.snapshot)
    }
  }, [apply, rig, world, world.cameraIntent])

  function snapshot(): FeetInspectSnapshot {
    const target = controls.current?.target ?? new THREE.Vector3(0, 0.04, 0)
    return {
      kind: 'inspect',
      target: [target.x, target.y, target.z],
      position: [camera.position.x, camera.position.y, camera.position.z],
    }
  }

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.1}
      enableRotate={false}
      screenSpacePanning={false}
      minDistance={0.2}
      maxDistance={3}
      target={[0, 0.04, 0]}
      onEnd={() => rig.commitFeetSnapshot(snapshot())}
    />
  )
}
