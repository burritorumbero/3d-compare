// Reads any shipped GLB (plain, or meshopt-compressed with WebP textures) through
// glTF-Transform, and offers the same per-mesh accessors as glb.mjs: values per
// vertex with a mesh's primitives concatenated in order.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

let io = null

export async function modelIO() {
  if (!io) {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready])
    io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
  }
  return io
}

export async function readModel(path) {
  const document = await (await modelIO()).read(path)
  const root = document.getRoot()
  const meshes = root.listMeshes()

  function mesh(name) {
    const found = meshes.find((candidate) => candidate.getName() === name)
    if (!found) {
      throw new Error(`Mesh ${name} not found in ${path}.`)
    }
    return found
  }

  /** An attribute of every vertex of the mesh, as arrays (normalized integers become floats). */
  function attribute(name, attributeName) {
    const values = []
    for (const primitive of mesh(name).listPrimitives()) {
      const accessor = primitive.getAttribute(attributeName)
      if (!accessor) {
        throw new Error(`Mesh ${name} has no ${attributeName} attribute.`)
      }
      for (let index = 0; index < accessor.getCount(); index += 1) {
        values.push(accessor.getElement(index, []))
      }
    }
    return values
  }

  return {
    document,
    meshNames: meshes.map((candidate) => candidate.getName()),
    extensionsRequired: root.listExtensionsRequired().map((extension) => extension.extensionName),
    hasSkins: root.listSkins().length > 0,
    hasAnimations: root.listAnimations().length > 0,
    transformedNodes: root
      .listNodes()
      .filter((node) => node.getTranslation().some((v) => v !== 0) || node.getScale().some((v) => v !== 1) || node.getRotation().slice(0, 3).some((v) => v !== 0)),
    extras: (name) => root.listNodes().find((node) => node.getMesh()?.getName() === name)?.getExtras() ?? {},
    triangles: meshes.flatMap((candidate) => candidate.listPrimitives()).reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3, 0),
    positions: (name) => attribute(name, 'POSITION'),
    attribute,
  }
}
