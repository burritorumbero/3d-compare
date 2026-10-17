import { useGLTF } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { ModelAsset } from '../domain/catalog.ts'

/** Resolves a catalog asset to the URL Vite serves it from under public/models. */
export function modelUrl(asset: ModelAsset): string {
  return `${import.meta.env.BASE_URL}models/${asset.file}`
}

/** The rig file shipped next to a rigged model's GLB. */
export function rigUrl(asset: ModelAsset): string {
  return modelUrl(asset).replace(/\.glb$/, '.rig.json')
}

/**
 * Starts fetching a model so a later placement does not wait on the network.
 * Models may use meshopt-compressed geometry, so the meshopt decoder is enabled.
 */
export function preloadModel(asset: ModelAsset): void {
  useGLTF.preload(modelUrl(asset), false, true)
}

export type LoadedModel = {
  /** A clone of the loaded scene. Geometry and textures stay shared with other placements. */
  object: THREE.Group
  /** Bounds of the authored mesh in meters, before placement scale. */
  bounds: THREE.Box3
}

const boundsBySource = new WeakMap<THREE.Object3D, THREE.Box3>()

function measure(source: THREE.Object3D): THREE.Box3 {
  let box = boundsBySource.get(source)
  if (!box) {
    source.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(source, true)
    boundsBySource.set(source, box)
  }

  return box
}

/**
 * Suspends until the GLB is loaded, then returns a clone owned by the calling
 * component. The clone carries no pointer handlers: figures put those on a
 * coarse hit box so the renderer never raycasts tens of thousands of triangles.
 */
/**
 * Suspends until the GLB is loaded and returns its shared scene, for callers
 * that build their own objects from its geometry (rigged feet). Do not add the
 * returned scene to the stage.
 */
export function useModelScene(asset: ModelAsset): THREE.Group {
  return useGLTF(modelUrl(asset), false, true).scene
}

export function useModel(asset: ModelAsset): LoadedModel {
  const gltf = useGLTF(modelUrl(asset), false, true)
  return useMemo(
    () => ({ object: gltf.scene.clone(true), bounds: measure(gltf.scene) }),
    [gltf],
  )
}
