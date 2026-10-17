import { Html, useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { CompareApp } from '../../app/compare-app.ts'
import type { HeightWorld } from '../../domain/height-world.ts'
import type { LengthUnit } from '../../domain/measure.ts'
import { BlobShadow } from '../blob-shadow.tsx'
import { humanLineupX, toHumanDraw, type HumanDraw } from '../draw.ts'
import { BODY_LANDMARKS, statureTargets, type BodyLandmarks } from '../../domain/stature.ts'
import type { RigSolver } from '../../kernel/index.ts'
import { useModelScene } from '../models.ts'
import { useRigSolvers } from '../rig-cache.ts'
import { applyPose, rigNode } from '../rigged.ts'

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

/**
 * Each placement's last solved controls. A height edit starts the next solve
 * from them and converges in a step or two; any start gives the same answer.
 */
const lastControls = new Map<string, Readonly<Record<string, number>>>()

/** The authored model's landmarks in millimeters, as the rig measures them at rest. */
function authoredLandmarks(solver: RigSolver): BodyLandmarks {
  const rest = solver.evaluate().measures
  const landmarks = {} as BodyLandmarks
  for (const name of BODY_LANDMARKS) {
    if (rest[name] === undefined) {
      throw new Error(`Person rig ${solver.rig.mesh} has no ${name} measure.`)
    }
    landmarks[name] = rest[name] * 1000
  }
  return landmarks
}

function HumanModel({ app, draw }: FigureProps) {
  const scene = useModelScene(draw.model)
  const [solver] = useRigSolvers(draw.model)
  const person = useMemo(() => rigNode(scene, solver.rig), [scene, solver])
  const authored = useMemo(() => authoredLandmarks(solver), [solver])

  // Segment lengths and breadths follow adult proportions for the height (ANSUR II).
  const solved = useMemo(() => {
    const targets = statureTargets(draw.sex, authored, draw.heightMm)
    const meters = Object.fromEntries(Object.entries(targets).map(([name, mm]) => [name, mm / 1000]))
    const solution = solver.solve(meters, { initial: lastControls.get(draw.id) })
    lastControls.set(draw.id, solution.controls)
    return solution
  }, [solver, authored, draw.sex, draw.heightMm, draw.id])
  useEffect(() => () => void lastControls.delete(draw.id), [draw.id])
  useLayoutEffect(() => applyPose(person, solver.pose(solved.controls)), [person, solver, solved])

  const bounds = new THREE.Box3(new THREE.Vector3(...solved.bounds.min), new THREE.Vector3(...solved.bounds.max))
  const [hovered, setHovered] = useState(false)
  const ring = useRef<THREE.Mesh>(null)
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
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
      <primitive object={person.root} />
      <BlobShadow radiusX={size.z * 0.85} radiusZ={size.z * 0.6} position={[0, 0, center.z]} />
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
  const lineup = humanLineupX(world.placements)
  return world.placements.map((placement) => (
    <HumanFigure
      key={placement.id}
      app={app}
      draw={toHumanDraw(placement, world.selected, unit, lineup.get(placement.id) ?? 0)}
    />
  ))
}
