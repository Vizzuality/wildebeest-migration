import { use } from 'react'
import { MAP } from './geo'

export interface FaunaBake {
  /** Where the centre of the Manada is through the year, `samplesPerMonth` points a month. */
  recorrido: [number, number][]
  samplesPerMonth: number
  /** How far the Manada spreads each month, as a covariance (xx, xz, zz in km²). */
  forma: [number, number, number][]
  /** Main rivers with their Cruces cut out: lines the Manada may not step over. */
  barriers: [number, number][][]
}

async function fetchFauna(): Promise<FaunaBake> {
  const res = await fetch('/fauna/fauna.json')
  if (!res.ok) throw new Error(`/fauna/fauna.json: ${res.status}`)
  const bake = (await res.json()) as FaunaBake & { minX: number; minZ: number }
  if (bake.minX !== MAP.minX || bake.minZ !== MAP.minZ) throw new Error('fauna bake does not match MAP, run pnpm bake:fauna')
  return bake
}

let pending: Promise<FaunaBake> | null = null

export function loadFauna() {
  pending ??= fetchFauna().catch((err) => {
    pending = null
    throw err
  })
  return pending
}

export function useFauna() {
  return use(loadFauna())
}
