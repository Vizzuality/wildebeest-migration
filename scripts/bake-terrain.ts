// Bakes the real relief and rivers of the Mapa into static assets under public/terrain/.
//
//   pnpm bake:terrain
//
// Elevation: AWS Terrain Tiles (Terrarium encoding), averaged onto the grid.
// Rivers: OpenStreetMap waterways, via the Overpass API.
// Downloads are cached in .cache/terrain so re-runs are offline.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { PNG } from 'pngjs'
import { MAP, project, unproject } from '../src/geo.ts'

const STEP = 0.3
const ZOOM = 11
const TILE = 256
const CACHE = '.cache/terrain'
const OUT = 'public/terrain'
const USER_AGENT = 'serengeti-migration terrain bake'

// Lake surfaces are flat in the DEM at these levels (m). Victoria's is also the Cota base.
// Each lake floods from its seed points, so inland flats at the same level stay dry. Speke
// Gulf needs its own seed: it only joins the open lake west of the Mapa.
// Natron's bed is soda flats rather than open water, so it is only flat to within a few metres.
const LAKES: { name: string; level: number; margin?: number; seeds: [number, number][] }[] = [
  { name: 'Victoria', level: 1134, seeds: [[33.6, -1.1], [33.6, -2.2]] },
  { name: 'Eyasi', level: 1027, seeds: [[35.27, -3.42]] },
  { name: 'Manyara', level: 954, seeds: [[35.827, -3.553]] },
  { name: 'Natron', level: 600, margin: 5, seeds: [[35.95, -2.4]] },
]
const BASE = LAKES[0].level
/** Default metres above a lake's level that still count as Lago. */
const LAKE_MARGIN = 1.5
/** Beyond this distance (km) the river mask just saturates. */
const RIVER_MAX = 6

const RIVERS: { name: string; kind: 'main' | 'tributary'; osm: string[] }[] = [
  { name: 'Mara', kind: 'main', osm: ['Mara'] },
  { name: 'Grumeti', kind: 'main', osm: ['Grumeti'] },
  { name: 'Mbalageti', kind: 'main', osm: ['Mbalageti', 'Mbalageti River'] },
  { name: 'Orangi', kind: 'tributary', osm: ['Orangi River'] },
  { name: 'Seronera', kind: 'tributary', osm: ['Seronera River'] },
  { name: 'Sand', kind: 'tributary', osm: ['Sand River'] },
  { name: 'Talek', kind: 'tributary', osm: ['Talek River', 'Talek river'] },
  { name: 'Olare Orok', kind: 'tributary', osm: ['Olare Orok'] },
  { name: 'Oldupai', kind: 'tributary', osm: ['Oldupai River'] },
]

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']

const nx = Math.round((MAP.maxX - MAP.minX) / STEP) + 1
const nz = Math.round((MAP.maxZ - MAP.minZ) / STEP) + 1

async function cached(file: string, download: () => Promise<Buffer>) {
  const path = `${CACHE}/${file}`
  if (existsSync(path)) return readFile(path)
  const data = await download()
  await writeFile(path, data)
  return data
}

async function retry<T>(fn: (attempt: number) => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn(i)
    } catch (err) {
      if (i >= attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
}

const WORLD_PX = TILE * 2 ** ZOOM

function lonToPx(lon: number) {
  return ((lon + 180) / 360) * WORLD_PX
}

function latToPx(lat: number) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD_PX
}

