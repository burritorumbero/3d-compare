import { Grid, Html } from '@react-three/drei'
import type { ReactNode } from 'react'
import { StudioEnvironment } from '../environment.tsx'

const FLOOR_WIDTH_M = 16
const FLOOR_DEPTH_M = 7
const rulerMarks = Array.from({ length: 23 }, (_, index) => index / 10)
const rulerLabels = [0, 50, 100, 150, 200]

export function HeightStudio({ children }: { children: ReactNode }) {
  return (
    <>
      <color attach="background" args={['#b8b9b5']} />
      <fog attach="fog" args={['#b8b9b5', 16, 40]} />
      <StudioEnvironment intensity={0.85} />
      <hemisphereLight args={['#f4f6f2', '#7a756c', 0.5]} />
      <directionalLight position={[4, 7, 5]} intensity={2.2} color="#fff4e4" />
      <directionalLight position={[-4, 3.5, -2]} intensity={0.7} color="#c9d7dc" />

      <mesh position={[0, -0.045, 0]}>
        <boxGeometry args={[FLOOR_WIDTH_M, 0.09, FLOOR_DEPTH_M]} />
        <meshStandardMaterial color="#9d9e99" roughness={0.92} />
      </mesh>
      <Grid
        position={[0, 0.004, 0]}
        args={[FLOOR_WIDTH_M, FLOOR_DEPTH_M]}
        cellSize={0.1}
        cellThickness={0.35}
        cellColor="#858780"
        sectionSize={1}
        sectionThickness={1.15}
        sectionColor="#6f726b"
        fadeDistance={18}
        fadeStrength={1.4}
        infiniteGrid={false}
      />
      {/* A free-standing 220 cm post keeps a scale reference on an open floor. */}
      <group position={[-FLOOR_WIDTH_M / 2 + 1.15, 0, -2.2]}>
        <mesh position={[0, 1.1, 0.012]}>
          <boxGeometry args={[0.018, 2.2, 0.012]} />
          <meshBasicMaterial color="#444b48" />
        </mesh>
        {rulerMarks.map((height, index) => {
          const major = index % 5 === 0
          return (
            <mesh key={height} position={[major ? 0.105 : 0.065, height, 0.015]}>
              <boxGeometry args={[major ? 0.22 : 0.13, major ? 0.012 : 0.006, 0.012]} />
              <meshBasicMaterial color={major ? '#2c3532' : '#646a66'} />
            </mesh>
          )
        })}
        {rulerLabels.map((centimeters) => (
          <Html
            key={centimeters}
            center
            position={[-0.2, centimeters / 100, 0.04]}
            distanceFactor={6}
            style={{ pointerEvents: 'none' }}
          >
            <span className="ruler-label">{centimeters}</span>
          </Html>
        ))}
        <Html center position={[-0.2, 2.28, 0.04]} distanceFactor={6} style={{ pointerEvents: 'none' }}>
          <span className="ruler-unit">CM</span>
        </Html>
      </group>

      {children}
    </>
  )
}
