import type { ModelAsset } from '../domain/catalog.ts'

/** Small, pre-rendered previews of the same assets used on the stage. */
export function ModelPreview({ model, className = '' }: { model: ModelAsset; className?: string }) {
  return (
    <img
      className={`model-preview ${className}`}
      src={`${import.meta.env.BASE_URL}previews/${model.file.replace('.glb', '.webp')}`}
      alt=""
      loading="lazy"
      draggable={false}
    />
  )
}
