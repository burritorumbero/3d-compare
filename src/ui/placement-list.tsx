import type { CompareApp } from '../app/compare-app.ts'
import { footEntry } from '../catalog/feet.ts'
import { humanEntry } from '../catalog/humans.ts'
import { humanDisplayName } from '../catalog/names.ts'
import type { CompareDocument } from '../domain/document.ts'
import { formatHeight } from '../domain/measure.ts'
import { formatShoe } from '../domain/shoe-charts.ts'
import { PlusIcon, TrashIcon } from './icons.tsx'
import { ModelPreview } from './model-preview.tsx'

export function PlacementList({
  app,
  document,
  onAdd,
  onSelect,
}: {
  app: CompareApp
  document: CompareDocument
  onAdd(): void
  onSelect(): void
}) {
  const isHeight = document.mode === 'height'
  const placements = isHeight ? document.height.placements : document.feet.placements
  const selected = isHeight ? document.height.selected : document.feet.selected

  return (
    <section className="panel lineup-panel" aria-labelledby="lineup-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Your comparison</span>
          <h2 id="lineup-title">Lineup</h2>
        </div>
        <span className="lineup-count">{placements.length} / 10</span>
      </div>

      <button
        className="primary-button add-model-button"
        type="button"
        onClick={onAdd}
        disabled={placements.length >= 10}
      >
        <PlusIcon />
        {isHeight ? 'Add person' : 'Add feet'}
      </button>
      {placements.length >= 10 && (
        <p className="cap-message" role="status">
          Lineup full. Remove a model to add another.
        </p>
      )}
      {placements.length === 0 ? (
        <div className="lineup-empty">
          <span className="empty-rule" />
          <p>Add your first model to start comparing.</p>
        </div>
      ) : (
        <ol className="lineup-list">
          {isHeight
            ? document.height.placements.map((placement, index) => {
                const entry = humanEntry(placement.catalogId)
                const name = humanDisplayName(placement)
                return (
                  <li key={placement.id}>
                    <div
                      className={
                        placement.id === selected ? 'lineup-item is-selected' : 'lineup-item'
                      }
                    >
                      <button
                        type="button"
                        className="lineup-select"
                        aria-current={placement.id === selected}
                        onClick={() => {
                          app.select(placement.id)
                          onSelect()
                        }}
                      >
                        <span className="lineup-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="lineup-avatar">
                          <ModelPreview model={entry.model} />
                        </span>
                        <span className="lineup-copy">
                          <strong>{name}</strong>
                          <small>{formatHeight(placement.heightMm, document.heightUnit)}</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="lineup-remove"
                        aria-label={`Remove ${name}`}
                        onClick={() => app.remove(placement.id)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </li>
                )
              })
            : document.feet.placements.map((placement, index) => {
                const entry = footEntry(placement.catalogId)
                return (
                  <li key={placement.id}>
                    <div
                      className={
                        placement.id === selected ? 'lineup-item is-selected' : 'lineup-item'
                      }
                    >
                      <button
                        type="button"
                        className="lineup-select"
                        aria-current={placement.id === selected}
                        onClick={() => {
                          app.select(placement.id)
                          onSelect()
                        }}
                      >
                        <span className="lineup-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="lineup-avatar">
                          <ModelPreview model={entry.model} />
                        </span>
                        <span className="lineup-copy">
                          <strong>{entry.label}</strong>
                          <small>
                            {formatShoe(placement.shape.lengthMm, document.shoeSystem, entry.sex)}
                            {placement.shape.locked.length > 0 && ' · custom shape'}
                          </small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="lineup-remove"
                        aria-label={`Remove ${entry.label}`}
                        onClick={() => app.remove(placement.id)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </li>
                )
              })}
        </ol>
      )}
    </section>
  )
}
