import { useState, type FormEvent } from 'react'
import type { CompareApp } from '../app/compare-app.ts'
import { footEntry } from '../catalog/feet.ts'
import { humanEntry } from '../catalog/humans.ts'
import { humanDisplayName } from '../catalog/names.ts'
import type { CompareDocument } from '../domain/document.ts'
import { selectedFoot } from '../domain/feet-world.ts'
import { HUMAN_NAME_MAX_LENGTH, selectedHuman } from '../domain/height-world.ts'
import { formatHeight } from '../domain/measure.ts'
import { formatShoe, shoeRows } from '../domain/shoe-charts.ts'
import { FootIcon, PersonIcon, TrashIcon } from './icons.tsx'
import {
  closestShoeSize,
  heightInCentimeters,
  splitImperialHeight,
} from './size-codec.ts'

function EmptyInspector({ mode, hasPlacements }: { mode: 'height' | 'feet'; hasPlacements: boolean }) {
  const noun = mode === 'height' ? 'person' : 'foot model'
  return (
    <section className="panel inspector-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Inspector</span>
          <h2>Size</h2>
        </div>
      </div>
      <div className="inspector-empty">
        {mode === 'height' ? <PersonIcon /> : <FootIcon />}
        <strong>{hasPlacements ? `Select a ${noun}` : `No ${noun} selected`}</strong>
        <p>
          {hasPlacements
            ? `Choose a ${noun} on the stage or in the lineup.`
            : `Add a ${noun} from the model library to set its size.`}
        </p>
      </div>
    </section>
  )
}

function HeightInspector({
  app,
  document,
}: {
  app: CompareApp
  document: CompareDocument
}) {
  const placement = selectedHuman(document.height)
  const initialImperial = placement
    ? splitImperialHeight(placement.heightMm)
    : { feet: 0, inches: 0 }
  const [centimeters, setCentimeters] = useState(
    placement ? String(heightInCentimeters(placement.heightMm)) : '',
  )
  const [feet, setFeet] = useState(String(initialImperial.feet))
  const [inches, setInches] = useState(String(initialImperial.inches))
  const [name, setName] = useState(placement?.name ?? '')
  const [error, setError] = useState('')

  if (!placement) {
    return (
      <EmptyInspector mode="height" hasPlacements={document.height.placements.length > 0} />
    )
  }

  const entry = humanEntry(placement.catalogId)
  const placementId = placement.id
  const displayName = humanDisplayName(placement)

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const result =
      document.heightUnit === 'cm'
        ? app.updateHumanHeight(placementId, {
            unit: 'cm',
            value: Number(centimeters),
          })
        : app.updateHumanHeight(placementId, {
            unit: 'ftin',
            feet: Number(feet),
            inches: Number(inches),
          })

    setError(result.ok ? '' : 'Enter a height between 90 and 230 cm.')
  }

  return (
    <section className="panel inspector-panel" aria-labelledby="inspector-title">
      <div className="panel-heading inspector-heading">
        <div>
          <span className="eyebrow">Inspector</span>
          <h2 id="inspector-title">{displayName}</h2>
        </div>
        <button
          className="icon-button danger"
          type="button"
          title={`Remove ${displayName}`}
          aria-label={`Remove ${displayName}`}
          onClick={() => app.remove(placement.id)}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="selection-summary">
        <span
          className="selection-avatar"
          style={{ color: entry.swatch.outfitHex, backgroundColor: entry.swatch.skinHex }}
        >
          <PersonIcon />
        </span>
        <div>
          <strong>{formatHeight(placement.heightMm, document.heightUnit)}</strong>
          <small>{entry.label} · {entry.subtitle}</small>
        </div>
      </div>
      <label className="field name-field">
        <span>Name</span>
        <span className="input-with-suffix">
          <input
            type="text"
            maxLength={HUMAN_NAME_MAX_LENGTH}
            placeholder={entry.label}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => app.renameHuman(placementId, name)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
          />
        </span>
      </label>
      <form className="size-form" onSubmit={submit}>
        {document.heightUnit === 'cm' ? (
          <label className="field">
            <span>Height</span>
            <span className="input-with-suffix">
              <input
                type="number"
                min="90"
                max="230"
                step="0.1"
                inputMode="decimal"
                value={centimeters}
                onChange={(event) => setCentimeters(event.target.value)}
              />
              <span>cm</span>
            </span>
          </label>
        ) : (
          <div className="field-pair">
            <label className="field">
              <span>Feet</span>
              <span className="input-with-suffix">
                <input
                  type="number"
                  min="2"
                  max="7"
                  step="1"
                  inputMode="numeric"
                  value={feet}
                  onChange={(event) => setFeet(event.target.value)}
                />
                <span>ft</span>
              </span>
            </label>
            <label className="field">
              <span>Inches</span>
              <span className="input-with-suffix">
                <input
                  type="number"
                  min="0"
                  max="11.9"
                  step="0.1"
                  inputMode="decimal"
                  value={inches}
                  onChange={(event) => setInches(event.target.value)}
                />
                <span>in</span>
              </span>
            </label>
          </div>
        )}
        {error && <p className="field-error">{error}</p>}
        <button className="primary-button" type="submit">
          Update height
        </button>
      </form>
      <p className="measurement-note">Uniform scale keeps this model's proportions intact.</p>
    </section>
  )
}

