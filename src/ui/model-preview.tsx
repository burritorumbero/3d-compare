import { footEntry } from '../catalog/feet.ts'
import type { PlacedFoot } from '../domain/feet-world.ts'
import { defaultFootSkinTone, type FootSkinTone } from '../domain/foot-skin.ts'
import type { ModelAsset } from '../domain/catalog.ts'

/** Small, pre-rendered previews of the same assets used on the stage. */
export function ModelPreview({
  model,
  className = '',
  skinTone,
}: {
  model: ModelAsset
  className?: string
  skinTone?: FootSkinTone
}) {
  return (
    <img
      className={`model-preview ${className}`}
      src={`${import.meta.env.BASE_URL}previews/${model.file.replace('.glb', `${skinTone ? `-${skinTone}` : ''}.webp`)}`}
      alt=""
      loading="lazy"
      draggable={false}
    />
  )
}

export function FootModelPreview({ placement }: { placement: PlacedFoot }) {
  return (
    <ModelPreview
      model={footEntry(placement.catalogId).model}
      skinTone={
        placement.skinTone === defaultFootSkinTone(placement.catalogId)
          ? undefined
          : placement.skinTone
      }
    />
  )
}
