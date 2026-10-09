import { bakeNormals, bakeRelief } from './relief'

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
  const relief = bakeRelief(heights, nx, nz, step, sun)
  const normals = bakeNormals(heights, nx, nz, step, detail, scale, rise)
  self.postMessage({ relief, normals }, { transfer: [relief.buffer, normals.buffer] })
}
