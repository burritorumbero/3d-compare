import type { CompareApp } from '../app/compare-app.ts'
import type { PlacedFoot } from '../domain/feet-world.ts'
import { FOOT_SKIN_PRESETS, FOOT_SKIN_TONES } from '../domain/foot-skin.ts'

export function SkinTonePicker({ app, placement }: { app: CompareApp; placement: PlacedFoot }) {
  return (
    <fieldset className="skin-tone-picker">
      <legend>Skin tone</legend>
      <div className="skin-tone-options">
        {FOOT_SKIN_TONES.map((tone) => (
          <label className="skin-tone-option" key={tone}>
            <input
              className="sr-only"
              type="radio"
              name={`skin-tone-${placement.id}`}
              value={tone}
              checked={placement.skinTone === tone}
              onChange={() => app.setFootSkinTone(placement.id, tone)}
            />
            <span
              className="skin-tone-swatch"
              style={{ backgroundColor: FOOT_SKIN_PRESETS[tone].color }}
              aria-hidden="true"
            />
            <span>{FOOT_SKIN_PRESETS[tone].label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
