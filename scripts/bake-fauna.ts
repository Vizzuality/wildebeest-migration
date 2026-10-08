// Bakes the Recorrido of the Manada, how far it spreads each month and where it crosses the
// main rivers, under public/fauna/.
//
//   pnpm bake:fauna   (after pnpm bake:terrain: it reads public/terrain/)
//
// Ñus: GPS collars 2019–2023, Masolele, Hopcraft, Faust & Torney (2026), Dryad, CC0,
//   https://doi.org/10.5061/dryad.rn8pk0ps8. Dryad sits behind a bot check, so download
//   WB2019_2023_data.csv from that page in a browser and drop it in .cache/fauna/.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { MAP, PLACES, project, RECORRIDO } from '../src/geo.ts'

const CACHE = '.cache/fauna'
const TERRAIN = 'public/terrain'
const OUT = 'public/fauna'
const DRYAD_CSV = `${CACHE}/WB2019_2023_data.csv`

/** Grid the Recorrido is routed on (km). */
const STEP = 1
/** Rivers are split into stretches this long (km) to count collar crossings. */
const CRUCE_BIN_KM = 5
/** A stretch crossed at least this often (crossings per km, all collars, all years) is a Cruce. */
const CRUCE_MIN_PER_KM = 1.5
/** Consecutive fixes further apart than this are not a step the animal walked. */
const MAX_GAP_H = 9
/** Fixes further than this from the month's spread (in standard deviations) are strays. */
const STRAY_SIGMA = 2.5
/**
 * Walking within this many km of a main river costs extra, up to RIVER_COST on the bank, so the
 * way keeps off the banks and crosses straight over instead of following a channel it may cross.
 */
const RIVER_SHY_KM = 4
const RIVER_COST = 8
/** Recorrido samples per month. */
const SAMPLES_PER_MONTH = 60

const nx = Math.round((MAP.maxX - MAP.minX) / STEP) + 1
const nz = Math.round((MAP.maxZ - MAP.minZ) / STEP) + 1

interface Fix {
  id: string
  t: number
  x: number
  z: number
}

type Pt = [number, number]

// Inverse transverse Mercator (Snyder 1987), UTM zone 36S.
function utm36s(e: number, n: number, a: number, invF: number): [number, number] {
  const f = 1 / invF
  const e2 = f * (2 - f)
  const ep2 = e2 / (1 - e2)
  const k0 = 0.9996
  const x = e - 500000
  const mu = (n - 10000000) / k0 / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const phi =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)
  const sin = Math.sin(phi)
  const cos = Math.cos(phi)
  const c = ep2 * cos ** 2
  const t = Math.tan(phi) ** 2
  const nu = a / Math.sqrt(1 - e2 * sin ** 2)
  const rho = (a * (1 - e2)) / (1 - e2 * sin ** 2) ** 1.5
  const d = x / (nu * k0)
  const lat =
    phi -
    ((nu * Math.tan(phi)) / rho) *
      (d ** 2 / 2 - ((5 + 3 * t + 10 * c - 4 * c ** 2 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t + 298 * c + 45 * t ** 2 - 252 * ep2 - 3 * c ** 2) * d ** 6) / 720)
  const lon = (d - ((1 + 2 * t + c) * d ** 3) / 6 + ((5 - 2 * c + 28 * t - 3 * c ** 2 + 8 * ep2 + 24 * t ** 2) * d ** 5) / 120) / cos
  return [33 + (lon * 180) / Math.PI, (lat * 180) / Math.PI]
}

