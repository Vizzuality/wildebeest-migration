import { createNoise2D } from 'simplex-noise'
import { MAP, RIVERS, project } from './geo'

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

const noise = createNoise2D(mulberry32(7))

function fbm(x: number, z: number, octaves = 4) {
  let sum = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, z * f)
    f *= 2.03
    amp *= 0.5
  }
  return sum
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function gauss(x: number, z: number, cx: number, cz: number, r: number) {
  const d2 = (x - cx) ** 2 + (z - cz) ** 2
  return Math.exp(-d2 / (r * r))
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax
  const dz = bz - az
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

/** Smooth a polyline with Catmull-Rom so rivers meander instead of zig-zagging. */
export function smoothLine(points: [number, number][], steps = 8): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    for (let s = 0; s < steps; s++) {
      const f = s / steps
      const c = (a: number, b: number, c2: number, d: number) =>
        0.5 * (2 * b + (-a + c2) * f + (2 * a - 5 * b + 4 * c2 - d) * f * f + (-a + 3 * b - 3 * c2 + d) * f * f * f)
      // Small sideways wiggle for meanders.
      const wx = noise(p1[0] * 0.3 + s, p1[1] * 0.3) * 0.6
      const wz = noise(p1[1] * 0.3, p1[0] * 0.3 + s) * 0.6
      out.push([c(p0[0], p1[0], p2[0], p3[0]) + wx, c(p0[1], p1[1], p2[1], p3[1]) + wz])
    }
  }
  out.push(points[points.length - 1])
  return out
}

export const RIVER_LINES = RIVERS.map((r) => ({ name: r.name, points: smoothLine(r.points.map(project)) }))

const NGORO = project([35.58, -3.18])
const OLMOTI = project([35.45, -3.0])
const GOL = project([35.42, -2.72])
const LOBO = project([35.3, -1.95])
const CORRIDOR = project([34.45, -2.28])

export function lakeShore(z: number) {
  // Eastern shore of Lake Victoria, with Speke Gulf pushing east around z ≈ 0.
  return -96 + 4 * noise(z * 0.05, 3.3) + 18 * gauss(0, z, 0, -4, 16)
}

// Kopjes: granite outcrops scattered over the central and southern plains.
const KOPJES = (() => {
  const rnd = mulberry32(42)
  const out: [number, number, number][] = []
  for (let i = 0; i < 70; i++) {
    out.push([-35 + rnd() * 95, -15 + rnd() * 95, 0.8 + rnd() * 1.2])
  }
  return out
})()

export interface Heightfield {
  nx: number
  nz: number
  step: number
  heights: Float32Array
  /** Per vertex: woodland density, distance to nearest river, lake (0/1). */
  masks: Float32Array
}

export function woodland(x: number, z: number) {
  const southPlains = smoothstep(-5, 35, z) * smoothstep(-55, -25, x) * (1 - smoothstep(55, 70, x))
  const patches = smoothstep(-0.25, 0.45, fbm(x * 0.03 + 11, z * 0.03 - 4, 3))
  return Math.max(0, (1 - southPlains) * patches)
}

export function buildHeightfield(step = 0.5): Heightfield {
  const nx = Math.round((MAP.maxX - MAP.minX) / step) + 1
  const nz = Math.round((MAP.maxZ - MAP.minZ) / step) + 1
  const heights = new Float32Array(nx * nz)
  const masks = new Float32Array(nx * nz * 3)

  for (let iz = 0; iz < nz; iz++) {
    const z = MAP.minZ + iz * step
    for (let ix = 0; ix < nx; ix++) {
      const x = MAP.minX + ix * step
      const i = iz * nx + ix

      const plains = smoothstep(0, 40, z) * smoothstep(-50, -20, x) * (1 - smoothstep(50, 65, x))
      let h = 0.8 + fbm(x * 0.012, z * 0.012) * 2.4 + fbm(x * 0.06, z * 0.06, 3) * 0.7 * (1 - 0.75 * plains)

      // Ngorongoro highlands with the crater and its rim.
      const dN = Math.hypot(x - NGORO[0], z - NGORO[1])
      h += 11 * gauss(x, z, NGORO[0], NGORO[1], 34) + 3 * fbm(x * 0.05, z * 0.05) * gauss(x, z, NGORO[0], NGORO[1], 40)
      h += 3.5 * Math.exp(-((dN - 9.5) ** 2) / 6)
      h -= 7.5 * smoothstep(9.5, 5, dN)
      h += 5 * gauss(x, z, OLMOTI[0], OLMOTI[1], 9)
      // Gol mountains, Lobo hills, western corridor ridges.
      h += 3.2 * gauss(x, z, GOL[0], GOL[1], 14) * (0.6 + 0.6 * Math.abs(fbm(x * 0.08, z * 0.08)))
      h += 4.5 * gauss(x, z, LOBO[0], LOBO[1], 22) * (0.5 + Math.abs(fbm(x * 0.07 + 5, z * 0.07)))
      h += 2.6 * gauss(x, z, CORRIDOR[0], CORRIDOR[1], 20) * Math.abs(fbm(x * 0.09, z * 0.09 + 9)) * 2
      // Oloololo escarpment along the western edge of the Mara.
      const escD = segDist(x, z, ...project([34.83, -1.52]), ...project([35.08, -1.12]))
      const escSide = x - (project([34.83, -1.52])[0] + (z - project([34.83, -1.52])[1]) * -0.6)
      h += 3.5 * smoothstep(6, 0, escD) * smoothstep(2, -4, escSide)

      // Kopjes.
      for (const [kx, kz, kh] of KOPJES) {
        const d2 = (x - kx) ** 2 + (z - kz) ** 2
        if (d2 < 9) h += kh * Math.exp(-d2 / 1.1) * (0.7 + 0.3 * noise(x * 2, z * 2))
      }

      // Rivers carve their channels.
      let riverDist = 99
      for (const r of RIVER_LINES) {
        const p = r.points
        for (let k = 0; k < p.length - 1; k++) {
          if (Math.abs(x - p[k][0]) > riverDist + 4 || Math.abs(z - p[k][1]) > riverDist + 4) continue
          const d = segDist(x, z, p[k][0], p[k][1], p[k + 1][0], p[k + 1][1])
          if (d < riverDist) riverDist = d
        }
      }
      h -= 1.4 * (1 - smoothstep(0.3, 2.2, riverDist))

      // Lake Victoria.
      const shore = lakeShore(z)
      const lake = smoothstep(shore + 1.5, shore - 1.5, x)
      h = h * (1 - lake) + -0.9 * lake

      heights[i] = h
      masks[i * 3] = woodland(x, z) + 0.8 * (1 - smoothstep(0.8, 3.5, riverDist))
      masks[i * 3 + 1] = riverDist
      masks[i * 3 + 2] = lake
    }
  }
  return { nx, nz, step, heights, masks }
}

export function makeSampler(hf: Heightfield) {
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

export const HF = buildHeightfield()
export const heightAt = makeSampler(HF)
export const NGORO_XZ = NGORO
