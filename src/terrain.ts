import { use } from 'react'
import * as THREE from 'three'
import { MAP } from './geo'
import { shared } from './shaders/common'

// Seeded PRNG so the landscape is identical on every load.
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Tuned by eye: enough to read the Ngorongoro highlands and the escarpments without caricature.
export const EXAGGERATION = 2

export type RiverKind = 'main' | 'tributary'

export interface RiverLine {
  name: string
  kind: RiverKind
  points: [number, number][]
}

interface TerrainMeta {
  nx: number
  nz: number
  step: number
  minX: number
  minZ: number
  base: number
  riverMax: number
  rivers: { name: string; kind: RiverKind; lines: [number, number][][] }[]
}

export interface Heightfield {
  nx: number
  nz: number
  step: number
  heights: Float32Array
  /** Per vertex Cobertura (0–1): árbol, matorral, humedal, suelo desnudo. Hierba is the rest. */
  cover: Float32Array
  /** Per vertex: distance to nearest river (km), lake (0/1). */
  masks: Float32Array
  rivers: RiverLine[]
  heightAt: (x: number, z: number) => number
}

async function fetchOk(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res
}

async function fetchHeightfield(): Promise<Heightfield> {
  const [meta, elevation, rawMasks, rawCover] = await Promise.all([
    fetchOk('/terrain/terrain.json').then((r) => r.json() as Promise<TerrainMeta>),
    fetchOk('/terrain/elevation.bin').then((r) => r.arrayBuffer()),
    fetchOk('/terrain/masks.bin').then((r) => r.arrayBuffer()),
    fetchOk('/terrain/cover.bin').then((r) => r.arrayBuffer()),
  ])
  if (meta.minX !== MAP.minX || meta.minZ !== MAP.minZ) throw new Error('terrain bake does not match MAP, run pnpm bake:terrain')

  const { nx, nz, step } = meta
  const dm = new Uint16Array(elevation)
  const bytes = new Uint8Array(rawMasks)
  const heights = new Float32Array(nx * nz)
  const masks = new Float32Array(nx * nz * 2)
  const cover = Float32Array.from(new Uint8Array(rawCover), (v) => v / 255)
  for (let i = 0; i < nx * nz; i++) {
    heights[i] = ((dm[i] / 10 - meta.base) / 1000) * EXAGGERATION
    masks[i * 2] = (bytes[i * 2] / 240) * meta.riverMax
    masks[i * 2 + 1] = bytes[i * 2 + 1] / 255
  }

  const tex = new THREE.DataTexture(heights, nx, nz, THREE.RedFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  shared.uHeight.value = tex
  shared.uMapStep.value = step

  const hf = { nx, nz, step, heights, cover, masks }
  return {
    ...hf,
    rivers: meta.rivers.flatMap((r) => r.lines.map((points) => ({ name: r.name, kind: r.kind, points }))),
    heightAt: makeSampler(hf),
  }
}

function makeSampler(hf: Pick<Heightfield, 'nx' | 'nz' | 'step' | 'heights'>) {
  return (x: number, z: number) => {
    const fx = Math.min(hf.nx - 1.001, Math.max(0, (x - MAP.minX) / hf.step))
    const fz = Math.min(hf.nz - 1.001, Math.max(0, (z - MAP.minZ) / hf.step))
    const ix = Math.floor(fx)
    const iz = Math.floor(fz)
    const tx = fx - ix
    const tz = fz - iz
    const h = hf.heights
    const a = h[iz * hf.nx + ix]
    const b = h[iz * hf.nx + ix + 1]
    const c = h[(iz + 1) * hf.nx + ix]
    const d = h[(iz + 1) * hf.nx + ix + 1]
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
  }
}

let pending: Promise<Heightfield> | null = null

// Cleared on failure so the error screen's retry triggers a fresh download.
export function loadHeightfield() {
  pending ??= fetchHeightfield().catch((err) => {
    pending = null
    throw err
  })
  return pending
}

export function useHeightfield() {
  return use(loadHeightfield())
}

/** Closest point on a named river to (x, z), so river labels sit on the real channel. */
export function snapToRiver(rivers: RiverLine[], name: string, x: number, z: number): [number, number] {
  let best: [number, number] = [x, z]
  let bestD = Infinity
  for (const r of rivers) {
    if (r.name !== name) continue
    for (const [px, pz] of r.points) {
      const d = (px - x) ** 2 + (pz - z) ** 2
      if (d < bestD) {
        bestD = d
        best = [px, pz]
      }
    }
  }
  return best
}
