import * as THREE from 'three'
import { MAP, PLACES, project } from './geo'
import type { Heightfield } from './terrain'

/**
 * The terrain mesh keeps one vertex in STRIDE each way. At full resolution most triangles were
 * smaller than a pixel, and the GPU shades every triangle in 2×2 blocks, so the ground shader ran
 * several times per pixel. Normals (finer still than the grid), Cobertura, Cultivo and lakes come
 * from textures instead, so the shading keeps every gully.
 */
export const STRIDE = 2

/** Superellipse exponent: 2 is a true ellipse, higher squares it off towards the Mapa's corners. */
const OVAL = 3.2
/** The coast sits this far (km) inside the oval on average; the noise pushes it in and out from there. */
const BODY = 12
/** Coastline noise, as wavelength and the most it moves the coast (km): broad bays down to small coves. */
const COAST = [
  [110, 20],
  [48, 16],
  [22, 8],
  [10, 3],
  [4.5, 1.4],
  [2, 0.6],
]
/** How far (km) the coast is bent sideways, so bays curl and headlands hook instead of pointing out. */
const WARP = 22
const WARP_WAVELENGTH = 90
/** Ground kept round every named place (km), blended into the coast over BLEND so it reads as a headland, not a disc. */
const KEEP = 18
const BLEND = 30
/** Lakes keep a broad stretch of their water, so the cut runs through it; country names keep nothing. */
const KEEP_LAKE = 26

export type Outline = [number, number][]

export interface Corte {
  /** Land (positive) or sea (negative), roughly in km, at every vertex of the terrain mesh. */
  field: Float32Array
  /** Vertices across and down, and the spacing between them (km). */
  gx: number
  gz: number
  cell: number
  /** Every closed stretch of coast: the island's own, and any islet's. */
  loops: Outline[]
  cols: number
  rows: number
  maxX: number
  maxZ: number
}

/** The part of the grid the terrain mesh covers: whole STRIDE cells only. */
export function meshExtent({ nx, nz, step }: Pick<Heightfield, 'nx' | 'nz' | 'step'>) {
  const cols = Math.floor((nx - 1) / STRIDE) * STRIDE
  const rows = Math.floor((nz - 1) / STRIDE) * STRIDE
  return { cols, rows, maxX: MAP.minX + cols * step, maxZ: MAP.minZ + rows * step }
}

