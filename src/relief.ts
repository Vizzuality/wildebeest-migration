/**
 * Per cell: how much of the sun reaches it past the Relieve (R) and how open its sky is (G).
 * The sun never moves, so both are worked out once here instead of per pixel.
 */
export function bakeRelief(heights: Float32Array, nx: number, nz: number, step: number, sunDir: [number, number, number]) {
  const [sunX, sunY, sunZ] = sunDir
  const data = new Uint8Array(nx * nz * 2)
  let top = -Infinity
  for (const h of heights) top = Math.max(top, h)
  const at = (fx: number, fz: number) => {
    const ix = Math.min(nx - 2, Math.max(0, Math.floor(fx)))
    const iz = Math.min(nz - 2, Math.max(0, Math.floor(fz)))
    const tx = Math.min(1, Math.max(0, fx - ix))
    const tz = Math.min(1, Math.max(0, fz - iz))
    const i = iz * nx + ix
    const a = heights[i] + (heights[i + 1] - heights[i]) * tx
    const b = heights[i + nx] + (heights[i + nx + 1] - heights[i + nx]) * tx
    return a + (b - a) * tz
  }

  const flat = Math.hypot(sunX, sunZ)
  const sx = sunX / flat
  const sz = sunZ / flat
  const rise = sunY / flat
  // The sun's disc is ~0.5° but haze widens it: a few degrees of penumbra keeps edges soft at 300 m.
  const PENUMBRA = 0.07

  const DIRS = 12
  const REACH = [1, 2, 4, 7, 12, 20]
  const dirs = Array.from({ length: DIRS }, (_, k) => [Math.cos((k / DIRS) * Math.PI * 2), Math.sin((k / DIRS) * Math.PI * 2)])

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix
      const h0 = heights[i]

      let sun = 1
      for (let t = 1; sun > -1; t++) {
        const ray = h0 + rise * t * step
        if (ray > top) break
        sun = Math.min(sun, (ray - at(ix + sx * t, iz + sz * t)) / (PENUMBRA * t * step))
      }

      let open = 0
      for (const [dx, dz] of dirs) {
        let slope = 0
        for (const r of REACH) slope = Math.max(slope, (at(ix + dx * r, iz + dz * r) - h0) / (r * step))
        open += 1 - slope / Math.hypot(1, slope)
      }

      data[i * 2] = Math.round(Math.min(1, Math.max(0, 0.5 + 0.5 * sun)) * 255)
      data[i * 2 + 1] = Math.round((open / DIRS) * 255)
    }
  }
  return data
}