async function loadNu(): Promise<Fix[]> {
  if (!existsSync(DRYAD_CSV)) {
    throw new Error(`${DRYAD_CSV} missing: download WB2019_2023_data.csv from https://doi.org/10.5061/dryad.rn8pk0ps8 in a browser`)
  }
  const rows = (await readFile(DRYAD_CSV, 'utf8')).trim().split('\n').slice(1)
  return rows.map((row) => {
    const [aid, x, y, date] = row.split(',').map((c) => c.replace(/"/g, ''))
    const [d, m, rest] = date.split('/')
    const [yy, hm] = rest.split(' ')
    const [lon, lat] = utm36s(Number(x), Number(y), 6378137, 298.257223563)
    const [px, pz] = project([lon, lat])
    return { id: aid, t: Date.UTC(Number(yy), Number(m) - 1, Number(d), ...hm.split(':').map(Number)), x: px, z: pz }
  })
}
function crossAt(a: Pt, b: Pt, c: Pt, d: Pt) {
  const rx = b[0] - a[0]
  const rz = b[1] - a[1]
  const sx = d[0] - c[0]
  const sz = d[1] - c[1]
  const den = rx * sz - rz * sx
  if (den === 0) return null
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : null
}
interface Segment {
  river: string
  line: number
  /** Distance along the line where the segment starts (km). */
  s: number
  a: Pt
  b: Pt
}
class SegmentIndex {
  cell = 2
  buckets = new Map<string, Segment[]>()
  constructor(segments: Segment[]) {
    for (const seg of segments) for (const k of this.keys(seg.a, seg.b)) this.buckets.set(k, [...(this.buckets.get(k) ?? []), seg])
  }
  keys(a: Pt, b: Pt) {
    const keys: string[] = []
    for (let x = Math.floor(Math.min(a[0], b[0]) / this.cell); x <= Math.floor(Math.max(a[0], b[0]) / this.cell); x++)
      for (let z = Math.floor(Math.min(a[1], b[1]) / this.cell); z <= Math.floor(Math.max(a[1], b[1]) / this.cell); z++) keys.push(`${x},${z}`)
    return keys
  }
  crossings(a: Pt, b: Pt) {
    const seen = new Set<Segment>()
    const hits: { seg: Segment; s: number }[] = []
    for (const k of this.keys(a, b))
      for (const seg of this.buckets.get(k) ?? []) {
        if (seen.has(seg)) continue
        seen.add(seg)
        const u = crossAt(a, b, seg.a, seg.b)
        if (u !== null) hits.push({ seg, s: seg.s + u * Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]) })
      }
    return hits
  }
}
function segmentsOf(rivers: { name: string; lines: Pt[][] }[]) {
  const segments: Segment[] = []
  for (const r of rivers)
    r.lines.forEach((line, li) => {
      let s = 0
      for (let i = 0; i < line.length - 1; i++) {
        segments.push({ river: r.name, line: li, s, a: line[i], b: line[i + 1] })
        s += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1])
      }
    })
  return segments
}
function cruces(fixes: Fix[], index: SegmentIndex, rivers: string[]) {
  const bins = new Map<string, number>()
  const byAnimal = new Map<string, Fix[]>()
  for (const f of fixes) {
    if (!byAnimal.has(f.id)) byAnimal.set(f.id, [])
    byAnimal.get(f.id)!.push(f)
  }
  for (const track of byAnimal.values()) {
    track.sort((p, q) => p.t - q.t)
    for (let i = 1; i < track.length; i++) {
      const p = track[i - 1]
      const q = track[i]
      if (q.t - p.t > MAX_GAP_H * 3600e3) continue
      for (const h of index.crossings([p.x, p.z], [q.x, q.z])) {
        const key = `${h.seg.river}|${h.seg.line}|${Math.floor(h.s / CRUCE_BIN_KM)}`
        bins.set(key, (bins.get(key) ?? 0) + 1)
      }
    }
  }
  const out: { river: string; line: number; s0: number; s1: number; crossings: number }[] = []
  const busy = [...bins].filter(([, n]) => n >= CRUCE_MIN_PER_KM * CRUCE_BIN_KM).map(([k, n]) => {
    const [river, line, bin] = k.split('|')
    return { river, line: Number(line), bin: Number(bin), n }
  })
  busy.sort((p, q) => p.river.localeCompare(q.river) || p.line - q.line || p.bin - q.bin)
  for (const b of busy) {
    const last = out.at(-1)
    if (last && last.river === b.river && last.line === b.line && last.s1 === b.bin * CRUCE_BIN_KM) {
      last.s1 += CRUCE_BIN_KM
      last.crossings += b.n
    } else out.push({ river: b.river, line: b.line, s0: b.bin * CRUCE_BIN_KM, s1: (b.bin + 1) * CRUCE_BIN_KM, crossings: b.n })
  }
  for (const r of rivers) if (!out.some((c) => c.river === r)) throw new Error(`river ${r}: collars never cross it often, so it has no Cruce`)
  return out
}
function barriers(rivers: { name: string; lines: Pt[][] }[], cuts: ReturnType<typeof cruces>) {
  const out: Pt[][] = []
  for (const r of rivers)
    r.lines.forEach((line, li) => {
      const own = cuts.filter((c) => c.river === r.name && c.line === li)
      let current: Pt[] = []
      let s = 0
      for (let i = 0; i < line.length; i++) {
        if (i > 0) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
        const open = own.some((c) => s >= c.s0 && s <= c.s1)
        if (open) {
          if (current.length > 1) out.push(current)
          current = []
        } else current.push(line[i])
      }
      if (current.length > 1) out.push(current)
    })
  return out
}

