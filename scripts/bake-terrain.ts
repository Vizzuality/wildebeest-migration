// Bakes the real relief and rivers of the Mapa into static assets under public/terrain/.
//
//   pnpm bake:terrain
//
// Elevation: AWS Terrain Tiles (Terrarium encoding), averaged onto the grid.
// Rivers: OpenStreetMap waterways, via the Overpass API.
// Cobertura: ESA WorldCover 10 m (2021), read as windows straight from its public COGs.
// Verdor: MODIS MOD13Q1/MYD13Q1 NDVI (250 m), averaged per calendar month over several years.
// Quemas: MODIS MCD64A1 burned area (500 m). Both from Microsoft Planetary Computer.
// Downloads are cached in .cache/terrain so re-runs are offline.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fromUrl } from 'geotiff'
import { PNG } from 'pngjs'
import { KM_PER_DEG, LON0, MAP, project, unproject } from '../src/geo.ts'

const STEP = 0.3
/** Detail cells per grid cell each way: the z11 tiles hold ~75 m, finer than the 300 m grid. */
const DETAIL = 2
/** Detail is stored as metres off the grid's own surface, in these steps (m). */
const DETAIL_UNIT = 0.5
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

// WorldCover tiles are 3°×3°, named by their south-west corner. Overview 1 is ~20 m/px:
// ~225 samples per 300 m cell, plenty for fractions, at a quarter of the download.
const WORLDCOVER = (tile: string) =>
  `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`
const WORLDCOVER_TILES = ['S03E033', 'S06E033']
const WORLDCOVER_LEVEL = 1
/** Channels of cover.bin. Grassland, cropland and anything unlisted count as hierba. */
const COVER: Record<number, number> = { 10: 0, 20: 1, 90: 2, 95: 2, 50: 3, 60: 3 }
const WATER = 80

const PC = 'https://planetarycomputer.microsoft.com/api'
/** Years averaged into the Verdor and scanned for Quemas. */
const YEARS = [2019, 2024]
/** A cell gets a Quema in its usual month if it burned in at least this many of those years. */
const BURN_YEARS = 3
const MODIS_R = 6371007.181

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

/**
 * What the grid misses: elevation at DETAIL× the resolution, minus the grid's bilinear surface
 * there, in DETAIL_UNIT steps. The client adds it back only to shade, so the mesh stays light.
 */
function resampleDetail(sample: (lon: number, lat: number) => number, coarse: (ix: number, iz: number) => number) {
  const dnx = (nx - 1) * DETAIL + 1
  const dnz = (nz - 1) * DETAIL + 1
  const out = new Int8Array(dnx * dnz)
  const taps = 2
  const step = STEP / DETAIL
  for (let jz = 0; jz < dnz; jz++) {
    for (let jx = 0; jx < dnx; jx++) {
      let sum = 0
      for (let a = 0; a < taps; a++) {
        for (let b = 0; b < taps; b++) {
          const x = MAP.minX + (jx + (a + 0.5) / taps - 0.5) * step
          const z = MAP.minZ + (jz + (b + 0.5) / taps - 0.5) * step
          sum += sample(...unproject(x, z))
        }
      }
      const fx = jx / DETAIL
      const fz = jz / DETAIL
      const ix = Math.min(nx - 2, Math.floor(fx))
      const iz = Math.min(nz - 2, Math.floor(fz))
      const tx = fx - ix
      const tz = fz - iz
      const base =
        (coarse(ix, iz) * (1 - tx) + coarse(ix + 1, iz) * tx) * (1 - tz) + (coarse(ix, iz + 1) * (1 - tx) + coarse(ix + 1, iz + 1) * tx) * tz
      out[jz * dnx + jx] = Math.max(-127, Math.min(127, Math.round((sum / (taps * taps) - base) / DETAIL_UNIT)))
    }
  }
  return out
}

/**
 * Cobertura per cell: share of árbol, matorral, humedal and suelo desnudo among the
 * WorldCover pixels whose centre falls in the cell (open water left out). Hierba is the rest.
 */
