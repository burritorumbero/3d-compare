import type { CompareApp } from '../app/compare-app.ts'
import { FEET_CATALOG } from '../catalog/feet.ts'
import { HUMAN_CATALOG } from '../catalog/humans.ts'
import type { ModelAsset } from '../domain/catalog.ts'
import type { CompareDocument } from '../domain/document.ts'
import { FEET_CAP } from '../domain/feet-world.ts'
import { HEIGHT_CAP } from '../domain/height-world.ts'
import { preloadRig } from '../scene/rig-cache.ts'
import { preloadModel } from '../scene/models.ts'
import { FootIcon, PersonIcon, PlusIcon } from './icons.tsx'

/** A rigged model needs its GLB, its rig file, and the kernel. */
function preloadRigged(model: ModelAsset): void {
  preloadModel(model)
  preloadRig(model)
}

export function CatalogDrawer({
  app,
  document,
  announce,
}: {
  app: CompareApp
  document: CompareDocument
  announce(message: string): void
}) {
  if (document.mode === 'height') {
    const count = document.height.placements.length
    const full = count >= HEIGHT_CAP
    return (
      <section className="panel catalog-panel" aria-labelledby="catalog-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Model library</span>
            <h2 id="catalog-title">People</h2>
          </div>
          <span className={full ? 'capacity is-full' : 'capacity'}>
            {count}/{HEIGHT_CAP}
          </span>
        </div>
        <p className="panel-intro">Choose a silhouette. You can add the same person more than once.</p>
        <div className="catalog-grid">
          {HUMAN_CATALOG.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="catalog-card"
              disabled={full}
              onPointerEnter={() => preloadRigged(entry.model)}
              onFocus={() => preloadRigged(entry.model)}
              onClick={() => {
                const result = app.placeHuman(entry.id)
                if (!result.ok) {
                  announce('The height stage is full. Remove a person to add another.')
                }
              }}
            >
              <span
                className="catalog-portrait"
                style={{
                  color: entry.swatch.outfitHex,
                  backgroundColor: entry.swatch.skinHex,
                }}
              >
                <PersonIcon />
              </span>
              <span className="catalog-copy">
                <strong>{entry.label}</strong>
                <small>{entry.subtitle}</small>
              </span>
              <span className="catalog-add" aria-hidden="true">
                <PlusIcon />
              </span>
            </button>
          ))}
        </div>
        {full && (
          <p className="cap-message" role="status">
            Stage full. Remove a person before adding another.
          </p>
        )}
      </section>
    )
  }

  const count = document.feet.placements.length
  const full = count >= FEET_CAP
  return (
    <section className="panel catalog-panel" aria-labelledby="catalog-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Model library</span>
          <h2 id="catalog-title">Feet</h2>
        </div>
        <span className={full ? 'capacity is-full' : 'capacity'}>
          {count}/{FEET_CAP}
        </span>
      </div>
      <p className="panel-intro">Add a pair of feet, cut at mid-shin, to the measuring table.</p>
      <div className="catalog-grid feet-catalog">
        {FEET_CATALOG.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="catalog-card"
            disabled={full}
            onPointerEnter={() => preloadRigged(entry.model)}
            onFocus={() => preloadRigged(entry.model)}
            onClick={() => {
              const result = app.placeFoot(entry.id)
              if (!result.ok) {
                announce('The feet table is full. Remove a model to add another.')
              }
            }}
          >
            <span
              className="catalog-portrait foot-portrait"
              style={{ color: entry.swatch.outfitHex, backgroundColor: entry.swatch.skinHex }}
            >
              <FootIcon />
            </span>
            <span className="catalog-copy">
              <strong>{entry.label}</strong>
              <small>{entry.subtitle}</small>
            </span>
            <span className="catalog-add" aria-hidden="true">
              <PlusIcon />
            </span>
          </button>
        ))}
      </div>
      {full && (
        <p className="cap-message" role="status">
          Table full. Remove a model before adding another.
        </p>
      )}
    </section>
  )
}
