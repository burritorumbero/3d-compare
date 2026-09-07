import { Html, useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CompareApp } from '../../app/compare-app.ts'
import type { FeetWorld } from '../../domain/feet-world.ts'
import type { ShoeSystem } from '../../domain/shoe-charts.ts'
import { BlobShadow } from '../blob-shadow.tsx'
import { toFootDraw, type FootDraw } from '../draw.ts'
import { useModel } from '../models.ts'

/** Gap between the inner edges of the two feet once the authored stance is narrowed. */
const PAIR_GAP_M = 0.05

type FigureProps = {
  app: CompareApp
  draw: FootDraw
}

function footBox(mesh: THREE.Mesh): THREE.Box3 {
  if (!mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox()
  }

  return mesh.geometry.boundingBox!.clone()
}

/**
 * The pack authors each pair in a relaxed stance about 0.45 m across. Sliding the
 * two rigid feet toward the center keeps every pair compact on the table without
 * touching the meshes themselves. Returns the bounds of the narrowed pair.
 */
function narrowStance(pair: THREE.Group, fallback: THREE.Box3): THREE.Box3 {
  const left = pair.getObjectByName('LeftFootAndShin')
  const right = pair.getObjectByName('RightFootAndShin')
  if (!(left instanceof THREE.Mesh) || !(right instanceof THREE.Mesh)) {
    return fallback
  }

  const leftBox = footBox(left)
  const rightBox = footBox(right)
  const innerEdge = Math.min(leftBox.min.x, -rightBox.max.x)
  const shift = Math.max(0, innerEdge - PAIR_GAP_M / 2)
  left.position.x = -shift
  right.position.x = shift
  return leftBox
    .translate(new THREE.Vector3(-shift, 0, 0))
    .union(rightBox.translate(new THREE.Vector3(shift, 0, 0)))
}

/** Stands in at the target size while the textured pair downloads. */
function LoadingSilhouette({ scale }: { scale: number }) {
  return (
    <mesh position={[0, 0.16 * scale, 0.09 * scale]}>
      <boxGeometry args={[0.3 * scale, 0.32 * scale, 0.26 * scale]} />
      <meshStandardMaterial color="#8f7a66" roughness={1} transparent opacity={0.4} />
    </mesh>
  )
}

function FootModel({ app, draw }: FigureProps) {
  const { object, bounds } = useModel(draw.model)
  const pairBounds = useMemo(() => narrowStance(object, bounds), [object, bounds])
  const [hovered, setHovered] = useState(false)
  const ring = useRef<THREE.Mesh>(null)
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const size = pairBounds.getSize(new THREE.Vector3()).multiplyScalar(draw.scale)
  const center = pairBounds.getCenter(new THREE.Vector3()).multiplyScalar(draw.scale)
  const ringX = size.x / 2 + 0.04
  const ringZ = size.z / 2 + 0.04

  useCursor(hovered)
  useFrame(({ clock }) => {
    if (!ring.current || !ringMaterial.current || !draw.selected) {
      return
    }

    const pulse = 1 + Math.sin(clock.elapsedTime * 3.8) * 0.04
    ring.current.scale.set(ringX * pulse, ringZ * pulse, 1)
    ringMaterial.current.opacity = 0.58 + Math.sin(clock.elapsedTime * 3.8) * 0.1
  })

  function select(event: ThreeEvent<MouseEvent>): void {
    event.stopPropagation()
    app.select(draw.id)
  }

  return (
    <>
      <primitive object={object} scale={draw.scale} />
      <BlobShadow radiusX={size.x / 2 + 0.03} radiusZ={size.z / 2 + 0.03} position={[center.x, 0, center.z]} />
      {/* Invisible hit box: pointer events raycast this box instead of the textured feet. */}
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
        <mesh
          ref={ring}
          position={[center.x, 0.006, center.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[ringX, ringZ, 1]}
        >
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial
            ref={ringMaterial}
            color={draw.selected ? '#f0ad63' : '#fff7e8'}
            transparent
            opacity={draw.selected ? 0.66 : 0.3}
            depthWrite={false}
          />
        </mesh>
      )}
      {draw.selected && (
        <Html
          center
          position={[center.x, size.y + 0.08, center.z]}
          distanceFactor={2.2}
          style={{ pointerEvents: 'none' }}
        >
          <span className="scene-label feet-label is-selected">{draw.label}</span>
        </Html>
      )}
    </>
  )
}

function FootFigure({ app, draw }: FigureProps) {
  return (
    <group position={draw.position} rotation={[0, draw.yaw, 0]}>
      <Suspense fallback={<LoadingSilhouette scale={draw.scale} />}>
        <FootModel app={app} draw={draw} />
      </Suspense>
    </group>
  )
}

export function FootFigures({
  app,
  world,
  system,
}: {
  app: CompareApp
  world: FeetWorld
  system: ShoeSystem
}) {
  return world.placements.map((placement) => (
    <FootFigure
      key={placement.id}
      app={app}
      draw={toFootDraw(placement, world.selected, system)}
    />
  ))
}