/**
 * How far the Manada spreads in each calendar month and which way it stretches: the covariance
 * of the collar fixes (xx, xz, zz in km²). Each animal counts once per month it was seen, and
 * strays far from the rest are dropped so one wanderer does not stretch the whole Manada.
 */
function forma(fixes: Fix[]) {
  const perAnimalMonth = new Map<string, number>()
  const key = (f: Fix) => {
    const d = new Date(f.t)
    return `${f.id}:${d.getUTCFullYear()}:${d.getUTCMonth()}`
  }
  for (const f of fixes) perAnimalMonth.set(key(f), (perAnimalMonth.get(key(f)) ?? 0) + 1)
  const byMonth = Array.from({ length: 12 }, () => [] as { f: Fix; w: number }[])
  for (const f of fixes) byMonth[new Date(f.t).getUTCMonth()].push({ f, w: 1 / perAnimalMonth.get(key(f))! })

  const moments = (points: { f: Fix; w: number }[]) => {
    let w = 0
    let mx = 0
    let mz = 0
    for (const p of points) {
      w += p.w
      mx += p.f.x * p.w
      mz += p.f.z * p.w
    }
    mx /= w
    mz /= w
    let xx = 0
    let xz = 0
    let zz = 0
    for (const p of points) {
      const dx = p.f.x - mx
      const dz = p.f.z - mz
      xx += dx * dx * p.w
      xz += dx * dz * p.w
      zz += dz * dz * p.w
    }
    return { mx, mz, xx: xx / w, xz: xz / w, zz: zz / w }
  }
  return byMonth.map((points) => {
    const all = moments(points)
    const det = all.xx * all.zz - all.xz * all.xz
    const kept = points.filter(({ f }) => {
      const dx = f.x - all.mx
      const dz = f.z - all.mz
      return (dx * dx * all.zz - 2 * dx * dz * all.xz + dz * dz * all.xx) / det < STRAY_SIGMA ** 2
    })
    const { xx, xz, zz } = moments(kept)
    return [+xx.toFixed(2), +xz.toFixed(2), +zz.toFixed(2)]
  })
}

