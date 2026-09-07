import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createCompareApp } from './app/compare-app.ts'
import { decodeShareQuery } from './app/share.ts'
import './index.css'
import { App } from './ui/app.tsx'

// A share link describes a scene in its query string. It replaces the saved
// workspace, then the address bar is cleaned so later edits are not mistaken
// for the shared lineup.
const shared = decodeShareQuery(window.location.search)
const app = createCompareApp({
  persistKey: '3d-compare:v1',
  ...(shared ? { initialDocument: shared } : {}),
})
if (shared) {
  window.history.replaceState(null, '', window.location.pathname)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App app={app} />
  </StrictMode>,
)