async function loadMosaic() {
  const [west, north] = unproject(MAP.minX - 1, MAP.minZ - 1)
  const [east, south] = unproject(MAP.maxX + 1, MAP.maxZ + 1)
  const tx0 = Math.floor(lonToPx(west) / TILE)
  const tx1 = Math.floor(lonToPx(east) / TILE)
  const ty0 = Math.floor(latToPx(north) / TILE)
  const ty1 = Math.floor(latToPx(south) / TILE)
  const cols = tx1 - tx0 + 1
  const rows = ty1 - ty0 + 1
  const width = cols * TILE
  const elev = new Float32Array(width * rows * TILE)

  const jobs: [number, number][] = []
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty])
  console.log(`elevation: ${jobs.length} tiles at z${ZOOM}`)

  let done = 0
  const worker = async () => {
    while (jobs.length) {
      const [tx, ty] = jobs.pop()!
      const buf = await cached(`terrarium-${ZOOM}-${tx}-${ty}.png`, () =>
        retry(async () => {
          const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`)
          if (!res.ok) throw new Error(`tile ${tx}/${ty}: ${res.status}`)
          return Buffer.from(await res.arrayBuffer())
        }),
      )
      const png = PNG.sync.read(buf)
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const s = (py * TILE + px) * 4
          const e = png.data[s] * 256 + png.data[s + 1] + png.data[s + 2] / 256 - 32768
          elev[((ty - ty0) * TILE + py) * width + (tx - tx0) * TILE + px] = e
        }
      }
      if (++done % 25 === 0) console.log(`  ${done} tiles`)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))

  const ox = tx0 * TILE
  const oy = ty0 * TILE
  const height = rows * TILE
  /** Bilinear elevation (m) at a lon/lat. */
  return (lon: number, lat: number) => {
    const fx = Math.min(width - 1.001, Math.max(0, lonToPx(lon) - ox - 0.5))
    const fy = Math.min(height - 1.001, Math.max(0, latToPx(lat) - oy - 0.5))
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    const tx = fx - ix
    const ty = fy - iy
    const i = iy * width + ix
    return (elev[i] * (1 - tx) + elev[i + 1] * tx) * (1 - ty) + (elev[i + width] * (1 - tx) + elev[i + width + 1] * tx) * ty
  }
}

/** Box-filter the source onto the grid: 4×4 bilinear taps per cell, since a cell spans ~3 source pixels. */
function resample(sample: (lon: number, lat: number) => number) {
  const out = new Float32Array(nx * nz)
  const taps = 4
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      let sum = 0
      for (let a = 0; a < taps; a++) {
        for (let b = 0; b < taps; b++) {
          const x = MAP.minX + (ix + (a + 0.5) / taps - 0.5) * STEP
          const z = MAP.minZ + (iz + (b + 0.5) / taps - 0.5) * STEP
          sum += sample(...unproject(x, z))
        }
      }
      out[iz * nx + ix] = sum / (taps * taps)
    }
  }
  return out
}

function lakeMask(elev: Float32Array) {
  const mask = new Uint8Array(nx * nz)
  for (const { name, level, margin = LAKE_MARGIN, seeds } of LAKES) {
    const stack = seeds.map((seed) => {
      const [sx, sz] = project(seed)
      const i = Math.round((sz - MAP.minZ) / STEP) * nx + Math.round((sx - MAP.minX) / STEP)
      if (elev[i] > level + margin) throw new Error(`lake ${name}: seed ${seed} is on land (${elev[i].toFixed(0)} m)`)
      return i
    })
    while (stack.length) {
      const i = stack.pop()!
      if (mask[i] || elev[i] > level + margin) continue
      mask[i] = 1
      const ix = i % nx
      if (ix > 0) stack.push(i - 1)
      if (ix < nx - 1) stack.push(i + 1)
      if (i >= nx) stack.push(i - nx)
      if (i < nx * (nz - 1)) stack.push(i + nx)
    }
  }
  return mask
}

interface OsmWay {
  tags: { name: string }
  geometry: { lat: number; lon: number }[]
}

async function loadWays(): Promise<OsmWay[]> {
  const [west, north] = unproject(MAP.minX, MAP.minZ)
  const [east, south] = unproject(MAP.maxX, MAP.maxZ)
  const names = RIVERS.flatMap((r) => r.osm).join('|')
  const query = `[out:json][timeout:120];way["waterway"="river"]["name"~"^(${names})$"](${south},${west},${north},${east});out tags geom;`
  const buf = await cached(`rivers-${west.toFixed(2)}-${south.toFixed(2)}-${east.toFixed(2)}-${north.toFixed(2)}.json`, () =>
    retry(async (attempt) => {
      const res = await fetch(OVERPASS[attempt % OVERPASS.length], {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      })
      const text = await res.text()
      if (!res.ok || !text.startsWith('{')) throw new Error(`overpass: ${res.status} ${text.slice(0, 200)}`)
      return Buffer.from(text)
    }),
  )
  return JSON.parse(buf.toString()).elements
}

type Pt = [number, number]

/** Chain OSM ways that share endpoints into as few polylines as possible. */
function chain(ways: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`
  const lines = ways.map((w) => [...w])
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < lines.length && !merged; i++) {
      for (let j = 0; j < lines.length && !merged; j++) {
        if (i === j) continue
        const a = lines[i]
        const b = lines[j]
        let joined: Pt[] | null = null
        if (key(a[a.length - 1]) === key(b[0])) joined = [...a, ...b.slice(1)]
        else if (key(a[a.length - 1]) === key(b[b.length - 1])) joined = [...a, ...b.slice(0, -1).reverse()]
        else if (key(a[0]) === key(b[b.length - 1])) joined = [...b, ...a.slice(1)]
        else if (key(a[0]) === key(b[0])) joined = [...b.slice(1).reverse(), ...a]
        if (joined) {
          lines[i] = joined
          lines.splice(j, 1)
          merged = true
        }
      }
    }
  }
  return lines
}

/** Project to km, keep only the parts inside the Mapa, and thin to ~150 m spacing. */
function toMap(line: Pt[]): Pt[][] {
  const out: Pt[][] = []
  let cur: Pt[] = []
  for (const ll of line) {
    const [x, z] = project(ll)
    const inside = x >= MAP.minX && x <= MAP.maxX && z >= MAP.minZ && z <= MAP.maxZ
    if (!inside) {
      if (cur.length > 1) out.push(cur)
      cur = []
      continue
    }
    const last = cur[cur.length - 1]
    if (!last || Math.hypot(x - last[0], z - last[1]) >= 0.15) cur.push([+x.toFixed(3), +z.toFixed(3)])
  }
  if (cur.length > 1) out.push(cur)
  return out
}

function riverDistance(lines: Pt[][]) {
  const dist = new Float32Array(nx * nz).fill(RIVER_MAX)
  for (const line of lines) {
    for (let k = 0; k < line.length - 1; k++) {
      const [ax, az] = line[k]
      const [bx, bz] = line[k + 1]
      const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - RIVER_MAX - MAP.minX) / STEP))
      const ix1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + RIVER_MAX - MAP.minX) / STEP))
      const iz0 = Math.max(0, Math.floor((Math.min(az, bz) - RIVER_MAX - MAP.minZ) / STEP))
      const iz1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + RIVER_MAX - MAP.minZ) / STEP))
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz || 1
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = MAP.minZ + iz * STEP
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = MAP.minX + ix * STEP
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
          const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz))
          const i = iz * nx + ix
          if (d < dist[i]) dist[i] = d
        }
      }
    }
  }
  return dist
}

