import { Html, useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CompareApp } from '../../app/compare-app.ts'
import type { HeightWorld } from '../../domain/height-world.ts'
import type { LengthUnit } from '../../domain/measure.ts'
import { BlobShadow } from '../blob-shadow.tsx'
import { toHumanDraw, type HumanDraw } from '../draw.ts'
import { useModel } from '../models.ts'

type FigureProps = {
  app: CompareApp
  draw: HumanDraw
}

/** Stands in at the target height while the textured model downloads. */
function LoadingSilhouette({ height }: { height: number }) {
  const radius = height * 0.11
  return (
    <mesh position={[0, height / 2, 0]}>
      <capsuleGeometry args={[radius, Math.max(0.1, height - radius * 2), 4, 16]} />
      <meshStandardMaterial color="#8d938f" roughness={1} transparent opacity={0.4} />
    </mesh>
  )
}

function HumanModel({ app, draw }: FigureProps) {
  const { object, bounds } = useModel(draw.model)
  const [hovered, setHovered] = useState(false)
  const ring = useRef<THREE.Mesh>(null)
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(draw.scale)
  const center = bounds.getCenter(new THREE.Vector3()).multiplyScalar(draw.scale)
  const ringRadius = Math.max(size.z * 0.68, 0.3)

  useCursor(hovered)
  useFrame(({ clock }) => {
    if (!ring.current || !ringMaterial.current || !draw.selected) {
      return
    }

    const pulse = 1 + Math.sin(clock.elapsedTime * 3.4) * 0.035
    ring.current.scale.setScalar(pulse)
    ringMaterial.current.opacity = 0.54 + Math.sin(clock.elapsedTime * 3.4) * 0.12
  })

  function select(event: ThreeEvent<MouseEvent>): void {
    event.stopPropagation()
    app.select(draw.id)
  }

  return (
    <>
      <primitive object={object} scale={draw.scale} />
      <BlobShadow radiusX={size.z * 0.85} radiusZ={size.z * 0.6} position={[0, 0, 0.06 * draw.scale]} />
      {/* Invisible hit box: pointer events raycast this box instead of the 80k-triangle body. */}
      <mesh
        position={[center.x, center.y, center.z]}
        onClick={select}
        onDoubleClick={(event) => {
          select(event)
          app.frameSelection()
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {(draw.selected || hovered) && (
        <mesh ref={ring} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringRadius * 0.86, ringRadius, 64]} />
          <meshBasicMaterial
            ref={ringMaterial}
            color={draw.selected ? '#e7a45d' : '#ffffff'}
            transparent
            opacity={draw.selected ? 0.66 : 0.32}
            depthWrite={false}
          />
        </mesh>
      )}
      {draw.selected && (
        <Html
          center
          position={[0, size.y + 0.14, 0]}
          distanceFactor={7}
          style={{ pointerEvents: 'none' }}
        >
          <span className="scene-label is-selected">{draw.label}</span>
        </Html>
      )}
    </>
  )
}

function HumanFigure({ app, draw }: FigureProps) {
  return (
    <group position={draw.position} rotation={[0, draw.yaw, 0]}>
      <Suspense fallback={<LoadingSilhouette height={draw.referenceHeightM * draw.scale} />}>
        <HumanModel app={app} draw={draw} />
      </Suspense>
    </group>
  )
}

export function HumanFigures({
  app,
  world,
  unit,
}: {
  app: CompareApp
  world: HeightWorld
  unit: LengthUnit
}) {
  return world.placements.map((placement) => (
    <HumanFigure
      key={placement.id}
      app={app}
      draw={toHumanDraw(placement, world.selected, unit)}
    />
  ))
}