function FootInspector({
  app,
  document,
}: {
  app: CompareApp
  document: CompareDocument
}) {
  const placement = selectedFoot(document.feet)
  const [error, setError] = useState('')

  if (!placement) {
    return <EmptyInspector mode="feet" hasPlacements={document.feet.placements.length > 0} />
  }

  const entry = footEntry(placement.catalogId)
  const rows = shoeRows(document.shoeSystem, entry.sex)
  const currentSize = closestShoeSize(
    placement.footLengthMm,
    document.shoeSystem,
    entry.sex,
  )

  return (
    <section className="panel inspector-panel" aria-labelledby="inspector-title">
      <div className="panel-heading inspector-heading">
        <div>
          <span className="eyebrow">Inspector</span>
          <h2 id="inspector-title">{entry.label}</h2>
        </div>
        <button
          className="icon-button danger"
          type="button"
          title={`Remove ${entry.label}`}
          aria-label={`Remove ${entry.label}`}
          onClick={() => app.remove(placement.id)}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="selection-summary">
        <span
          className="selection-avatar"
          style={{ color: entry.swatch.outfitHex, backgroundColor: entry.swatch.skinHex }}
        >
          <FootIcon />
        </span>
        <div>
          <strong>
            {formatShoe(placement.footLengthMm, document.shoeSystem, entry.sex)}
          </strong>
          <small>{placement.footLengthMm} mm foot length</small>
        </div>
      </div>
      <label className="field shoe-field">
        <span>{document.shoeSystem} adult size</span>
        <select
          value={currentSize}
          onChange={(event) => {
            const result = app.updateFootSize(placement.id, {
              system: document.shoeSystem,
              size: Number(event.target.value),
            })
            setError(result.ok ? '' : 'Choose a supported adult size.')
          }}
        >
          {rows.map((row) => (
            <option key={row.size} value={row.size}>
              {document.shoeSystem} {row.size} · {row.mm} mm
            </option>
          ))}
        </select>
      </label>
      {error && <p className="field-error">{error}</p>}
      <p className="measurement-note">
        Size charts map to foot length. Brand fit and shoe shape vary.
      </p>
    </section>
  )
}

export function Inspector({
  app,
  document,
}: {
  app: CompareApp
  document: CompareDocument
}) {
  return document.mode === 'height' ? (
    <HeightInspector
      key={`${document.height.selected ?? 'none'}-${document.heightUnit}`}
      app={app}
      document={document}
    />
  ) : (
    <FootInspector
      key={`${document.feet.selected ?? 'none'}-${document.shoeSystem}`}
      app={app}
      document={document}
    />
  )
}
