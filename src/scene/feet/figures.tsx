import { Html, useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CompareApp } from '../../app/compare-app.ts'
import type { FeetWorld } from '../../domain/feet-world.ts'
import type { ShoeSystem } from '../../domain/shoe-charts.ts'
import { BlobShadow } from '../blob-shadow.tsx'
import { toFootDraw, type FootDraw } from '../draw.ts'
import type { Bounds } from '../../kernel/index.ts'
import { useModelScene } from '../models.ts'
import { assertFootRig, solveFoot } from '../../kernel/foot.ts'
import { solverFor, useRigSolvers } from '../rig-cache.ts'
import { applyPose, rigNode } from '../rigged.ts'

/** Gap between the inner edges of the two feet once the authored stance is narrowed. */
const PAIR_GAP_M = 0.05

type FigureProps = {
  app: CompareApp
  draw: FootDraw
}

/**
 * Each placement's last solved controls. A slider drag starts the next solve
 * from them and converges in a step or two; any start gives the same answer.
 */
const lastControls = new Map<string, Readonly<Record<string, number>>>()

function toBox(bounds: Bounds, shiftX: number): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(bounds.min[0] + shiftX, bounds.min[1], bounds.min[2]),
    new THREE.Vector3(bounds.max[0] + shiftX, bounds.max[1], bounds.max[2]),
  )
}

/**
 * The pack authors each pair in a relaxed stance. Sliding the two feet toward
 * the center keeps every pair compact on the table: returns how far each foot
 * moves inward, from the solved bounds of the left (+x) and right (-x) foot.
 */
function stanceShift(left: Bounds, right: Bounds): number {
  const innerEdge = Math.min(left.min[0], -right.max[0])
  return Math.max(0, innerEdge - PAIR_GAP_M / 2)
}

/** Stands in at the target size while the textured pair, its rig, and the kernel load. */
function LoadingSilhouette({ scale }: { scale: number }) {
  return (
    <mesh position={[0, 0.16 * scale, 0.02 * scale]}>
      <boxGeometry args={[0.3 * scale, 0.32 * scale, 0.26 * scale]} />
      <meshStandardMaterial color="#8f7a66" roughness={1} transparent opacity={0.4} />
    </mesh>
  )
}

function FootModel({ app, draw }: FigureProps) {
  const scene = useModelScene(draw.model)
  const solvers = useRigSolvers(draw.model)
  const rig = useMemo(() => {
    const pair = { left: solverFor(solvers, 'LeftFootAndShin'), right: solverFor(solvers, 'RightFootAndShin') }
    assertFootRig(pair.left)
    return pair
  }, [solvers])
  const feet = useMemo(() => {
    const left = scene.getObjectByName('LeftFootAndShin')
    const right = scene.getObjectByName('RightFootAndShin')
    if (!left || !right) {
      throw new Error(`${draw.model.file} needs LeftFootAndShin and RightFootAndShin.`)
    }
    return { left: rigNode(left, rig.left.rig), right: rigNode(right, rig.right.rig) }
  }, [scene, rig, draw.model])

  // The left foot is solved to the shape; the right one mirrors its controls.
  const solved = useMemo(() => {
    const left = solveFoot(rig.left, draw.shape, { initial: lastControls.get(draw.id) })
    lastControls.set(draw.id, left.controls)
    return { controls: left.controls, left: left.bounds, right: rig.right.evaluate(left.controls).bounds }
  }, [rig, draw.shape, draw.id])
  useEffect(() => () => void lastControls.delete(draw.id), [draw.id])
  const shift = stanceShift(solved.left, solved.right)
  const pairBounds = toBox(solved.left, -shift).union(toBox(solved.right, shift))

  useLayoutEffect(() => {
    applyPose(feet.left, rig.left.pose(solved.controls))
    applyPose(feet.right, rig.right.pose(solved.controls))
    feet.left.root.position.x = -shift
    feet.right.root.position.x = shift
  }, [feet, rig, solved, shift])

  const [hovered, setHovered] = useState(false)
  const ring = useRef<THREE.Mesh>(null)
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const size = pairBounds.getSize(new THREE.Vector3())
  const center = pairBounds.getCenter(new THREE.Vector3())
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
      <primitive object={feet.left.root} />
      <primitive object={feet.right.root} />
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
      <Suspense fallback={<LoadingSilhouette scale={draw.lengthScale} />}>
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
