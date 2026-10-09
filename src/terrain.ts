import { use } from 'react'
import * as THREE from 'three'
import { MAP } from './geo'
import type { ReliefJob } from './relief.worker.ts'
import ReliefWorker from './relief.worker.ts?worker'
import { SUN_DIR, shared } from './shaders/common'

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
  detail: number
  detailUnit: number
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
  /** Per vertex share of Cultivo (0–1), which `cover` counts inside hierba. */
  crops: Float32Array
  /** `cover` and `crops` at `detail`× the grid's resolution, as bytes, for the ground to paint from. */
  coverDetail: Uint8Array
  cropsDetail: Uint8Array
  /** Per vertex: distance to nearest river (km), lake (0/1). */
  masks: Float32Array
  /** Ground normals at `detail`× the grid's resolution: half-float x, z per cell. */
  normals: Uint16Array
  detail: number
  rivers: RiverLine[]
  heightAt: (x: number, z: number) => number
}

async function fetchOk(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res
}

function toHeights(meta: TerrainMeta, elevation: ArrayBuffer) {
  return Float32Array.from(new Uint16Array(elevation), (v) => ((v / 10 - meta.base) / 1000) * EXAGGERATION)
}

/** Bakes shadows and normals off the main thread, so they overlap the rest of the downloads. */
function reliefInWorker(heights: Float32Array, detail: Int8Array, { nx, nz, step, detail: scale, detailUnit }: TerrainMeta) {
  return new Promise<{ relief: Uint8Array; normals: Uint16Array }>((resolve, reject) => {
    const worker = new ReliefWorker()
    worker.onmessage = (e: MessageEvent<{ relief: Uint8Array; normals: Uint16Array }>) => {
      resolve(e.data)
      worker.terminate()
    }
    worker.onerror = (e) => {
      reject(new Error(`relief worker: ${e.message}`))
      worker.terminate()
    }
    const sun = SUN_DIR.toArray() as [number, number, number]
    const job: ReliefJob = { heights, nx, nz, step, sun, detail, scale, rise: (detailUnit / 1000) * EXAGGERATION }
    worker.postMessage(job)
  })
}

async function fetchHeightfield(): Promise<Heightfield> {
  const metaP = fetchOk('/terrain/terrain.json').then((r) => r.json() as Promise<TerrainMeta>)
  const heightsP = Promise.all([metaP, fetchOk('/terrain/elevation.bin').then((r) => r.arrayBuffer())]).then(([meta, elevation]) =>
    toHeights(meta, elevation),
  )
  const detailP = fetchOk('/terrain/detail.bin').then((r) => r.arrayBuffer())
  const [meta, heights, { relief, normals }, rawMasks, rawCover, rawCrops, rawVerdor, rawQuemas, rawCoverDetail, rawCropsDetail] = await Promise.all([
    metaP,
    heightsP,
    Promise.all([heightsP, detailP, metaP]).then(([h, detail, meta]) => reliefInWorker(h, new Int8Array(detail), meta)),
    fetchOk('/terrain/masks.bin').then((r) => r.arrayBuffer()),
    fetchOk('/terrain/cover.bin').then((r) => r.arrayBuffer()),
    fetchOk('/terrain/crops.bin').then((r) => r.arrayBuffer()),
    fetchOk('/terrain/verdor.bin').then((r) => r.arrayBuffer()),
    fetchOk('/terrain/quemas.bin').then((r) => r.arrayBuffer()),
    fetchOk('/terrain/cover-detail.bin').then((r) => r.arrayBuffer()),
    fetchOk('/terrain/crops-detail.bin').then((r) => r.arrayBuffer()),
  ])
  if (meta.minX !== MAP.minX || meta.minZ !== MAP.minZ) throw new Error('terrain bake does not match MAP, run pnpm bake:terrain')

  const { nx, nz, step } = meta
  const bytes = new Uint8Array(rawMasks)
  const masks = new Float32Array(nx * nz * 2)
  const cover = Float32Array.from(new Uint8Array(rawCover), (v) => v / 255)
  const crops = Float32Array.from(new Uint8Array(rawCrops), (v) => v / 255)
  for (let i = 0; i < nx * nz; i++) {
    masks[i * 2] = (bytes[i * 2] / 240) * meta.riverMax
    masks[i * 2 + 1] = bytes[i * 2 + 1] / 255
  }

  const tex = new THREE.DataTexture(heights, nx, nz, THREE.RedFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  shared.uHeight.value = tex
  shared.uMapStep.value = step
  shared.uGrid.value.set(nx, nz)
  shared.uVerdor.value = verdorTextures(new Uint8Array(rawVerdor), nx, nz)
  shared.uQuemas.value = quemasTexture(new Uint8Array(rawQuemas), nx, nz)
  shared.uQuemaMask.value = quemaMaskTexture(new Uint8Array(rawQuemas), nx, nz)
  shared.uRelief.value = reliefTexture(relief, (nx - 1) * meta.detail + 1, (nz - 1) * meta.detail + 1)

  const coverDetail = new Uint8Array(rawCoverDetail)
  const cropsDetail = new Uint8Array(rawCropsDetail)
  const hf = { nx, nz, step, heights, cover, crops, coverDetail, cropsDetail, masks, normals, detail: meta.detail }
  return {
    ...hf,
    rivers: meta.rivers.flatMap((r) => r.lines.map((points) => ({ name: r.name, kind: r.kind, points }))),
    heightAt: makeSampler(hf),
  }
}

/** Twelve months of Verdor per cell, split across three RGBA textures (four months each). */
function verdorTextures(verdor: Uint8Array, nx: number, nz: number) {
  return [0, 1, 2].map((k) => {
    const data = new Uint8Array(nx * nz * 4)
    for (let i = 0; i < nx * nz; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = verdor[i * 12 + k * 4 + c]
    const tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.needsUpdate = true
    return tex
  })
}

/** Per detail cell: sun past the Relieve (R) and open sky (G), from bakeRelief. */
function reliefTexture(relief: Uint8Array, nx: number, nz: number) {
  const tex = new THREE.DataTexture(relief, nx, nz, THREE.RGFormat)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.unpackAlignment = 2
  tex.needsUpdate = true
  return tex
}

/** Usual month of each cell's Quema (1–12, 0 = none). Nearest filtering: months don't blend. */
function quemasTexture(quemas: Uint8Array, nx: number, nz: number) {
  const tex = new THREE.DataTexture(quemas, nx, nz, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

/** Burns at all (0/1), filtered, so scar edges can be traced smoothly between cells. */
function quemaMaskTexture(quemas: Uint8Array, nx: number, nz: number) {
  const tex = new THREE.DataTexture(quemas.map((m) => (m ? 255 : 0)), nx, nz, THREE.RedFormat)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
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