await mkdir(CACHE, { recursive: true })
await mkdir(OUT, { recursive: true })

const sample = await loadMosaic()
console.log(`resampling to ${nx}×${nz} at ${STEP} km`)
const elev = resample(sample)
const lake = lakeMask(elev)

const ways = await loadWays()
const rivers = RIVERS.map((r) => {
  const own = ways.filter((w) => r.osm.includes(w.tags.name)).map((w) => w.geometry.map((g): Pt => [g.lon, g.lat]))
  const lines = chain(own).flatMap(toMap)
  if (!lines.length) throw new Error(`river ${r.name}: no geometry inside the Mapa`)
  return { name: r.name, kind: r.kind, lines }
})
const dist = riverDistance(rivers.flatMap((r) => r.lines))

// Elevation in decimetres so 1 m steps never show up as terraces on the plains.
const dm = new Uint16Array(nx * nz)
for (let i = 0; i < dm.length; i++) dm[i] = Math.max(0, Math.min(65535, Math.round(elev[i] * 10)))
// Masks interleaved per cell: river distance in 25 m units, lake 0/255.
const masks = new Uint8Array(nx * nz * 2)
for (let i = 0; i < nx * nz; i++) {
  masks[i * 2] = Math.round((Math.min(dist[i], RIVER_MAX) / RIVER_MAX) * 240)
  masks[i * 2 + 1] = lake[i] * 255
}

await writeFile(`${OUT}/elevation.bin`, dm)
await writeFile(`${OUT}/masks.bin`, masks)
await writeFile(
  `${OUT}/terrain.json`,
  JSON.stringify({ nx, nz, step: STEP, minX: MAP.minX, minZ: MAP.minZ, base: BASE, riverMax: RIVER_MAX, rivers }),
)

let lo = Infinity
let hi = -Infinity
for (const e of elev) {
  lo = Math.min(lo, e)
  hi = Math.max(hi, e)
}
const lakeCells = lake.reduce((s, v) => s + v, 0)
console.log(`elevation ${lo.toFixed(0)}–${hi.toFixed(0)} m, Cota base ${BASE} m, lake ${((lakeCells / lake.length) * 100).toFixed(1)}% of the Mapa`)
for (const r of rivers) console.log(`  ${r.name}: ${r.lines.length} line(s), ${r.lines.reduce((s, l) => s + l.length, 0)} points`)
