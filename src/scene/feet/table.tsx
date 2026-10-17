import { Grid, Html } from '@react-three/drei'
import type { ReactNode } from 'react'
import { FOOT_ROW_OFFSET_M } from '../../domain/layout.ts'
import { StudioEnvironment } from '../environment.tsx'

const TABLE_WIDTH_M = 3.2
const TABLE_DEPTH_M = 1.4
const rulerLabels = Array.from({ length: 31 }, (_, index) => (index - 15) * 10)
const heelLines = [-FOOT_ROW_OFFSET_M, FOOT_ROW_OFFSET_M]

export function FeetTable({ children }: { children: ReactNode }) {
  return (
    <>
      <color attach="background" args={['#191f23']} />
      <fog attach="fog" args={['#191f23', 5, 12]} />
      <StudioEnvironment intensity={0.75} />
      <hemisphereLight args={['#f4f6f2', '#343d44', 0.45]} />
      <directionalLight position={[-2.5, 4, 3]} intensity={2.4} color="#fff9f2" />
      <directionalLight position={[2, 2.5, -1]} intensity={0.6} color="#c9d7dc" />

      <mesh position={[0, -0.075, 0]}>
        <boxGeometry args={[TABLE_WIDTH_M, 0.15, TABLE_DEPTH_M]} />
        <meshStandardMaterial color="#303b42" roughness={0.68} />
      </mesh>
      <mesh position={[0, -0.155, 0]}>
        <boxGeometry args={[TABLE_WIDTH_M + 0.06, 0.035, TABLE_DEPTH_M + 0.06]} />
        <meshStandardMaterial color="#202a30" roughness={0.78} />
      </mesh>

      <Grid
        position={[0, 0.006, 0]}
        args={[TABLE_WIDTH_M - 0.2, TABLE_DEPTH_M - 0.1]}
        cellSize={0.01}
        cellThickness={0.24}
        cellColor="#657a85"
        sectionSize={0.1}
        sectionThickness={0.9}
        sectionColor="#adbdc5"
        fadeDistance={3.5}
        fadeStrength={1}
        infiniteGrid={false}
      />

      <group position={[0, 0.011, 0]}>
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.19, 0.195, 80, 1, 0.15, Math.PI * 0.7]} />
          <meshBasicMaterial color="#c7d6dd" transparent opacity={0.42} />
        </mesh>
        {/* Heel lines: each row of feet stands with its heels on one of these. */}
        {heelLines.map((z) => (
          <mesh key={z} position={[0, 0, z]}>
            <boxGeometry args={[TABLE_WIDTH_M - 0.3, 0.004, 0.008]} />
            <meshBasicMaterial color="#c7d6dd" transparent opacity={0.52} />
          </mesh>
        ))}
      </group>

      {rulerLabels.map((centimeters) => (
        <Html
          key={centimeters}
          center
          position={[centimeters / 100, 0.025, -TABLE_DEPTH_M / 2 + 0.065]}
          rotation={[-Math.PI / 2, 0, 0]}
          distanceFactor={1.8}
          style={{ pointerEvents: 'none' }}
        >
          <span className="table-ruler-label">{centimeters === 0 ? '0 CM' : Math.abs(centimeters)}</span>
        </Html>
      ))}

      {children}
    </>
  )
}
