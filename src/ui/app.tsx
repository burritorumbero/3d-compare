import { useProgress } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import type { CompareApp } from '../app/compare-app.ts'
import { shareUrl } from '../app/share.ts'
import { useCompare } from '../app/use-compare.ts'
import { CompareCanvas } from '../scene/canvas.tsx'
import { CatalogDrawer } from './catalog-drawer.tsx'
import { FootIcon, PersonIcon, PlusIcon, ShareIcon } from './icons.tsx'
import { Inspector } from './inspector.tsx'
import { ModeSwitch } from './mode-switch.tsx'
import { NavToggles, ViewActions } from './nav-toggles.tsx'
import { PlacementList } from './placement-list.tsx'
import { SceneErrorBoundary } from './scene-error-boundary.tsx'
import './app.css'

/** 'native' uses the Fullscreen API; 'fallback' pins the stage over the page where that API is missing. */
type FullscreenState = 'off' | 'native' | 'fallback'

export function App({ app }: { app: CompareApp }) {
  const document = useCompare(app)
  const [notice, setNotice] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'lineup' | 'measurements'>('measurements')
  const [sceneReady, setSceneReady] = useState(false)
  const [fullscreen, setFullscreen] = useState<FullscreenState>('off')
  const stageRef = useRef<HTMLElement>(null)
  const loading = useProgress((state) => state.active)
  const activeCount =
    document.mode === 'height' ? document.height.placements.length : document.feet.placements.length

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

  const sceneName = document.mode === 'height' ? 'Height comparison' : 'Foot comparison'
  const hint =
    document.mode === 'feet' && document.feet.navMode === 'inspect'
      ? 'Tap a pair for details · Drag to pan · Scroll to zoom'
      : document.mode === 'feet'
        ? 'Tap a pair for details · Drag to orbit · Scroll to zoom'
        : 'Tap a person for details · Drag to orbit · Scroll to zoom'

  return (
    <div className={`compare-app mode-${document.mode} mobile-${mobilePanel}`}>
      <header className="app-header">
        <a className="brand-block" href="#main-stage" aria-label="3D Compare, skip to stage">
          <span className="brand-mark" aria-hidden="true">
            3D
          </span>
          <div>
            <h1>3D Compare</h1>
            <p>A little perspective.</p>
          </div>
        </a>
        <ModeSwitch app={app} document={document} />
        <div className="header-actions">
          <span className="local-status">
            <span className="status-dot" />
            Local workspace
          </span>
          <button
            className="secondary-button share-button"
            type="button"
            onClick={() => void share()}
            title="Share link"
            aria-label="Share link"
          >
            <ShareIcon />
            <span>Share lineup</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="lineup-column" aria-label="Lineup controls">
          <PlacementList
            app={app}
            document={document}
            onAdd={() => setLibraryOpen(true)}
            onSelect={() => setMobilePanel('measurements')}
          />
          <p className="sidebar-note">Both lineups stay here when you switch modes.</p>
        </aside>
        <section
          id="main-stage"
          ref={stageRef}
          className={fullscreen === 'off' ? 'stage-panel' : 'stage-panel is-fullscreen'}
          aria-label={`${sceneName} 3D stage`}
          tabIndex={-1}
        >
          <div className="stage-toolbar">
            <div className="stage-title">
              <strong>{sceneName}</strong>
              <span>
                {activeCount}{' '}
                {document.mode === 'height'
                  ? activeCount === 1
                    ? 'person'
                    : 'people'
                  : activeCount === 1
                    ? 'pair'
                    : 'pairs'}
              </span>
            </div>
            <ViewActions
              app={app}
              fullscreen={fullscreen !== 'off'}
              onToggleFullscreen={() => void toggleFullscreen()}
            />
          </div>
          <div className="canvas-shell">
            <SceneErrorBoundary>
              <CompareCanvas app={app} document={document} onReady={() => setSceneReady(true)} />
            </SceneErrorBoundary>
            {!sceneReady && (
              <div className="scene-state scene-loading" role="status">
                <span className="loading-cube" aria-hidden="true" />
                <strong>Preparing your workspace</strong>
                <p>Starting the 3D stage…</p>
              </div>
            )}
            {sceneReady && activeCount === 0 && (
              <div className="scene-empty">
                <span className="empty-icon">
                  {document.mode === 'height' ? <PersonIcon /> : <FootIcon />}
                </span>
                <span className="eyebrow">See the difference</span>
                <h2>
                  {document.mode === 'height'
                    ? 'Put height in perspective.'
                    : 'Find a new point of view.'}
                </h2>
                <p>
                  {document.mode === 'height'
                    ? 'Build a lineup and explore how people compare, from head to toe.'
                    : 'Compare shoe sizes and fine-tune every pair on a measured grid.'}
                </p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                >
                  <PlusIcon />
                  {document.mode === 'height' ? 'Choose a person' : 'Choose a pair'}
                </button>
                <small>Up to 10 models · No account needed</small>
              </div>
            )}
            {activeCount > 0 && (
              <div className="scene-badge">
                <span className="status-dot" />
                {loading ? 'Loading models…' : 'True to scale'}
              </div>
            )}
            <span
              className="sr-only stage-status"
              role="status"
              data-loading={loading ? 'true' : 'false'}
            >
              {loading ? 'Loading models' : 'Models ready'}
            </span>
          </div>
          <div className="stage-footer">
            {document.mode === 'feet' && <NavToggles app={app} document={document} />}
            <span className="navigation-hint">{hint}</span>
            <span className="scale-key">
              {document.mode === 'height' ? '1 m grid' : '1 cm grid'}
            </span>
          </div>
        </section>
        <div className="mobile-panel-switch" aria-label="Workspace panels">
          <button
            type="button"
            aria-pressed={mobilePanel === 'lineup'}
            onClick={() => setMobilePanel('lineup')}
          >
            Lineup <span>{activeCount}</span>
          </button>
          <button
            type="button"
            aria-pressed={mobilePanel === 'measurements'}
            onClick={() => setMobilePanel('measurements')}
          >
            Measurements
          </button>
        </div>
        <aside className="detail-column" aria-label="Measurement controls">
          <Inspector app={app} document={document} />
        </aside>
      </main>
      {libraryOpen && (
        <CatalogDrawer
          app={app}
          document={document}
          announce={setNotice}
          onClose={() => setLibraryOpen(false)}
          onAdded={() => setMobilePanel('measurements')}
        />
      )}
      <div className={notice ? 'notice-toast is-visible' : 'notice-toast'} role="status">
        {notice}
      </div>
    </div>
  )
}
