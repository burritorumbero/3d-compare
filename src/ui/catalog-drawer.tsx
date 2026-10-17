import { useEffect, useRef } from 'react'
import type { CompareApp } from '../app/compare-app.ts'
import { FEET_CATALOG } from '../catalog/feet.ts'
import { HUMAN_CATALOG } from '../catalog/humans.ts'
import type { CompareDocument } from '../domain/document.ts'
import { FEET_CAP } from '../domain/feet-world.ts'
import { HEIGHT_CAP } from '../domain/height-world.ts'
import { formatHeight } from '../domain/measure.ts'
import { CloseIcon, PlusIcon } from './icons.tsx'
import { ModelPreview } from './model-preview.tsx'

export function CatalogDrawer({
  app,
  document,
  onClose,
  onAdded,
  announce,
}: {
  app: CompareApp
  document: CompareDocument
  onClose(): void
  onAdded(): void
  announce(message: string): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const isHeight = document.mode === 'height'
  const count = isHeight ? document.height.placements.length : document.feet.placements.length
  const cap = isHeight ? HEIGHT_CAP : FEET_CAP
  const full = count >= cap
  useEffect(() => {
    const element = dialog.current!
    const opener = window.document.activeElement as HTMLElement | null
    element.showModal()
    return () => {
      element.close()
      queueMicrotask(() => {
        if (opener?.isConnected && opener.getClientRects().length)
          opener.focus({ preventScroll: true })
        else
          window.document
            .querySelector<HTMLElement>('.inspector-panel input, #main-stage')
            ?.focus({ preventScroll: true })
      })
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className="catalog-dialog"
      aria-labelledby="catalog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        const active = window.document.activeElement
        if (event.shiftKey && active === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="catalog-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Model library</span>
            <h2 id="catalog-title">{isHeight ? 'Add a person' : 'Add a pair of feet'}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close model library"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <p className="panel-intro">
          Choose a model, then adjust its measurements. You can add the same model more than once.
        </p>
        <div className={`catalog-grid ${isHeight ? '' : 'feet-catalog'}`}>
          {isHeight
            ? HUMAN_CATALOG.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="catalog-card"
                  aria-label={`Add ${entry.label}`}
                  disabled={full}
                  onClick={() => {
                    const result = app.placeHuman(entry.id)
                    if (result.ok) {
                      onAdded()
                      onClose()
                    } else announce('Your lineup is full. Remove a person to add another.')
                  }}
                >
                  <span className="catalog-portrait">
                    <ModelPreview model={entry.model} />
                  </span>
                  <span className="catalog-copy">
                    <strong>{entry.label}</strong>
                    <small>
                      {entry.sex === 'female' ? 'Female' : 'Male'} ·{' '}
                      {formatHeight(entry.referenceHeightMm, document.heightUnit)}
                    </small>
                  </span>
                  <span className="catalog-add">
                    <PlusIcon />
                  </span>
                </button>
              ))
            : FEET_CATALOG.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="catalog-card"
                  aria-label={`Add ${entry.label.toLowerCase()}`}
                  disabled={full}
                  onClick={() => {
                    const result = app.placeFoot(entry.id)
                    if (result.ok) {
                      onAdded()
                      onClose()
                    } else announce('Your lineup is full. Remove a pair to add another.')
                  }}
                >
                  <span className="catalog-portrait">
                    <ModelPreview model={entry.model} />
                  </span>
                  <span className="catalog-copy">
                    <strong>{entry.label}</strong>
                    <small>Pair · includes lower legs</small>
                  </span>
                  <span className="catalog-add">
                    <PlusIcon />
                  </span>
                </button>
              ))}
        </div>
        <div className="catalog-footer">
          <span>
            {count} of {cap} places used
          </span>
          <span>Measurements can be changed anytime</span>
        </div>
      </section>
    </dialog>
  )
}
