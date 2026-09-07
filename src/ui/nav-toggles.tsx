import type { CompareApp } from '../app/compare-app.ts'
import type { CompareDocument } from '../domain/document.ts'
import {
  ExitFullscreenIcon,
  FrameIcon,
  FullscreenIcon,
  InspectIcon,
  OrbitIcon,
  ResetIcon,
  ShareIcon,
} from './icons.tsx'

export function NavToggles({
  app,
  document,
}: {
  app: CompareApp
  document: CompareDocument
}) {
  // Height mode only orbits, so it has no navigation toggle.
  if (document.mode === 'height') {
    return null
  }

  return (
    <div className="compact-toggle nav-toggle" aria-label="Feet navigation">
      <button
        type="button"
        className={document.feet.navMode === 'orbit' ? 'is-active' : ''}
        aria-pressed={document.feet.navMode === 'orbit'}
        onClick={() => app.setFeetNavMode('orbit')}
      >
        <OrbitIcon />
        Orbit
      </button>
      <button
        type="button"
        className={document.feet.navMode === 'inspect' ? 'is-active' : ''}
        aria-pressed={document.feet.navMode === 'inspect'}
        onClick={() => app.setFeetNavMode('inspect')}
      >
        <InspectIcon />
        Inspect
      </button>
    </div>
  )
}

export function ViewActions({
  app,
  fullscreen,
  onShare,
  onToggleFullscreen,
}: {
  app: CompareApp
  fullscreen: boolean
  onShare(): void
  onToggleFullscreen(): void
}) {
  return (
    <div className="view-actions">
      <button type="button" onClick={() => app.frameSelection()} title="Frame selection">
        <FrameIcon />
        <span>Frame</span>
      </button>
      <button type="button" onClick={() => app.resetView()} title="Reset view">
        <ResetIcon />
        <span>Reset</span>
      </button>
      <button type="button" onClick={onShare} title="Share link">
        <ShareIcon />
        <span>Share</span>
      </button>
      <button
        type="button"
        className={fullscreen ? 'is-active' : ''}
        aria-pressed={fullscreen}
        onClick={onToggleFullscreen}
        title={fullscreen ? 'Exit full screen' : 'Full screen'}
      >
        {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        <span>{fullscreen ? 'Exit' : 'Full screen'}</span>
      </button>
    </div>
  )
}
