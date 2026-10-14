// Bakes the mean rain of each month over the Mapa into public/terrain/lluvia.bin, for the
// Chubascos to follow.
//
//   pnpm bake:lluvia
//
// Rain: CHPclim v2, the Climate Hazards Group's monthly precipitation climatology (0.05°, from
// satellite and gauges), read as windows straight from its GeoTIFFs. Cached in .cache/lluvia.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fromUrl } from 'geotiff'
import { MAP, unproject } from '../src/geo.ts'

/** Rain changes over tens of km, and CHPclim's cells are ~5.5 km: finer would only interpolate. */
const STEP = 5
const CACHE = '.cache/lluvia'
const OUT = 'public/terrain'
const CHPCLIM = (month: number) => `https://data.chc.ucsb.edu/products/CHPclim/v2/monthly_9090/CHPclim2.90-90.${String(month).padStart(2, '0')}.tif`
const DEG = 0.05

const nx = Math.ceil((MAP.maxX - MAP.minX) / STEP) + 1
const nz = Math.ceil((MAP.maxZ - MAP.minZ) / STEP) + 1

/** The CHPclim pixels covering the Mapa, with a pixel to spare for interpolating at its edge. */
function window() {
  const [west, north] = unproject(MAP.minX, MAP.minZ)
  const [east, south] = unproject(MAP.maxX, MAP.maxZ)
  return [Math.floor((west + 180) / DEG) - 1, Math.floor((90 - north) / DEG) - 1, Math.ceil((east + 180) / DEG) + 2, Math.ceil((90 - south) / DEG) + 2]
}

async function monthGrid(month: number, [x0, y0, x1, y1]: number[]) {
  const path = `${CACHE}/chpclim2-${month}-${x0}-${y0}-${x1}-${y1}.bin`
  if (existsSync(path)) {
    const bytes = await readFile(path)
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
  }
  const image = await (await fromUrl(CHPCLIM(month))).getImage()
  if (image.getSampleFormat() !== 3 || image.getBitsPerSample() !== 32) throw new Error(`CHPclim month ${month} is not float32`)
  const [band] = (await image.readRasters({ window: [x0, y0, x1, y1] })) as Float32Array[]
  await writeFile(path, Buffer.from(band.buffer))
  return band
}

await mkdir(CACHE, { recursive: true })
const win = window()
const width = win[2] - win[0]
const out = new Uint16Array(nx * nz * 12)
for (let m = 0; m < 12; m++) {
  const band = await monthGrid(m + 1, win)
  const at = (px: number, py: number) => Math.max(0, band[py * width + px])
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const [lon, lat] = unproject(MAP.minX + ix * STEP, MAP.minZ + iz * STEP)
      // Pixel centres sit half a pixel in from their corners.
      const fx = (lon + 180) / DEG - 0.5 - win[0]
      const fy = (90 - lat) / DEG - 0.5 - win[1]
      const px = Math.floor(fx)
      const py = Math.floor(fy)
      const tx = fx - px
      const ty = fy - py
      const mm = (at(px, py) * (1 - tx) + at(px + 1, py) * tx) * (1 - ty) + (at(px, py + 1) * (1 - tx) + at(px + 1, py + 1) * tx) * ty
      out[(iz * nx + ix) * 12 + m] = Math.round(mm * 10)
    }
  console.log(`lluvia: month ${m + 1}`)
}

await writeFile(`${OUT}/lluvia.bin`, Buffer.from(out.buffer))
await writeFile(`${OUT}/lluvia.json`, JSON.stringify({ nx, nz, step: STEP, minX: MAP.minX, minZ: MAP.minZ }))
const mean = (m: number) => out.filter((_, i) => i % 12 === m).reduce((a, b) => a + b, 0) / (nx * nz) / 10
console.log(`lluvia: ${nx}×${nz} cells, mean mm by month ${Array.from({ length: 12 }, (_, m) => mean(m).toFixed(0)).join(' ')}`)