async function loadCover() {
  const [west, north] = unproject(MAP.minX - STEP, MAP.minZ - STEP)
  const [east, south] = unproject(MAP.maxX + STEP, MAP.maxZ + STEP)
  const counts = new Uint16Array(nx * nz * 5)
  for (const tile of WORLDCOVER_TILES) {
    const tiff = await fromUrl(WORLDCOVER(tile))
    const full = await tiff.getImage(0)
    const image = await tiff.getImage(WORLDCOVER_LEVEL)
    const [tw, , te, tn] = full.getBoundingBox()
    const res = (te - tw) / image.getWidth()
    const x0 = Math.max(0, Math.floor((west - tw) / res))
    const x1 = Math.min(image.getWidth(), Math.ceil((east - tw) / res))
    const y0 = Math.max(0, Math.floor((tn - north) / res))
    const y1 = Math.min(image.getHeight(), Math.ceil((tn - south) / res))
    if (x0 >= x1 || y0 >= y1) continue
    console.log(`cobertura: ${tile}, ${x1 - x0}×${y1 - y0} px at ~${Math.round(res * 111_000)} m`)
    const rows = image.getTileHeight()
    for (let y = y0; y < y1; y += rows) {
      const h = Math.min(rows, y1 - y)
      const [band] = (await retry(() => image.readRasters({ window: [x0, y, x1, y + h] }))) as unknown as Uint8Array[]
      const w = x1 - x0
      for (let r = 0; r < h; r++) {
        const lat = tn - (y + r + 0.5) * res
        const iz = Math.round((project([LON0, lat])[1] - MAP.minZ) / STEP)
        if (iz < 0 || iz >= nz) continue
        for (let c = 0; c < w; c++) {
          const ix = Math.round(((tw + (x0 + c + 0.5) * res - LON0) * KM_PER_DEG - MAP.minX) / STEP)
          if (ix < 0 || ix >= nx) continue
          const cls = band[r * w + c]
          if (cls === WATER || cls === 0) continue
          const i = (iz * nx + ix) * 5
          counts[i + 4]++
          const ch = COVER[cls]
          if (ch !== undefined) counts[i + ch]++
        }
      }
      process.stdout.write(`  ${Math.round(((y + h - y0) / (y1 - y0)) * 100)}%\r`)
    }
    console.log()
  }
  const cover = new Uint8Array(nx * nz * 4)
  for (let i = 0; i < nx * nz; i++) {
    const total = counts[i * 5 + 4]
    if (!total) continue
    for (let ch = 0; ch < 4; ch++) cover[i * 4 + ch] = Math.round((counts[i * 5 + ch] / total) * 255)
  }
  return Buffer.from(cover.buffer)
}

async function pcToken() {
  const res = await fetch(`${PC}/sas/v1/token/modiseuwest/modis-061-cogs`)
  if (!res.ok) throw new Error(`planetary computer token: ${res.status}`)
  return ((await res.json()) as { token: string }).token
}

interface StacItem {
  id: string
  properties: { start_datetime: string }
  assets: Record<string, { href: string }>
}