/** Height, Lago, tree cover and how close a main river is, per routing cell. */
function costGrid(terrain: { nx: number; nz: number; step: number }, elevation: Uint16Array, masks: Uint8Array, cover: Uint8Array, rivers: Pt[][]) {
  const at = (x: number, z: number) => {
    const ix = Math.min(terrain.nx - 1, Math.max(0, Math.round((x - MAP.minX) / terrain.step)))
    const iz = Math.min(terrain.nz - 1, Math.max(0, Math.round((z - MAP.minZ) / terrain.step)))
    return iz * terrain.nx + ix
  }
  const height = new Float32Array(nx * nz)
  const lake = new Float32Array(nx * nz)
  const trees = new Float32Array(nx * nz)
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const x = MAP.minX + ix * STEP
      const z = MAP.minZ + iz * STEP
      const i = iz * nx + ix
      height[i] = elevation[at(x, z)] / 10000
      lake[i] = masks[at(x, z) * 2 + 1] / 255
      let t = 0
      for (const dx of [-0.3, 0, 0.3]) for (const dz of [-0.3, 0, 0.3]) t += cover[at(x + dx, z + dz) * 4] / 255 / 9
      trees[i] = t
    }
  // Distance (km) to the nearest main river: mark the cells each river runs through, then spread
  // out with a two-pass chamfer.
  const gap = new Float32Array(nx * nz).fill(Infinity)
  for (const line of rivers)
    for (let k = 1; k < line.length; k++) {
      const [a, b] = [line[k - 1], line[k]]
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (STEP / 2)) + 1
      for (let s = 0; s <= n; s++) {
        const ix = Math.round((a[0] + ((b[0] - a[0]) * s) / n - MAP.minX) / STEP)
        const iz = Math.round((a[1] + ((b[1] - a[1]) * s) / n - MAP.minZ) / STEP)
        if (ix >= 0 && iz >= 0 && ix < nx && iz < nz) gap[iz * nx + ix] = 0
      }
    }
  const pass = (from: number, to: number, dir: number, offsets: [number, number][]) => {
    for (let iz = from; iz !== to; iz += dir)
      for (let ix = dir > 0 ? 0 : nx - 1; dir > 0 ? ix < nx : ix >= 0; ix += dir)
        for (const [dx, dz] of offsets) {
          const jx = ix + dx
          const jz = iz + dz
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue
          gap[iz * nx + ix] = Math.min(gap[iz * nx + ix], gap[jz * nx + jx] + Math.hypot(dx, dz) * STEP)
        }
  }
  pass(0, nz, 1, [[-1, 0], [-1, -1], [0, -1], [1, -1]])
  pass(nz - 1, -1, -1, [[1, 0], [1, 1], [0, 1], [-1, 1]])
  const near = gap.map((g) => Math.max(0, 1 - g / RIVER_SHY_KM))
  return { height, lake, trees, near }
}

const NEIGHBOURS: Pt[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

class Heap {
  items: [number, number][] = []
  push(item: [number, number]) {
    const h = this.items
    h.push(item)
    for (let i = h.length - 1; i > 0; ) {
      const p = (i - 1) >> 1
      if (h[p][0] <= h[i][0]) break
      ;[h[p], h[i]] = [h[i], h[p]]
      i = p
    }
  }
  pop() {
    const h = this.items
    const top = h[0]
    const last = h.pop()!
    if (h.length) {
      h[0] = last
      for (let i = 0; ; ) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < h.length && h[l][0] < h[m][0]) m = l
        if (r < h.length && h[r][0] < h[m][0]) m = r
        if (m === i) break
        ;[h[m], h[i]] = [h[i], h[m]]
        i = m
      }
    }
    return top
  }
}

/**
 * The easy way from a to b: the cheapest walk over the routing grid, where steep ground and
 * trees cost more, Lagos are out and main rivers can only be crossed at a Cruce.
 */