/** Smooth 2D value noise, about −1…1, one lattice cell per unit. */
function valueNoise(seed: number) {
  const lattice = (ix: number, iz: number) => {
    const h = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453
    return (h - Math.floor(h)) * 2 - 1
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (x: number, z: number) => {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const fx = smooth(x - ix)
    const fz = smooth(z - iz)
    const a = lattice(ix, iz) + (lattice(ix + 1, iz) - lattice(ix, iz)) * fx
    const b = lattice(ix, iz + 1) + (lattice(ix + 1, iz + 1) - lattice(ix, iz + 1)) * fx
    return a + (b - a) * fz
  }
}

/**
 * The island: an oval shore pushed in and out by warped noise at many scales, so it grows
 * peninsulas, bays and the odd islet. Every named place keeps a disc of ground round it, and the
 * sea always closes before the edge of the Mapa.
 */
function landField(extent: ReturnType<typeof meshExtent>) {
  const cx = (MAP.minX + extent.maxX) / 2
  const cz = (MAP.minZ + extent.maxZ) / 2
  const hx = (extent.maxX - MAP.minX) / 2
  const hz = (extent.maxZ - MAP.minZ) / 2
  const coast = COAST.map(([wavelength, km], k) => ({ noise: valueNoise(k + 1), wavelength, km }))
  const warpX = valueNoise(11)
  const warpZ = valueNoise(12)
  const fringe = valueNoise(13)
  const places = PLACES.filter((p) => p.kind !== 'country').map((p) => [...project(p.at), p.kind === 'water' ? KEEP_LAKE : KEEP])
  return (x: number, z: number) => {
    const wx = x + warpX(x / WARP_WAVELENGTH, z / WARP_WAVELENGTH) * WARP
    const wz = z + warpZ(x / WARP_WAVELENGTH, z / WARP_WAVELENGTH) * WARP
    const ux = Math.abs(wx - cx) / hx
    const uz = Math.abs(wz - cz) / hz
    let f = (1 - (ux ** OVAL + uz ** OVAL) ** (1 / OVAL)) * Math.min(hx, hz) - BODY
    for (const o of coast) f += o.noise(wx / o.wavelength, wz / o.wavelength) * o.km
    for (const [px, pz, keep] of places) {
      const disc = keep - Math.hypot(x - px, z - pz)
      const h = Math.max(BLEND - Math.abs(f - disc), 0) / BLEND
      f = Math.max(f, disc) + (h * h * BLEND) / 4
    }
    // Where the coast runs up against the edge of the Mapa it frays well short of it, never along it.
    const edge = Math.min(x - MAP.minX, extent.maxX - x, z - MAP.minZ, extent.maxZ - z)
    const fray = fringe(wx / 24, wz / 24) * 11 + fringe(wx / 9, wz / 9 + 40) * 4 + fringe(wx / 3.5, wz / 3.5 + 80) * 1.5
    return Math.min(f, edge - 17 + fray)
  }
}

/** Marching squares on the field: the coast as closed loops of straight steps between grid edges. */
function traceCoast(field: Float32Array, gx: number, gz: number, cell: number): Outline[] {
  const f = (i: number, j: number) => field[j * gx + i]
  // Grid edges are numbered: horizontal ones first, then vertical.
  const hEdge = (i: number, j: number) => j * (gx - 1) + i
  const vEdge = (i: number, j: number) => gz * (gx - 1) + j * gx + i
  const crossing = new Map<number, [number, number]>()
  const links = new Map<number, number[]>()
  const cross = (id: number, ax: number, az: number, fa: number, bx: number, bz: number, fb: number) => {
    if (!crossing.has(id)) {
      const t = fa / (fa - fb)
      crossing.set(id, [MAP.minX + (ax + (bx - ax) * t) * cell, MAP.minZ + (az + (bz - az) * t) * cell])
    }
    return id
  }
  const link = (a: number, b: number) => {
    links.set(a, [...(links.get(a) ?? []), b])
    links.set(b, [...(links.get(b) ?? []), a])
  }
  for (let j = 0; j < gz - 1; j++) {
    for (let i = 0; i < gx - 1; i++) {
      const a = f(i, j)
      const b = f(i + 1, j)
      const c = f(i, j + 1)
      const d = f(i + 1, j + 1)
      const ids: number[] = []
      if (a > 0 !== b > 0) ids.push(cross(hEdge(i, j), i, j, a, i + 1, j, b))
      if (b > 0 !== d > 0) ids.push(cross(vEdge(i + 1, j), i + 1, j, b, i + 1, j + 1, d))
      if (c > 0 !== d > 0) ids.push(cross(hEdge(i, j + 1), i, j + 1, c, i + 1, j + 1, d))
      if (a > 0 !== c > 0) ids.push(cross(vEdge(i, j), i, j, a, i, j + 1, c))
      if (ids.length === 2) link(ids[0], ids[1])
      else if (ids.length === 4) {
        // Saddle: pair the crossings so the side the cell's centre is on stays joined.
        const centre = (a + b + c + d) / 4 > 0
        if (centre === a > 0) {
          link(ids[0], ids[1])
          link(ids[2], ids[3])
        } else {
          link(ids[0], ids[3])
          link(ids[1], ids[2])
        }
      }
    }
  }
  const loops: Outline[] = []
  const seen = new Set<number>()
  for (const start of links.keys()) {
    if (seen.has(start)) continue
    const loop: Outline = []
    let prev = -1
    let at = start
    while (!seen.has(at)) {
      seen.add(at)
      loop.push(crossing.get(at)!)
      const next = links.get(at)!.find((n) => n !== prev && !seen.has(n))
      if (next === undefined) break
      prev = at
      at = next
    }
    if (loop.length > 2) loops.push(loop)
  }
  return loops
}

function build(hf: Pick<Heightfield, 'nx' | 'nz' | 'step'>): Corte {
  const extent = meshExtent(hf)
  const cell = hf.step * STRIDE
  const gx = extent.cols / STRIDE + 1
  const gz = extent.rows / STRIDE + 1
  const land = landField(extent)
  const field = new Float32Array(gx * gz)
  for (let j = 0; j < gz; j++) for (let i = 0; i < gx; i++) field[j * gx + i] = land(MAP.minX + i * cell, MAP.minZ + j * cell)
  // No vertex sits exactly on the coast, so every crossing falls strictly between two.
  for (let k = 0; k < field.length; k++) if (field[k] === 0) field[k] = 1e-4
  return { field, gx, gz, cell, loops: traceCoast(field, gx, gz, cell), ...extent }
}

/** The field between vertices, bilinear, exactly as the GPU filters it. */
export function landAt({ field, gx, gz, cell }: Corte, x: number, z: number) {
  const fx = Math.min(gx - 1.001, Math.max(0, (x - MAP.minX) / cell))
  const fz = Math.min(gz - 1.001, Math.max(0, (z - MAP.minZ) / cell))
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const tx = fx - i
  const tz = fz - j
  const a = field[j * gx + i]
  const b = field[j * gx + i + 1]
  const c = field[(j + 1) * gx + i]
  const d = field[(j + 1) * gx + i + 1]
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
}

/** Whether a point is on the island, for anything placed on the ground. */
export function inCorte(corte: Corte, x: number, z: number) {
  return landAt(corte, x, z) > 0
}

/** Outward direction of the coast at a point: down the field's slope. */
export function seaward(corte: Corte, x: number, z: number): [number, number] {
  const e = corte.cell * 0.5
  const dx = landAt(corte, x - e, z) - landAt(corte, x + e, z)
  const dz = landAt(corte, x, z - e) - landAt(corte, x, z + e)
  const len = Math.hypot(dx, dz) || 1
  return [dx / len, dz / len]
}

/** Ground height exactly as the terrain mesh draws it, triangle by triangle, so the walls meet it without a seam. */
export function meshHeight({ nx, step, heights }: Pick<Heightfield, 'nx' | 'step' | 'heights'>, x: number, z: number) {
  const cell = step * STRIDE
  const fx = (x - MAP.minX) / cell
  const fz = (z - MAP.minZ) / cell
  const ix = Math.floor(fx)
  const iz = Math.floor(fz)
  const u = fx - ix
  const v = fz - iz
  const at = (i: number, j: number) => heights[(iz + j) * STRIDE * nx + (ix + i) * STRIDE]
  const a = at(0, 0)
  const b = at(1, 0)
  const c = at(0, 1)
  const d = at(1, 1)
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d)
}

