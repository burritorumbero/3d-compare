import { useState } from 'react'
import type { CompareApp } from '../app/compare-app.ts'
import type { Sex } from '../domain/catalog.ts'
import type { PlacedFoot } from '../domain/feet-world.ts'
import {
  FOOT_DIMENSIONS,
  footDimensionEditRange,
  footDimensionLabel,
  footDimensionMm,
  footDimensionPercentileBand,
  type FootDimension,
} from '../domain/foot-shape.ts'

const HINTS: Record<FootDimension, { below: string; above: string }> = {
  toeLength: { below: 'Shorter toes than 99% of adults', above: 'Longer toes than 99% of adults' },
  ballWidth: { below: 'Narrower than 99% of adults', above: 'Wider than 99% of adults' },
  instepHeight: { below: 'Low instep', above: 'High instep' },
}

const NOTES: Record<FootDimension, string> = {
  toeLength: 'Changes foot length and shoe size',
  ballWidth: 'Across the ball of the foot',
  instepHeight: 'Instep height at mid-foot',
}

function DimensionField({
  app,
  placement,
  sex,
  dimension,
  onError,
}: {
  app: CompareApp
  placement: PlacedFoot
  sex: Sex
  dimension: FootDimension
  onError: (message: string) => void
}) {
  const value = footDimensionMm(placement.shape, dimension)
  const range = footDimensionEditRange(placement.shape, dimension)
  const locked = placement.shape.locked.includes(dimension)
  const band = footDimensionPercentileBand(placement.shape, sex, dimension)
  const [draft, setDraft] = useState<string | null>(null)
  const label = footDimensionLabel(dimension)
  const inputId = `foot-${dimension}`

  function commit(raw: number): void {
    const result = app.setFootDimension(placement.id, dimension, raw)
    onError(result.ok ? '' : result.reason === 'constraint-violated' ? result.message : `Enter a valid ${label.toLowerCase()}.`)
  }

  const hint =
    band === 'below-typical'
      ? HINTS[dimension].below
      : band === 'above-typical'
        ? HINTS[dimension].above
        : NOTES[dimension]

  return (
    <div className={`dimension-field dimension-${dimension}`}>
      <div className="dimension-heading">
        <label htmlFor={inputId}>{label}</label>
        {locked ? (
          <button
            type="button"
            className="dimension-reset"
            title={`Return ${label.toLowerCase()} to the adult average for this foot length`}
            onClick={() => {
              const result = app.resetFootDimension(placement.id, dimension)
              onError(result.ok || result.reason !== 'constraint-violated' ? '' : result.message)
            }}
          >
            Reset
          </button>
        ) : (
          <span className="dimension-status">Average</span>
        )}
      </div>
      <div className="dimension-controls">
        <input
          type="range"
          aria-label={`${label} slider`}
          min={range.min}
          max={range.max}
          step={1}
          value={value}
          onChange={(event) => commit(Number(event.target.value))}
        />
        <span className="input-with-suffix">
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={range.min}
            max={range.max}
            step={1}
            value={draft ?? String(value)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (draft !== null && Number(draft) !== value) {
                commit(Number(draft))
              }
              setDraft(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
          />
          <span>mm</span>
        </span>
      </div>
      <small className={band === 'typical' || band === null ? 'dimension-hint' : 'dimension-hint is-unusual'}>
        {hint}
      </small>
    </div>
  )
}

/** Toe length, foot width, and foot thickness, each following foot length until set by hand. */
export function FootDimensions({
  app,
  placement,
  sex,
}: {
  app: CompareApp
  placement: PlacedFoot
  sex: Sex
}) {
  const [error, setError] = useState('')
  return (
    <fieldset className="foot-dimensions">
      <legend>Shape</legend>
      {FOOT_DIMENSIONS.map((dimension) => (
        <DimensionField
          key={dimension}
          app={app}
          placement={placement}
          sex={sex}
          dimension={dimension}
          onError={setError}
        />
      ))}
      {error && <p className="field-error">{error}</p>}
    </fieldset>
  )
}
