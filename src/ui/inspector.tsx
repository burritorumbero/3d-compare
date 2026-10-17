import { useState, type FormEvent } from 'react'
import type { CompareApp } from '../app/compare-app.ts'
import { footEntry } from '../catalog/feet.ts'
import { humanEntry } from '../catalog/humans.ts'
import { humanDisplayName } from '../catalog/names.ts'
import type { CompareDocument } from '../domain/document.ts'
import { selectedFoot } from '../domain/feet-world.ts'
import { HUMAN_NAME_MAX_LENGTH, selectedHuman } from '../domain/height-world.ts'
import {
  HEIGHT_MM_MIN,
  HEIGHT_MM_MAX,
  HEIGHT_RANGE_MESSAGE,
  formatHeight,
} from '../domain/measure.ts'
import { formatShoe, shoeRows } from '../domain/shoe-charts.ts'
import { FootDimensions } from './foot-dimensions.tsx'
import { FootIcon, PersonIcon, ResetIcon } from './icons.tsx'
import { SkinTonePicker } from './skin-tone-picker.tsx'
import { ModelPreview, FootModelPreview } from './model-preview.tsx'
import { UnitToggles } from './unit-toggles.tsx'
import { closestShoeSize, heightInCentimeters, splitImperialHeight } from './size-codec.ts'

function EmptyInspector({
  mode,
  hasPlacements,
}: {
  mode: 'height' | 'feet'
  hasPlacements: boolean
}) {
  return (
    <section className="panel inspector-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Make it yours</span>
          <h2>Measurements</h2>
        </div>
      </div>
      <div className="inspector-empty">
        {mode === 'height' ? <PersonIcon /> : <FootIcon />}
        <strong>{hasPlacements ? 'Select a model' : 'Start with a model'}</strong>
        <p>
          {hasPlacements
            ? 'Choose a model on the stage or in your lineup to adjust its measurements.'
            : 'Add a model to set its size and see the comparison take shape.'}
        </p>
      </div>
    </section>
  )
}

function HeightInspector({ app, document }: { app: CompareApp; document: CompareDocument }) {
  const placement = selectedHuman(document.height)
  const [draft, setDraft] = useState<{ cm?: string; feet?: string; inches?: string }>({})
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState('')
  if (!placement)
    return <EmptyInspector mode="height" hasPlacements={document.height.placements.length > 0} />

  const entry = humanEntry(placement.catalogId)
  const displayName = humanDisplayName(placement)
  const imperial = splitImperialHeight(placement.heightMm)
  const centimeters = draft.cm ?? String(heightInCentimeters(placement.heightMm))
  const feet = draft.feet ?? String(imperial.feet)
  const inches = draft.inches ?? String(imperial.inches)

  function commit(): void {
    if (Object.keys(draft).length === 0) return
    const blank =
      document.heightUnit === 'cm' ? !centimeters.trim() : !feet.trim() || !inches.trim()
    const result = blank
      ? { ok: false }
      : app.updateHumanHeight(
          placement!.id,
          document.heightUnit === 'cm'
            ? { unit: 'cm', value: Number(centimeters) }
            : { unit: 'ftin', feet: Number(feet), inches: Number(inches) },
        )
    setError(result.ok ? '' : HEIGHT_RANGE_MESSAGE)
    if (result.ok) setDraft({})
  }
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    commit()
  }

  return (
    <section className="panel inspector-panel" aria-labelledby="inspector-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Selected person</span>
          <h2 id="inspector-title">{displayName}</h2>
        </div>
        <span className="selection-indicator">Editing</span>
      </div>
      <div className="selection-summary">
        <span className="selection-avatar">
          <ModelPreview model={entry.model} />
        </span>
        <div>
          <strong>{formatHeight(placement.heightMm, document.heightUnit)}</strong>
          <small>
            {entry.label} · {entry.sex === 'female' ? 'Female' : 'Male'}
          </small>
        </div>
      </div>
      <label className="field name-field">
        <span>Display name</span>
        <span className="input-with-suffix">
          <input
            type="text"
            maxLength={HUMAN_NAME_MAX_LENGTH}
            placeholder={entry.label}
            autoComplete="off"
            value={name ?? placement.name ?? ''}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name !== null) app.renameHuman(placement.id, name)
              setName(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
          />
        </span>
      </label>
      <div className="measurement-heading">
        <h3>Height</h3>
        <UnitToggles app={app} document={document} />
      </div>
      <form
        className="size-form"
        noValidate
        onSubmit={submit}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) commit()
        }}
      >
        {document.heightUnit === 'cm' ? (
          <label className="field">
            <span className="sr-only">Height in centimeters</span>
            <span className="input-with-suffix">
              <input
                type="number"
                min="90"
                max="304.8"
                step="0.1"
                inputMode="decimal"
                value={centimeters}
                aria-invalid={!!error}
                aria-describedby="height-help"
                onChange={(event) => setDraft({ cm: event.target.value })}
              />
              <span aria-hidden="true">cm</span>
            </span>
          </label>
        ) : (
          <div className="field-pair">
            <label className="field">
              <span className="sr-only">Feet</span>
              <span className="input-with-suffix">
                <input
                  type="number"
                  min="2"
                  max="10"
                  step="1"
                  inputMode="numeric"
                  value={feet}
                  aria-invalid={!!error}
                  aria-describedby="height-help"
                  onChange={(event) => setDraft({ ...draft, feet: event.target.value })}
                />
                <span aria-hidden="true">ft</span>
              </span>
            </label>
            <label className="field">
              <span className="sr-only">Inches</span>
              <span className="input-with-suffix">
                <input
                  type="number"
                  min="0"
                  max="11.99"
                  step="0.01"
                  inputMode="decimal"
                  value={inches}
                  aria-invalid={!!error}
                  aria-describedby="height-help"
                  onChange={(event) => setDraft({ ...draft, inches: event.target.value })}
                />
                <span aria-hidden="true">in</span>
              </span>
            </label>
          </div>
        )}
        <button className="sr-only" type="submit" tabIndex={-1}>
          Apply height
        </button>
      </form>
      <input
        className="height-slider"
        type="range"
        aria-label="Height slider"
        aria-valuetext={formatHeight(placement.heightMm, document.heightUnit)}
        min={HEIGHT_MM_MIN}
        max={HEIGHT_MM_MAX}
        step="1"
        value={placement.heightMm}
        onChange={(event) => {
          app.updateHumanHeight(placement.id, {
            unit: 'cm',
            value: Number(event.target.value) / 10,
          })
          setDraft({})
          setError('')
        }}
      />
      <div className="range-labels">
        <span>{document.heightUnit === 'cm' ? '90 cm' : '2′ 11½″'}</span>
        <span>{document.heightUnit === 'cm' ? '304.8 cm' : '10′ 0″'}</span>
      </div>
      <p
        id="height-help"
        className={error ? 'field-error' : 'field-help'}
        role={error ? 'alert' : undefined}
      >
        {error || 'Type a value and press Enter, or drag to adjust.'}
      </p>
      <button
        className="text-button reset-height"
        type="button"
        onClick={() => {
          app.updateHumanHeight(placement.id, { unit: 'cm', value: entry.referenceHeightMm / 10 })
          setDraft({})
          setError('')
        }}
      >
        <ResetIcon />
        Reset to model height
      </button>
      <div className="measurement-note">
        <strong>Proportional from head to toe</strong>
        <p>
          The head and neck grow with height. Leg length and body width adjust using adult
          proportions.
        </p>
      </div>
    </section>
  )
}

