import { useMemo } from 'react'
import * as THREE from 'three'

const textures = new Map<string, THREE.CanvasTexture>()

/** The small, fixed vocabulary of ruler numbers shares textures across both scenes. */
function labelTexture(text: string): THREE.CanvasTexture {
  const cached = textures.get(text)
  if (cached) return cached

  const canvas = window.document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#c6d2d7'
    context.font = '500 36px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, canvas.width / 2, canvas.height / 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  textures.set(text, texture)
  return texture
}

/** Camera-facing ruler text that participates in the same depth buffer as the models. */
export function RulerLabel({ text, position, height }: {
  text: string
  position: [number, number, number]
  height: number
}) {
  const texture = useMemo(() => labelTexture(text), [text])
  return (
    <sprite position={position} scale={[height * 2, height, 1]} raycast={() => {}}>
      <spriteMaterial map={texture} transparent depthTest depthWrite={false} toneMapped={false} />
    </sprite>
  )
}
