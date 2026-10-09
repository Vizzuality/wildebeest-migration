import { bakeNormals, bakeRelief, fineHeights } from './relief'

export interface ReliefJob {
  heights: Float32Array
  nx: number
  nz: number
  step: number
  sun: [number, number, number]
  detail: Int8Array
  scale: number
  rise: number
}

self.onmessage = (e: MessageEvent<ReliefJob>) => {
  const { heights, nx, nz, step, sun, detail, scale, rise } = e.data
  // Both bake from the fine ground, so shadows are as sharp as the shading beside them.
  const { fine, dnx, dnz } = fineHeights(heights, nx, nz, detail, scale, rise)
  const relief = bakeRelief(fine, dnx, dnz, step / scale, sun, scale)
  const normals = bakeNormals(fine, dnx, dnz, step / scale)
  self.postMessage({ relief, normals }, { transfer: [relief.buffer, normals.buffer] })
}
