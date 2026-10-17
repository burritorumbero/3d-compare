import { Grid } from '@react-three/drei'
import type { ReactNode } from 'react'
import { StudioEnvironment } from '../environment.tsx'
import { RulerLabel } from '../ruler-label.tsx'

/** Ten 10-foot people with their arms out need about 20 m of lineup. */
const FLOOR_WIDTH_M = 24
const FLOOR_DEPTH_M = 9
/** The post reaches past the 304.8 cm (10 ft) height limit. */
const RULER_M = 3.2
const rulerMarks = Array.from({ length: Math.round(RULER_M * 10) + 1 }, (_, index) => index / 10)
const rulerLabels = [0, 50, 100, 150, 200, 250, 300]

export function HeightStudio({ children }: { children: ReactNode }) {
  return (
    <>
      <color attach="background" args={['#191f23']} />
      <fog attach="fog" args={['#191f23', 22, 60]} />
      <StudioEnvironment intensity={0.85} />
      <hemisphereLight args={['#f4f6f2', '#343d44', 0.5]} />
      <directionalLight position={[4, 7, 5]} intensity={2.2} color="#fff9f2" />
      <directionalLight position={[-4, 3.5, -2]} intensity={0.7} color="#c9d7dc" />

      <mesh position={[0, -0.045, 0]}>
        <boxGeometry args={[FLOOR_WIDTH_M, 0.09, FLOOR_DEPTH_M]} />
        <meshStandardMaterial color="#303b42" roughness={0.92} />
      </mesh>
      <Grid
        position={[0, 0.004, 0]}
        args={[FLOOR_WIDTH_M, FLOOR_DEPTH_M]}
        cellSize={0.1}
        cellThickness={0.35}
        cellColor="#46545d"
        sectionSize={1}
        sectionThickness={1.15}
        sectionColor="#687c86"
        fadeDistance={28}
        fadeStrength={1.4}
        infiniteGrid={false}
      />
      {/* A free-standing 320 cm post keeps a scale reference on an open floor. */}
      <group position={[-6.85, 0, -2.2]}>
        <mesh position={[0, RULER_M / 2, 0.012]}>
          <boxGeometry args={[0.018, RULER_M, 0.012]} />
          <meshBasicMaterial color="#879da6" />
        </mesh>
        {rulerMarks.map((height, index) => {
          const major = index % 5 === 0
          return (
            <mesh key={height} position={[major ? 0.105 : 0.065, height, 0.015]}>
              <boxGeometry args={[major ? 0.22 : 0.13, major ? 0.012 : 0.006, 0.012]} />
              <meshBasicMaterial color={major ? '#c7d6dd' : '#71838d'} />
            </mesh>
          )
        })}
        {rulerLabels.map((centimeters) => (
          <RulerLabel
            key={centimeters}
            position={[-0.2, centimeters / 100, 0.04]}
            height={0.1}
            text={String(centimeters)}
          />
        ))}
        <RulerLabel position={[-0.2, RULER_M + 0.08, 0.04]} height={0.1} text="CM" />
      </group>

      {children}
    </>
  )
}