function easyPath(a: Pt, b: Pt, cost: ReturnType<typeof costGrid>, walls: SegmentIndex): Pt[] {
  const cell = ([x, z]: Pt) => Math.round((z - MAP.minZ) / STEP) * nx + Math.round((x - MAP.minX) / STEP)
  const centre = (i: number): Pt => [MAP.minX + (i % nx) * STEP, MAP.minZ + Math.floor(i / nx) * STEP]
  const start = cell(a)
  const goal = cell(b)
  const dist = new Float64Array(nx * nz).fill(Infinity)
  const from = new Int32Array(nx * nz).fill(-1)
  const heap = new Heap()
  dist[start] = 0
  heap.push([0, start])
  while (heap.items.length) {
    const [d, i] = heap.pop()
    if (i === goal) break
    if (d > dist[i]) continue
    const ix = i % nx
    const iz = (i - ix) / nx
    for (const [dx, dz] of NEIGHBOURS) {
      const jx = ix + dx
      const jz = iz + dz
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue
      const j = jz * nx + jx
      if (cost.lake[j] > 0.5 || walls.crossings(centre(i), centre(j)).length) continue
      const len = Math.hypot(dx, dz) * STEP
      const slope = Math.abs(cost.height[j] - cost.height[i]) / len
      const nd = d + len * (1 + slope * 12 + cost.trees[j] * 3 + cost.near[j] * RIVER_COST)
      if (nd < dist[j]) {
        dist[j] = nd
        from[j] = i
        heap.push([nd, j])
      }
    }
  }
  if (from[goal] < 0) throw new Error(`no easy way from ${a} to ${b}`)
  const cells: Pt[] = []
  for (let i = goal; i >= 0; i = from[i]) cells.push(centre(i))
  cells.reverse()
  // Round off the grid's 45° corners, keeping the ends where the places are.
  let line: Pt[] = [a, ...cells.slice(1, -1), b]
  for (let pass = 0; pass < 3; pass++) {
    const next: Pt[] = [line[0]]
    for (let k = 0; k < line.length - 1; k++) {
      const [p, q] = [line[k], line[k + 1]]
      next.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75])
    }
    next.push(line.at(-1)!)
    line = next
  }
  return line
}

/** Position along a polyline at a share (0–1) of its length. */
function along(line: Pt[], share: number): Pt {
  const lengths = line.slice(1).map((p, k) => Math.hypot(p[0] - line[k][0], p[1] - line[k][1]))
  let left = share * lengths.reduce((s, l) => s + l, 0)
  for (let k = 0; k < lengths.length; k++) {
    if (left <= lengths[k] || k === lengths.length - 1) {
      const f = lengths[k] ? Math.min(1, left / lengths[k]) : 0
      return [line[k][0] + (line[k + 1][0] - line[k][0]) * f, line[k][1] + (line[k + 1][1] - line[k][1]) * f]
    }
    left -= lengths[k]
  }
  return line.at(-1)!
}

/**
 * Distance travelled at each moment, through knots of (month, km) that never go back. Monotone
 * cubic (Fritsch–Carlson), so the pace changes smoothly through a place the Manada passes by and
 * eases to a halt only where it stays (where the distance stops growing).
 */
function pacing(knots: { t: number; d: number }[]) {
  const n = knots.length
  const secant = knots.slice(0, -1).map((k, i) => (knots[i + 1].d - k.d) / (knots[i + 1].t - k.t))
  const slope = knots.map((_, i) => {
    if (i === 0 || i === n - 1) {
      // The year wraps: the first and last knot are the same moment.
      const [a, b] = [secant.at(-1)!, secant[0]]
      return a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b)
    }
    const [a, b] = [secant[i - 1], secant[i]]
    return a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b)
  })
  return (t: number) => {
    const i = Math.max(0, knots.findIndex((k, j) => j < n - 1 && t >= k.t && t <= knots[j + 1].t))
    const [a, b] = [knots[i], knots[i + 1]]
    const h = b.t - a.t
    const s = (t - a.t) / h
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1
    const h10 = s ** 3 - 2 * s ** 2 + s
    const h01 = -2 * s ** 3 + 3 * s ** 2
    const h11 = s ** 3 - s ** 2
    return h00 * a.d + h10 * h * slope[i] + h01 * b.d + h11 * h * slope[i + 1]
  }
}

/**
 * The Recorrido as positions through the year, SAMPLES_PER_MONTH a month: still at each stay,
 * and between stays along the easy way, passing each place on time without stopping there.
 */
