import { use } from 'react'
import { MAP } from './geo'
import type { Rejilla } from './meteoros'

/** Mean rain of each month over the Mapa, from pnpm bake:lluvia. */
export interface Lluvia extends Rejilla {
  /** Twelve months per cell, in tenths of a mm. */
  mm: Uint16Array
}

async function fetchLluvia(): Promise<Lluvia> {
  const [meta, data] = await Promise.all([fetch('/terrain/lluvia.json'), fetch('/terrain/lluvia.bin')])
  if (!meta.ok) throw new Error(`/terrain/lluvia.json: ${meta.status}`)
  if (!data.ok) throw new Error(`/terrain/lluvia.bin: ${data.status}`)
  const grid = (await meta.json()) as Rejilla
  if (grid.minX !== MAP.minX || grid.minZ !== MAP.minZ) throw new Error('lluvia bake does not match MAP, run pnpm bake:lluvia')
  const mm = new Uint16Array(await data.arrayBuffer())
  if (mm.length !== grid.nx * grid.nz * 12) throw new Error('lluvia.bin does not match lluvia.json, run pnpm bake:lluvia')
  return { ...grid, mm }
}

let pending: Promise<Lluvia> | null = null

export function loadLluvia() {
  pending ??= fetchLluvia().catch((err) => {
    pending = null
    throw err
  })
  return pending
}

export function useLluvia() {
  return use(loadLluvia())
}
