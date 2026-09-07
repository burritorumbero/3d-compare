import { useProgress } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import type { CompareApp } from '../app/compare-app.ts'
import { shareUrl } from '../app/share.ts'
import { useCompare } from '../app/use-compare.ts'
import { FEET_CATALOG } from '../catalog/feet.ts'
import { HUMAN_CATALOG } from '../catalog/humans.ts'
import { CompareCanvas } from '../scene/canvas.tsx'
import { CatalogDrawer } from './catalog-drawer.tsx'
import { FootIcon, PersonIcon, PlusIcon } from './icons.tsx'
import { Inspector } from './inspector.tsx'
import { ModeSwitch } from './mode-switch.tsx'
import { NavToggles, ViewActions } from './nav-toggles.tsx'
import { PlacementList } from './placement-list.tsx'
import { SceneErrorBoundary } from './scene-error-boundary.tsx'
import { UnitToggles } from './unit-toggles.tsx'
import './app.css'

/** 'native' uses the Fullscreen API; 'fallback' pins the stage over the page where that API is missing. */
type FullscreenState = 'off' | 'native' | 'fallback'

export function App({ app }: { app: CompareApp }) {
  const document = useCompare(app)
  const [notice, setNotice] = useState('')
  const [sceneReady, setSceneReady] = useState(false)
  const [fullscreen, setFullscreen] = useState<FullscreenState>('off')
  const stageRef = useRef<HTMLElement>(null)
  const loading = useProgress((state) => state.active)
  const activeCount =
    document.mode === 'height'
      ? document.height.placements.length
      : document.feet.placements.length

  useEffect(() => {
    if (!notice) {
      return
    }

    const timeout = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const page = window.document
    function sync(): void {
      setFullscreen((current) => {
        if (page.fullscreenElement === stageRef.current) {
          return 'native'
        }

        return current === 'native' ? 'off' : current
      })
    }

    page.addEventListener('fullscreenchange', sync)
    return () => page.removeEventListener('fullscreenchange', sync)
  }, [])

  useEffect(() => {
    if (fullscreen !== 'fallback') {
      return
    }

    function leaveOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setFullscreen('off')
      }
    }

    window.addEventListener('keydown', leaveOnEscape)
    return () => window.removeEventListener('keydown', leaveOnEscape)
  }, [fullscreen])

  async function toggleFullscreen(): Promise<void> {
    const page = window.document
    if (fullscreen === 'native') {
      try {
        await page.exitFullscreen()
      } catch {
        // The browser already left full screen; the change event keeps state in sync.
      }
      setFullscreen('off')
      return
    }

    if (fullscreen === 'fallback') {
      setFullscreen('off')
      return
    }

    const stage = stageRef.current
    if (stage && typeof stage.requestFullscreen === 'function') {
      try {
        await stage.requestFullscreen({ navigationUI: 'hide' })
        setFullscreen('native')
        return
      } catch {
        // Some browsers (iPhone Safari among them) refuse; fall through to the CSS mode.
      }
    }

    setFullscreen('fallback')
  }

  async function share(): Promise<void> {
    const url = shareUrl(document, `${window.location.origin}${window.location.pathname}`)
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    if (coarsePointer && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: '3D Compare lineup', url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setNotice('Link copied. Anyone who opens it sees this lineup.')
    } catch {
      window.prompt('Copy this link to share the lineup:', url)
    }
  }

  const sceneName = document.mode === 'height' ? 'Concrete studio' : 'Oak measure table'
  const sceneCode = document.mode === 'height' ? 'ROOM 01' : 'TABLE 02'
  const hint =
    document.mode === 'feet' && document.feet.navMode === 'inspect'
      ? 'Tap a pair for details · Drag to pan · Scroll to zoom'
      : document.mode === 'feet'
        ? 'Tap a pair for details · Drag to orbit · Scroll to zoom'
        : 'Tap a person for details · Drag to orbit · Scroll to zoom'

  return (
    <div className={`compare-app mode-${document.mode}`}>
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">
            <span>3D</span>
          </span>
          <div>
            <h1>3D Compare</h1>
            <p>Scale, place, and see the difference.</p>
          </div>
        </div>
        <ModeSwitch app={app} document={document} />
        <div className="header-meta">
          <span className="status-dot" />
          <span>Local workspace</span>
          <small>No account needed</small>
        </div>
      </header>

      <main className="workspace">
        <CatalogDrawer app={app} document={document} announce={setNotice} />

        <section
          ref={stageRef}
          className={fullscreen === 'off' ? 'stage-panel' : 'stage-panel is-fullscreen'}
          aria-label={`${sceneName} 3D stage`}
        >
          <div className="stage-toolbar">
            <div className="stage-title">
              <span>{sceneCode}</span>
              <strong>{sceneName}</strong>
            </div>
            <div className="stage-controls">
              {document.mode === 'feet' && (
                <>
                  <NavToggles app={app} document={document} />
                  <span className="toolbar-divider" />
                </>
              )}
              <UnitToggles app={app} document={document} />
              <span className="toolbar-divider" />
              <ViewActions
                app={app}
                fullscreen={fullscreen !== 'off'}
                onShare={() => void share()}
                onToggleFullscreen={() => void toggleFullscreen()}
              />
            </div>
          </div>

          <div className="canvas-shell">
            <SceneErrorBoundary>
              <CompareCanvas app={app} document={document} onReady={() => setSceneReady(true)} />
            </SceneErrorBoundary>

            {!sceneReady && (
              <div className="scene-state scene-loading" role="status">
                <span className="loading-cube" aria-hidden="true" />
                <strong>Preparing the 3D stage</strong>
                <p>Starting the renderer in your browser.</p>
              </div>
            )}

            {sceneReady && activeCount === 0 && (
              <div className="scene-empty">
                <span className="empty-icon">
                  {document.mode === 'height' ? <PersonIcon /> : <FootIcon />}
                </span>
                <span className="eyebrow">
                  {document.mode === 'height' ? 'Studio ready' : 'Table ready'}
                </span>
                <h2>
                  {document.mode === 'height'
                    ? 'Build your first lineup'
                    : 'Set down a pair of feet'}
                </h2>
                <p>
                  {document.mode === 'height'
                    ? 'Add up to 10 people, then tune every height.'
                    : 'Compare shoe sizes against a centimeter grid.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (document.mode === 'height') {
                      app.placeHuman(HUMAN_CATALOG[0].id)
                    } else {
                      app.placeFoot(FEET_CATALOG[0].id)
                    }
                  }}
                >
                  <PlusIcon />
                  {document.mode === 'height'
                    ? `Add ${HUMAN_CATALOG[0].label}`
                    : `Add ${FEET_CATALOG[0].label.toLowerCase()}`}
                </button>
              </div>
            )}

            <div className="scene-badge">
              <span className="status-dot" />
              Live scale
            </div>
            <div className="navigation-hint">{hint}</div>
            <div className="scale-key">
              <span />
              {document.mode === 'height' ? '1 m floor grid' : '1 cm surface grid'}
            </div>
            {/* Lets scripts and assistive tech know when models are still downloading. */}
            <span
              className="sr-only stage-status"
              role="status"
              data-loading={loading ? 'true' : 'false'}
            >
              {loading ? 'Loading models' : 'Models ready'}
            </span>
          </div>
        </section>

        <aside className="detail-column">
          <Inspector app={app} document={document} />
          <PlacementList app={app} document={document} />
        </aside>
      </main>

      <div className={notice ? 'notice-toast is-visible' : 'notice-toast'} role="status">
        {notice}
      </div>
      <div className="sr-only" aria-live="polite">
        {notice}
      </div>
    </div>
  )
}
