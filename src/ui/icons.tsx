import type { ReactNode } from 'react'

function Glyph({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function PersonIcon() {
  return (
    <Glyph>
      <circle cx="12" cy="4.5" r="2.5" />
      <path d="M8.2 21 9 13.2 6.7 16M15.8 21 15 13.2l2.3 2.8M8.3 8.5 12 7l3.7 1.5L15 13H9Z" />
    </Glyph>
  )
}

export function FootIcon() {
  return (
    <Glyph>
      <path d="M8.2 3.3c1.5 0 2.6 1.2 2.4 2.7l-.8 5c-.2 1.5.2 2.5 1.4 3.2l3.6 2.1c1.8 1 1.3 3.7-.8 4.1-4.3.8-8.6-.3-9.7-3.3-.8-2.1 1-3.9 1.6-5.7.5-1.5-.3-3.8-.2-5.5.1-1.5 1-2.6 2.5-2.6Z" />
      <circle cx="13.8" cy="4.2" r="1.1" />
      <circle cx="16.4" cy="5.1" r=".9" />
      <circle cx="18.3" cy="6.7" r=".75" />
    </Glyph>
  )
}

export function OrbitIcon() {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="2.7" />
      <path d="M3.7 9.3C5.2 5.6 8.6 3.2 12.5 3.2c4.9 0 8.4 3.7 8.1 8.3M20.3 14.7c-1.4 3.7-4.9 6.1-8.8 6.1-4.9 0-8.4-3.7-8.1-8.3" />
      <path d="m18 9.5 2.7 2.2 1.7-2.9M6 14.5l-2.7-2.2-1.7 2.9" />
    </Glyph>
  )
}

export function ShareIcon() {
  return (
    <Glyph>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
    </Glyph>
  )
}

export function FullscreenIcon() {
  return (
    <Glyph>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Glyph>
  )
}

export function ExitFullscreenIcon() {
  return (
    <Glyph>
      <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" />
    </Glyph>
  )
}

export function InspectIcon() {
  return (
    <Glyph>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.3 15.3 5 5M7.7 10.5h5.6M10.5 7.7v5.6" />
    </Glyph>
  )
}

export function FrameIcon() {
  return (
    <Glyph>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <circle cx="12" cy="12" r="2.3" />
    </Glyph>
  )
}

export function ResetIcon() {
  return (
    <Glyph>
      <path d="M4.1 9A8.2 8.2 0 1 1 5 16.7M4.1 9V4.5M4.1 9h4.5" />
    </Glyph>
  )
}

export function TrashIcon() {
  return (
    <Glyph>
      <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 10.5v6M14 10.5v6" />
    </Glyph>
  )
}

export function PlusIcon() {
  return (
    <Glyph>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  )
}