/** Same test for the terrain shader, which discards the ground in the sea. */
export const CORTE_GLSL = /* glsl */ `
uniform sampler2D uLand;
bool inCorte(vec2 p) {
  vec2 grid = (p - uMapMin) / (uMapStep * ${STRIDE.toFixed(1)});
  return texture2D(uLand, (grid + 0.5) / vec2(textureSize(uLand, 0))).r > 0.0;
}
`

/** The land field as a half-float texture: linearly filtered on every WebGL2 GPU, and precise near zero. */
export function landTexture({ field, gx, gz }: Corte) {
  const data = new Uint16Array(field.length)
  for (let k = 0; k < field.length; k++) data[k] = THREE.DataUtils.toHalfFloat(field[k])
  const tex = new THREE.DataTexture(data, gx, gz, THREE.RedFormat, THREE.HalfFloatType)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/** Distance to the coast baked on a coarse grid, so the table's shadow is one lookup a pixel. */
export const FIELD_MARGIN = 80
const FIELD_RES = 256
/** Texels hold distance + FIELD_OFFSET in half-km steps, so −20…107 km fit a byte. */
export const FIELD_OFFSET = 20

export function distanceField(corte: Corte) {
  const min = new THREE.Vector2(MAP.minX - FIELD_MARGIN, MAP.minZ - FIELD_MARGIN)
  const size = new THREE.Vector2(corte.maxX - MAP.minX + FIELD_MARGIN * 2, corte.maxZ - MAP.minZ + FIELD_MARGIN * 2)
  const texel = size.x / FIELD_RES
  const n = FIELD_RES * FIELD_RES
  const land = new Uint8Array(n)
  for (let j = 0; j < FIELD_RES; j++) {
    for (let i = 0; i < FIELD_RES; i++) {
      const x = min.x + (i + 0.5) * texel
      const z = min.y + ((j + 0.5) / FIELD_RES) * size.y
      land[j * FIELD_RES + i] = x > MAP.minX && x < corte.maxX && z > MAP.minZ && z < corte.maxZ && inCorte(corte, x, z) ? 1 : 0
    }
  }
  // Two-pass chamfer distance, to land from the sea and to sea from the land.
  const chamfer = (target: number) => {
    const d = new Float32Array(n).fill(1e9)
    for (let k = 0; k < n; k++) if (land[k] === target) d[k] = 0
    const pass = (k: number, i: number, j: number, di: number, dj: number, w: number) => {
      const ni = i + di
      const nj = j + dj
      if (ni >= 0 && nj >= 0 && ni < FIELD_RES && nj < FIELD_RES) d[k] = Math.min(d[k], d[nj * FIELD_RES + ni] + w)
    }
    for (let j = 0; j < FIELD_RES; j++)
      for (let i = 0; i < FIELD_RES; i++) {
        const k = j * FIELD_RES + i
        pass(k, i, j, -1, 0, 1)
        pass(k, i, j, 0, -1, 1)
        pass(k, i, j, -1, -1, Math.SQRT2)
        pass(k, i, j, 1, -1, Math.SQRT2)
      }
    for (let j = FIELD_RES - 1; j >= 0; j--)
      for (let i = FIELD_RES - 1; i >= 0; i--) {
        const k = j * FIELD_RES + i
        pass(k, i, j, 1, 0, 1)
        pass(k, i, j, 0, 1, 1)
        pass(k, i, j, 1, 1, Math.SQRT2)
        pass(k, i, j, -1, 1, Math.SQRT2)
      }
    return d
  }
  const toLand = chamfer(1)
  const toSea = chamfer(0)
  const data = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    const d = (land[k] ? -toSea[k] : toLand[k]) * texel
    data[k] = Math.max(0, Math.min(255, Math.round((d + FIELD_OFFSET) * 2)))
  }
  const tex = new THREE.DataTexture(data, FIELD_RES, FIELD_RES, THREE.RedFormat)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return { tex, min, size }
}

const cache = new WeakMap<object, Corte>()

/** The Corte for this heightfield, worked out once and shared by everything that clips to it. */
export function corteOf(hf: Pick<Heightfield, 'nx' | 'nz' | 'step'>) {
  let c = cache.get(hf)
  if (!c) {
    c = build(hf)
    cache.set(hf, c)
  }
  return c
}