function FootInspector({ app, document }: { app: CompareApp; document: CompareDocument }) {
  const placement = selectedFoot(document.feet)
  const [error, setError] = useState('')
  if (!placement)
    return <EmptyInspector mode="feet" hasPlacements={document.feet.placements.length > 0} />
  const entry = footEntry(placement.catalogId)
  const rows = shoeRows(document.shoeSystem, entry.sex)
  const currentSize = closestShoeSize(placement.shape.lengthMm, document.shoeSystem, entry.sex)
  const exactSize = rows.some(
    (row) => row.size === currentSize && row.mm === placement.shape.lengthMm,
  )
  return (
    <section className="panel inspector-panel" aria-labelledby="inspector-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Selected pair</span>
          <h2 id="inspector-title">{entry.label}</h2>
        </div>
        <span className="selection-indicator">Editing</span>
      </div>
      <div className="selection-summary">
        <span className="selection-avatar">
          <FootModelPreview placement={placement} />
        </span>
        <div>
          <strong>{formatShoe(placement.shape.lengthMm, document.shoeSystem, entry.sex)}</strong>
          <small>
            {placement.shape.lengthMm} mm long · {placement.shape.ballWidthMm} mm wide
          </small>
        </div>
      </div>
      <SkinTonePicker app={app} placement={placement} />
      <div className="measurement-heading">
        <h3>Shoe size</h3>
        <UnitToggles app={app} document={document} />
      </div>
      <label className="field shoe-field">
        <span className="sr-only">{document.shoeSystem} adult size</span>
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
      <p className="field-help">
        {!exactSize
          ? 'Closest chart size to your custom foot length.'
          : `${entry.sex === 'female' ? 'Women’s' : 'Men’s'} adult sizing · changes apply instantly.`}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <FootDimensions app={app} placement={placement} sex={entry.sex} />
      <div className="measurement-note">
        <strong>Made to measure</strong>
        <p>
          Shoe size adjusts the foot, ankle and lower leg together. Chart sizes are a guide; brand
          fit varies.
        </p>
      </div>
    </section>
  )
}

export function Inspector({ app, document }: { app: CompareApp; document: CompareDocument }) {
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
