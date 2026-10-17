import { Canvas, useThree } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import { NeutralToneMapping, SRGBColorSpace } from 'three'
import type { CompareApp } from '../app/compare-app.ts'
import type { CompareDocument } from '../domain/document.ts'
import { FeetWorldView } from './feet/world-view.tsx'
import { HeightWorldView } from './height/world-view.tsx'

function ClearColor({ mode }: { mode: CompareDocument['mode'] }) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    gl.setClearColor('#191f23', 1)
  }, [gl, mode])
  return null
}

export function CompareCanvas({
  app,
  document,
  onReady,
}: {
  app: CompareApp
  document: CompareDocument
  onReady(): void
}) {
  return (
    <Canvas
      id="compare-stage"
      dpr={[1, 1.5]}
      camera={{ position: [4, 2.4, 6], fov: 38, near: 0.01, far: 60 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'default',
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
      }}
      onPointerMissed={() => app.select(null)}
      onCreated={({ gl }) => {
        gl.outputColorSpace = SRGBColorSpace
        // Neutral tone mapping keeps textured skin and fabric close to their authored colors.
        gl.toneMapping = NeutralToneMapping
        gl.toneMappingExposure = 1
        gl.setClearColor('#b8b9b5', 1)
        // Nudge software compositors that otherwise leave the canvas black.
        gl.domElement.style.transform = 'translateZ(0)'
        gl.domElement.style.outline = '1px solid transparent'
        onReady()
      }}
    >
      <ClearColor mode={document.mode} />
      <Suspense fallback={null}>
        {document.mode === 'height' ? (
          <HeightWorldView app={app} document={document} />
        ) : (
          <FeetWorldView app={app} document={document} />
        )}
      </Suspense>
    </Canvas>
  )
}
