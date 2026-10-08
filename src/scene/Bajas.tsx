import { useMemo } from 'react'
import * as THREE from 'three'
import { mulberry32 } from '../terrain'
import type { OnMancha } from './Partos'
import { Senales } from './Senales'

// The Bajas told with Señales: reddish embers that close in and go out. Most fall on the water of
// the Mara at Kogatende as the Manada crosses it in Avalancha, on the way north and back; a few
// more fall one by one wherever the Manada is through the year.

/** Where the way crosses the Mara, the river's heading there, and when each part of the Manada crosses. */
export interface Avalancha {
  x: number
  z: number
  tx: number
  tz: number
  caudal: number
  when: (rnd: () => number) => number
}

/** Señales over both Avalanchas of the Mara, shared out by the Caudal of each, and loose ones over the year. */
const MARA_SIGNS = 70
const LOOSE_SIGNS = 10
/** How far up and down the river from the way they scatter, and across it (km, one sigma). */
const ALONG_KM = 1.2
const ACROSS_KM = 0.15
const LIFE_MONTHS = 0.3
const SIZE_MIN = 0.5
const SIZE_MAX = 1
const COLOR = new THREE.Color(0.6, 0.12, 0.05)

// A ring that closes in on an ember, both fading out.
const LOOK = /* glsl */ `
  float r = mix(0.9, 0.12, 1.0 - pow(1.0 - t, 2.0));
  float ring = smoothstep(0.06, 0.0, abs(d - r)) * (1.0 - t) * 0.8;
  float ember = exp(-d * d * 30.0) * smoothstep(0.0, 0.08, t) * pow(1.0 - t, 1.4);
  a = ring + ember;
`

function deaths(avalanchas: Avalancha[], onMancha: OnMancha) {
  const rnd = mulberry32(31)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-6))) * Math.cos(2 * Math.PI * rnd())
  const signs: number[] = []
  const flow = avalanchas.reduce((sum, a) => sum + a.caudal, 0)
  for (const a of avalanchas) {
    const count = Math.round((MARA_SIGNS * a.caudal) / flow)
    for (let k = 0; k < count; k++) {
      const along = THREE.MathUtils.clamp(gauss(), -2, 2) * ALONG_KM
      const across = gauss() * ACROSS_KM
      const x = a.x + a.tx * along - a.tz * across
      const z = a.z + a.tz * along + a.tx * across
      signs.push(x, z, a.when(rnd), SIZE_MIN + rnd() * (SIZE_MAX - SIZE_MIN))
    }
  }
  for (let k = 0; k < LOOSE_SIGNS; k++) {
    const month = ((k + rnd()) / LOOSE_SIGNS) * 12
    const [x, z] = onMancha(month, rnd)
    signs.push(x, z, month, SIZE_MIN + rnd() * (SIZE_MAX - SIZE_MIN))
  }
  return new Float32Array(signs)
}

export function Bajas({ avalanchas, onMancha }: { avalanchas: Avalancha[]; onMancha: OnMancha }) {
  const signs = useMemo(() => deaths(avalanchas, onMancha), [avalanchas, onMancha])
  return <Senales signs={signs} color={COLOR} life={LIFE_MONTHS} look={LOOK} />
}
