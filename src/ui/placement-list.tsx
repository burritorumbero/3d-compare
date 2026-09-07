import type { CompareApp } from '../app/compare-app.ts'
import { footEntry } from '../catalog/feet.ts'
import { humanEntry } from '../catalog/humans.ts'
import { humanDisplayName } from '../catalog/names.ts'
import type { CompareDocument } from '../domain/document.ts'
import { formatHeight } from '../domain/measure.ts'
import { formatShoe } from '../domain/shoe-charts.ts'
import { FootIcon, PersonIcon, TrashIcon } from './icons.tsx'

export function PlacementList({
  app,
  document,
}: {
  app: CompareApp
  document: CompareDocument
}) {
  const isHeight = document.mode === 'height'
  const placements = isHeight ? document.height.placements : document.feet.placements
  const selected = isHeight ? document.height.selected : document.feet.selected

  return (
    <section className="panel lineup-panel" aria-labelledby="lineup-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">On stage</span>
          <h2 id="lineup-title">Lineup</h2>
        </div>
        <span className="lineup-count">{placements.length}</span>
      </div>

      {placements.length === 0 ? (
        <div className="lineup-empty">
          <span className="empty-rule" />
          <p>Your comparison lineup will appear here.</p>
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
                      className={placement.id === selected ? 'lineup-item is-selected' : 'lineup-item'}
                    >
                      <button
                        type="button"
                        className="lineup-select"
                        aria-current={placement.id === selected}
                        onClick={() => app.select(placement.id)}
                      >
                        <span className="lineup-index">{String(index + 1).padStart(2, '0')}</span>
                        <span
                          className="lineup-avatar"
                          style={{
                            color: entry.swatch.outfitHex,
                            backgroundColor: entry.swatch.skinHex,
                          }}
                        >
                          <PersonIcon />
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
                      className={placement.id === selected ? 'lineup-item is-selected' : 'lineup-item'}
                    >
                      <button
                        type="button"
                        className="lineup-select"
                        aria-current={placement.id === selected}
                        onClick={() => app.select(placement.id)}
                      >
                        <span className="lineup-index">{String(index + 1).padStart(2, '0')}</span>
                        <span
                          className="lineup-avatar"
                          style={{
                            color: entry.swatch.outfitHex,
                            backgroundColor: entry.swatch.skinHex,
                          }}
                        >
                          <FootIcon />
                        </span>
                        <span className="lineup-copy">
                          <strong>{entry.label}</strong>
                          <small>
                            {formatShoe(
                              placement.footLengthMm,
                              document.shoeSystem,
                              entry.sex,
                            )}
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
