import { bakeRelief } from './relief'

self.onmessage = (e: MessageEvent<{ heights: Float32Array; nx: number; nz: number; step: number; sun: [number, number, number] }>) => {
  const { heights, nx, nz, step, sun } = e.data
  const data = bakeRelief(heights, nx, nz, step, sun)
  self.postMessage(data, { transfer: [data.buffer] })
}
