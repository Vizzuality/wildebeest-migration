import { useMemo } from 'react'
import * as THREE from 'three'
import { mulberry32 } from '../terrain'
import { Senales } from './Senales'

// The Partos told with Señales: small rings of light that pop over the Mancha while the calves
// are born on the Ndutu plains.

const SIGNS = 90
/**
 * The real Partos last about three weeks from late January, which at a year a minute would pass
 * in a blink. They are stretched to about a month (±2 sigma) so they read.
 */
const PEAK_MONTH = 1.3
const SIGMA_MONTHS = 0.28
/** How long each Señal lives, in months: 1.5 s at normal speed, longer than its moment. */
const LIFE_MONTHS = 0.3
/** Ring radius at its widest (km). */
const SIZE_MIN = 0.7
const SIZE_MAX = 1.4
const COLOR = new THREE.Color(0.55, 0.38, 0.12)

// The ring races out and slows; a flash marks the moment it starts.
const LOOK = /* glsl */ `
  float r = mix(0.08, 0.92, 1.0 - pow(1.0 - t, 3.0));
  float w = mix(0.1, 0.03, t);
  float ring = smoothstep(w, 0.0, abs(d - r)) * pow(1.0 - t, 1.5);
  float flash = exp(-d * d * 40.0) * (1.0 - smoothstep(0.0, 0.3, t)) * 0.7;
  a = ring + flash;
`

/** A point on the Mancha at a moment of the year, picked with the given random source. */
export type OnMancha = (month: number, rnd: () => number) => [number, number]

function births(onMancha: OnMancha) {
  const rnd = mulberry32(23)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-6))) * Math.cos(2 * Math.PI * rnd())
  const data = new Float32Array(SIGNS * 4)
  for (let k = 0; k < SIGNS; k++) {
    const month = PEAK_MONTH + THREE.MathUtils.clamp(gauss(), -2.2, 2.2) * SIGMA_MONTHS
    const [x, z] = onMancha(month, rnd)
    data.set([x, z, month, SIZE_MIN + rnd() * (SIZE_MAX - SIZE_MIN)], k * 4)
  }
  return data
}

export function Partos({ onMancha }: { onMancha: OnMancha }) {
  const signs = useMemo(() => births(onMancha), [onMancha])
  return <Senales signs={signs} color={COLOR} life={LIFE_MONTHS} look={LOOK} />
}