async function stacItems(collection: string): Promise<StacItem[]> {
  const [west, north] = unproject(MAP.minX, MAP.minZ)
  const [east, south] = unproject(MAP.maxX, MAP.maxZ)
  const buf = await cached(`stac-${collection}-${YEARS.join('-')}.json`, async () => {
    const items: StacItem[] = []
    let body: object | null = {
      collections: [collection],
      bbox: [west, south, east, north],
      datetime: `${YEARS[0]}-01-01T00:00:00Z/${YEARS[1]}-12-31T23:59:59Z`,
      limit: 250,
    }
    while (body) {
      const res = await retry(() => fetch(`${PC}/stac/v1/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      const page = (await res.json()) as { features: StacItem[]; links: { rel: string; body?: object }[] }
      items.push(...page.features)
      body = page.links.find((l) => l.rel === 'next')?.body ?? null
    }
    return Buffer.from(JSON.stringify(items))
  })
  return JSON.parse(buf.toString())
}

/**
 * For each grid cell, the index of its nearest pixel in a MODIS sinusoidal raster window, so
 * every date of the same tile and resolution is sampled without reprojecting again.
 */
async function modisLookup(href: string) {
  const image = await (await fromUrl(href)).getImage()
  const [ox, oy] = image.getOrigin()
  const [rx, ry] = image.getResolution()
  const col = new Float64Array(nx * nz)
  const row = new Float64Array(nx * nz)
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const [lon, lat] = unproject(MAP.minX + ix * STEP, MAP.minZ + iz * STEP)
      const phi = (lat * Math.PI) / 180
      const x = MODIS_R * ((lon * Math.PI) / 180) * Math.cos(phi)
      const y = MODIS_R * phi
      col[iz * nx + ix] = Math.floor((x - ox) / rx)
      row[iz * nx + ix] = Math.floor((y - oy) / ry)
    }
  }
  let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity
  for (let i = 0; i < col.length; i++) {
    c0 = Math.min(c0, col[i]); c1 = Math.max(c1, col[i])
    r0 = Math.min(r0, row[i]); r1 = Math.max(r1, row[i])
  }
  const w = c1 - c0 + 1
  const index = new Uint32Array(nx * nz)
  for (let i = 0; i < index.length; i++) index[i] = (row[i] - r0) * w + (col[i] - c0)
  return { window: [c0, r0, c1 + 1, r1 + 1], index }
}

async function readBand(href: string, window: number[]) {
  const image = await (await fromUrl(href)).getImage()
  const [band] = (await image.readRasters({ window })) as unknown as Int16Array[]
  return band
}

async function pool<T>(items: T[], size: number, work: (item: T, i: number) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++
      await work(items[i], i)
    }
  }))
}

/**
 * Verdor: mean NDVI per cell and calendar month over YEARS, from 16-day composites (Terra and
 * Aqua, 8 days apart) keeping only good or marginal pixels. Months that clouds left without a
 * single good pixel take the neighbouring months' values. Stored 0–250 for NDVI 0–1.
 */
async function loadVerdor() {
  const items = await stacItems('modis-13Q1-061')
  let token = await pcToken()
  const sign = (href: string) => `${href}?${token}`
  const { window, index } = await modisLookup(sign(items[0].assets['250m_16_days_NDVI'].href))
  console.log(`verdor: ${items.length} composites, window ${window[2] - window[0]}×${window[3] - window[1]} px`)
  const sum = new Float32Array(nx * nz * 12)
  const count = new Uint16Array(nx * nz * 12)
  let done = 0
  await pool(items, 8, async (item) => {
    const grid = await cached(`ndvi-${item.id}-${STEP}.bin`, () =>
      retry(async (attempt) => {
        if (attempt > 0) token = await pcToken()
        const [ndvi, rel] = await Promise.all([
          readBand(sign(item.assets['250m_16_days_NDVI'].href), window),
          readBand(sign(item.assets['250m_16_days_pixel_reliability'].href), window),
        ])
        const out = new Uint8Array(nx * nz).fill(255)
        for (let i = 0; i < out.length; i++) {
          const k = index[i]
          if (rel[k] === 0 || rel[k] === 1) out[i] = Math.round(Math.min(1, Math.max(0, ndvi[k] / 10000)) * 250)
        }
        return Buffer.from(out.buffer)
      }),
    )
    const mid = new Date(Date.parse(item.properties.start_datetime) + 8 * 86_400_000)
    const m = mid.getUTCMonth()
    for (let i = 0; i < nx * nz; i++) {
      if (grid[i] === 255) continue
      sum[i * 12 + m] += grid[i]
      count[i * 12 + m]++
    }
    if (++done % 20 === 0) console.log(`  ${done}/${items.length}`)
  })
  const out = new Uint8Array(nx * nz * 12)
  const month = new Float32Array(12)
  for (let i = 0; i < nx * nz; i++) {
    for (let m = 0; m < 12; m++) month[m] = count[i * 12 + m] ? sum[i * 12 + m] / count[i * 12 + m] : -1
    for (let m = 0; m < 12; m++) {
      let v = month[m]
      for (let d = 1; v < 0 && d < 6; d++) {
        const a = month[(m + 12 - d) % 12]
        const b = month[(m + d) % 12]
        v = a >= 0 && b >= 0 ? (a + b) / 2 : Math.max(a, b)
      }
      out[i * 12 + m] = Math.round(Math.max(0, v))
    }
  }
  return Buffer.from(out.buffer)
}

/**
 * Quemas: for each cell, the calendar month it usually burns (1–12), if it burned in at least
 * BURN_YEARS of YEARS; 0 otherwise.
 */
async function loadQuemas() {
  const items = await stacItems('modis-64A1-061')
  const token = await pcToken()
  const sign = (href: string) => `${href}?${token}`
  const { window, index } = await modisLookup(sign(items[0].assets.Burn_Date.href))
  console.log(`quemas: ${items.length} months`)
  const counts = new Uint8Array(nx * nz * 12)
  await pool(items, 8, async (item) => {
    const burn = await retry(() => readBand(sign(item.assets.Burn_Date.href), window))
    const m = new Date(item.properties.start_datetime).getUTCMonth()
    for (let i = 0; i < nx * nz; i++) if (burn[index[i]] > 0) counts[i * 12 + m]++
  })
  const out = new Uint8Array(nx * nz)
  for (let i = 0; i < nx * nz; i++) {
    let total = 0
    let best = 0
    for (let m = 0; m < 12; m++) {
      total += counts[i * 12 + m]
      if (counts[i * 12 + m] > counts[i * 12 + best]) best = m
    }
    if (total >= BURN_YEARS) out[i] = best + 1
  }
  return Buffer.from(out.buffer)
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
const verdor = await cached(`verdor-${YEARS.join('-')}-${STEP}-${MAP.minX}-${MAP.minZ}-${MAP.maxX}-${MAP.maxZ}.bin`, loadVerdor)
const quemas = await cached(`quemas-${YEARS.join('-')}-${BURN_YEARS}-${STEP}-${MAP.minX}-${MAP.minZ}-${MAP.maxX}-${MAP.maxZ}.bin`, loadQuemas)
const cover = await cached(`worldcover-${WORLDCOVER_LEVEL}-${STEP}-${MAP.minX}-${MAP.minZ}-${MAP.maxX}-${MAP.maxZ}.bin`, loadCover)

// Elevation in decimetres so 1 m steps never show up as terraces on the plains.
const dm = new Uint16Array(nx * nz)
for (let i = 0; i < dm.length; i++) dm[i] = Math.max(0, Math.min(65535, Math.round(elev[i] * 10)))
// Masks interleaved per cell: river distance in 25 m units, lake 0/255.
const masks = new Uint8Array(nx * nz * 2)
for (let i = 0; i < nx * nz; i++) {
  masks[i * 2] = Math.round((Math.min(dist[i], RIVER_MAX) / RIVER_MAX) * 240)
  masks[i * 2 + 1] = lake[i] * 255
}

console.log(`detail at ${STEP / DETAIL} km`)
const detail = resampleDetail(sample, (ix, iz) => dm[iz * nx + ix] / 10)

await writeFile(`${OUT}/elevation.bin`, dm)
await writeFile(`${OUT}/detail.bin`, detail)
await writeFile(`${OUT}/masks.bin`, masks)
await writeFile(`${OUT}/cover.bin`, cover)
await writeFile(`${OUT}/verdor.bin`, verdor)
await writeFile(`${OUT}/quemas.bin`, quemas)
await writeFile(
  `${OUT}/terrain.json`,
  JSON.stringify({ nx, nz, step: STEP, detail: DETAIL, detailUnit: DETAIL_UNIT, minX: MAP.minX, minZ: MAP.minZ, base: BASE, riverMax: RIVER_MAX, rivers }),
)

let lo = Infinity
let hi = -Infinity
for (const e of elev) {
  lo = Math.min(lo, e)
  hi = Math.max(hi, e)
}
let clipped = 0
for (const d of detail) if (Math.abs(d) === 127) clipped++
console.log(`detail: ${((clipped / detail.length) * 100).toFixed(2)}% clipped at ±${127 * DETAIL_UNIT} m`)
const lakeCells = lake.reduce((s, v) => s + v, 0)
console.log(`elevation ${lo.toFixed(0)}–${hi.toFixed(0)} m, Cota base ${BASE} m, lake ${((lakeCells / lake.length) * 100).toFixed(1)}% of the Mapa`)
const share = [0, 0, 0, 0]
for (let i = 0; i < cover.length; i++) share[i % 4] += cover[i] / 255 / (nx * nz)
console.log(`cobertura: árbol ${(share[0] * 100).toFixed(1)}%, matorral ${(share[1] * 100).toFixed(1)}%, humedal ${(share[2] * 100).toFixed(1)}%, desnudo ${(share[3] * 100).toFixed(1)}%`)
const burnt = quemas.reduce((n, v) => n + (v ? 1 : 0), 0)
console.log(`quemas: ${((burnt / (nx * nz)) * 100).toFixed(1)}% of the Mapa burns most years`)
for (const r of rivers) console.log(`  ${r.name}: ${r.lines.length} line(s), ${r.lines.reduce((s, l) => s + l.length, 0)} points`)
