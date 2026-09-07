export type FeetNavMode = 'orbit' | 'inspect'

export type HeightOrbitSnapshot = {
  kind: 'orbit'
  target: readonly [number, number, number]
  position: readonly [number, number, number]
}

/** Height mode only orbits. The alias keeps the world contract symmetrical with feet. */
export type HeightNavSnapshot = HeightOrbitSnapshot

export type FeetOrbitSnapshot = {
  kind: 'orbit'
  target: readonly [number, number, number]
  position: readonly [number, number, number]
}

export type FeetInspectSnapshot = {
  kind: 'inspect'
  target: readonly [number, number, number]
  position: readonly [number, number, number]
}

export type FeetNavSnapshot = FeetOrbitSnapshot | FeetInspectSnapshot

export type HeightCameraIntent =
  | { kind: 'none' }
  | { kind: 'frame-selection' }
  | { kind: 'reset' }
  | { kind: 'restore'; snapshot: HeightNavSnapshot }

export type FeetCameraIntent =
  | { kind: 'none' }
  | { kind: 'frame-selection' }
  | { kind: 'reset' }
  | { kind: 'restore'; snapshot: FeetNavSnapshot }