function recorrido(cost: ReturnType<typeof costGrid>, walls: SegmentIndex) {
  const stops = RECORRIDO.map((s) => {
    const place = PLACES.find((p) => p.name === s.place)
    if (!place) throw new Error(`Recorrido: no place called ${s.place} in geo.ts`)
    return { ...s, xz: project(place.at) as Pt }
  })
  const legs = stops.map((s, k) => {
    const next = stops[(k + 1) % stops.length]
    return { from: s.until ?? s.at, to: next.at + (k === stops.length - 1 ? 12 : 0), line: easyPath(s.xz, next.xz, cost, walls), name: `${s.place} → ${next.place}` }
  })
  for (const l of legs) {
    const km = l.line.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - l.line[k][0], p[1] - l.line[k][1]), 0)
    console.log(`  ${l.name}: ${km.toFixed(0)} km in ${(l.to - l.from).toFixed(1)} months`)
  }
  // The whole year as one loop, with the distance reached at each arrival and departure.
  const loop: Pt[] = []
  const knots: { t: number; d: number }[] = []
  let km = 0
  stops.forEach((s, k) => {
    knots.push({ t: s.at, d: km })
    if (s.until !== undefined) knots.push({ t: s.until, d: km })
    const line = legs[k].line
    for (let i = 0; i < line.length; i++) {
      if (i > 0) km += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
      if (i > 0 || k === 0) loop.push(line[i])
    }
  })
  knots.push({ t: 12, d: km })
  const distance = pacing(knots)
  const out: Pt[] = []
  for (let n = 0; n < 12 * SAMPLES_PER_MONTH; n++) out.push(along(loop, distance(n / SAMPLES_PER_MONTH) / km))
  return out
}

await mkdir(OUT, { recursive: true })

const terrain = JSON.parse(await readFile(`${TERRAIN}/terrain.json`, 'utf8'))
if (terrain.minX !== MAP.minX || terrain.minZ !== MAP.minZ) throw new Error('terrain bake does not match MAP, run pnpm bake:terrain first')
const elevation = new Uint16Array((await readFile(`${TERRAIN}/elevation.bin`)).buffer.slice(0))
const masks = new Uint8Array(await readFile(`${TERRAIN}/masks.bin`))
const cover = new Uint8Array(await readFile(`${TERRAIN}/cover.bin`))

const fixes = await loadNu()
console.log(`ñus: ${fixes.length} fixes from ${new Set(fixes.map((f) => f.id)).size} collars`)

const main = (terrain.rivers as { name: string; kind: string; lines: Pt[][] }[]).filter((r) => r.kind === 'main')
const cuts = cruces(fixes, new SegmentIndex(segmentsOf(main)), main.map((r) => r.name))
for (const c of cuts) console.log(`Cruce del ${c.river}: ${c.s0}–${c.s1} km along line ${c.line}, ${c.crossings} collar crossings`)
const walls = barriers(main, cuts)

console.log('Recorrido:')
const grid = costGrid(terrain, elevation, masks, cover, main.flatMap((r) => r.lines))
const path = recorrido(grid, new SegmentIndex(segmentsOf([{ name: 'barrier', lines: walls }])))
const spread = forma(fixes)
spread.forEach(([xx, xz, zz], m) => {
  const tr = xx + zz
  const det = xx * zz - xz * xz
  const big = Math.sqrt(tr / 2 + Math.sqrt((tr * tr) / 4 - det))
  const small = Math.sqrt(tr / 2 - Math.sqrt((tr * tr) / 4 - det))
  console.log(`  forma month ${m + 1}: ${big.toFixed(0)} × ${small.toFixed(0)} km (1σ)`)
})

await writeFile(
  `${OUT}/fauna.json`,
  JSON.stringify({
    minX: MAP.minX,
    minZ: MAP.minZ,
    samplesPerMonth: SAMPLES_PER_MONTH,
    recorrido: path.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]),
    forma: spread,
    barriers: walls.map((l) => l.map(([x, z]) => [+x.toFixed(3), +z.toFixed(3)])),
  }),
)
