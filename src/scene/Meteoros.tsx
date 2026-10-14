import { useFrame } from '@react-three/fiber'
import { Effect } from 'postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFauna } from '../fauna'
import { MAP } from '../geo'
import { useLluvia } from '../lluvia'
import { type Sitio, mensual, meteoros, quemaCerca, smoothstep } from '../meteoros'
import { NDVI_DRY, NDVI_LUSH, shared } from '../shaders/common'
import { useStore } from '../store'
import { useHeightfield } from '../terrain'
import { manadaAt, pasoAt } from './Fauna'

/** How far round the Manada a Quema's smoke reaches the viewer (km). */
const SMOKE_KM = 25
/** How fast the air moves when the viewer has asked for less motion. */
const CALM_PACE = 0.3

// Everything here sits between the eye and the Mapa: none of it is anchored to the ground, so it
// reads the screen only. Each Meteoro has a ceiling on how much it can hide, low enough that the
// Mancha always shows through the worst Chubasco or dust cloud.
const fragment = /* glsl */ `
uniform float uLluvia;
uniform float uNubes;
uniform float uPolvo;
uniform float uHumo;
uniform float uReverbero;
uniform float uTime;
uniform vec3 uDust;
uniform vec3 uSmoke;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum;
}

// One sheet of falling streaks. Cells are tall and thin; a streak sits in some of them, slanted
// by the wind, and the sheet slides down the screen.
float rainSheet(vec2 p, float scale, float speed, float density, float seed) {
  vec2 q = vec2((p.x + p.y * 0.18) * scale, p.y * scale * 0.08 + uTime * speed);
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float h = hash(cell + seed);
  if (h > density) return 0.0;
  float x = abs(f.x - 0.2 - 0.6 * hash(cell + seed + 7.3));
  float line = 1.0 - smoothstep(0.0, 0.09, x);
  float y = fract(f.y + hash(cell + seed + 3.1));
  return line * smoothstep(0.0, 0.25, y) * (1.0 - smoothstep(0.55, 0.9, y));
}

// Specks drifting on the air: dust or ash, a few per cell, wandering slowly.
float specks(vec2 p, float scale, vec2 drift, float seed) {
  vec2 q = p * scale - drift * uTime;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float h = hash(cell + seed);
  if (h > 0.35) return 0.0;
  vec2 at = vec2(hash(cell + seed + 1.7), hash(cell + seed + 4.2)) * 0.8 + 0.1;
  at += 0.08 * vec2(sin(uTime * 0.7 + h * 40.0), cos(uTime * 0.9 + h * 30.0));
  return 1.0 - smoothstep(0.0, 0.05, length(f - at));
}

// The Reverbero: hot air bends the light, so the whole picture wavers by a pixel or two.
void mainUv(inout vec2 uv) {
  if (uReverbero <= 0.0) return;
  vec2 p = uv * vec2(resolution.x / resolution.y, 1.0) * 22.0;
  float a = vnoise(p + vec2(0.0, -uTime * 2.2)) - 0.5;
  float b = vnoise(p * 1.7 + vec2(uTime * 1.3, 0.0)) - 0.5;
  uv += vec2(b * 0.5, a) * uReverbero * 0.0022;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  vec2 p = uv * vec2(resolution.x / resolution.y, 1.0);
  vec2 wind = vec2(-1.0, 0.25);

  if (uNubes > 0.0) {
    float cloud = smoothstep(0.42, 0.75, fbm(p * 1.3 - wind * uTime * 0.012));
    c *= 1.0 - cloud * uNubes * 0.38;
  }

  if (uHumo > 0.0) {
    // Comes in from the side the wind blows from and thins out across the picture.
    float reach = smoothstep(-0.3, 1.2, uv.x);
    float wisp = smoothstep(0.3, 0.8, fbm(vec2(p.x * 1.6, p.y * 3.0) - wind * uTime * 0.03));
    c = mix(c, uSmoke * (0.8 + 0.4 * wisp), uHumo * 0.32 * reach * (0.45 + 0.55 * wisp));
    float ash = specks(p, 34.0, vec2(-0.25, -0.12), 5.0);
    c = mix(c, uSmoke * 0.45, ash * uHumo * 0.5);
  }

  if (uPolvo > 0.0) {
    float cloud = fbm(p * 2.4 - wind * uTime * 0.05);
    c = mix(c, uDust * (0.75 + 0.5 * cloud), uPolvo * 0.3 * (0.5 + 0.8 * cloud));
    float mote = specks(p, 46.0, vec2(-0.35, 0.05), 1.0);
    c = mix(c, uDust * 1.3, mote * uPolvo * 0.35);
  }

  if (uLluvia > 0.0) {
    // A shower darkens and greys the light, then the streaks fall through it.
    float grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, grey * vec3(0.86, 0.93, 1.04), uLluvia * 0.4);
    c *= 1.0 - uLluvia * 0.2;
    float density = 0.25 + 0.55 * uLluvia;
    float streaks = rainSheet(p, 140.0, 3.4, density, 0.0) * 0.6
      + rainSheet(p, 90.0, 2.4, density, 11.0) * 0.8
      + rainSheet(p, 55.0, 1.6, density * 0.7, 23.0);
    c += vec3(0.62, 0.68, 0.76) * streaks * uLluvia * 0.22;
  }

  outputColor = vec4(c, inputColor.a);
}
`

const srgb = (hex: string) => new THREE.Color(hex).convertSRGBToLinear()

class MeteorosEffect extends Effect {
  constructor() {
    super('Meteoros', fragment, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uLluvia', new THREE.Uniform(0)],
        ['uNubes', new THREE.Uniform(0)],
        ['uPolvo', new THREE.Uniform(0)],
        ['uHumo', new THREE.Uniform(0)],
        ['uReverbero', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
        ['uDust', new THREE.Uniform(srgb('#c4a07a'))],
        ['uSmoke', new THREE.Uniform(srgb('#8c8681'))],
      ]),
    })
  }
}

/** Whether the viewer has asked the system for less motion, kept up to date. */
function useCalma() {
  const calma = useRef(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => (calma.current = query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return calma
}

export function Meteoros() {
  const raw = useFauna()
  const hf = useHeightfield()
  const lluvia = useLluvia()
  const calma = useCalma()
  const effect = useMemo(() => new MeteorosEffect(), [])
  useEffect(() => () => effect.dispose(), [effect])

  const ground = useMemo(() => ({ nx: hf.nx, nz: hf.nz, step: hf.step, minX: MAP.minX, minZ: MAP.minZ }), [hf])

  const time = useRef(0)
  const last = useRef(shared.uClock.value)

  useFrame(() => {
    const month = useStore.getState().month
    const at = manadaAt(raw, hf.rivers, month)
    const [x, z] = at
    const ndvi = mensual(ground, hf.verdor, x, z, month) / 250
    const sitio: Sitio = {
      lluvia: (m) => {
        const [mx, mz] = m === month ? at : manadaAt(raw, hf.rivers, m)
        return mensual(lluvia, lluvia.mm, mx, mz, m) / 10
      },
      seco: 1 - smoothstep(NDVI_DRY, NDVI_LUSH, ndvi),
      paso: pasoAt(raw, hf.rivers, month),
      quema: quemaCerca(ground, hf.quemas, x, z, month, SMOKE_KM),
    }
    const now = meteoros(month, sitio, calma.current)
    const u = effect.uniforms
    u.get('uLluvia')!.value = now.lluvia
    u.get('uNubes')!.value = now.nubes
    u.get('uPolvo')!.value = now.polvo
    u.get('uHumo')!.value = now.humo
    u.get('uReverbero')!.value = now.reverbero
    // Its own clock, so asking for less motion slows the streaks and drift, not just dims them.
    time.current += (shared.uClock.value - last.current) * (calma.current ? CALM_PACE : 1)
    last.current = shared.uClock.value
    u.get('uTime')!.value = time.current
  })

  return <primitive object={effect} dispose={null} />
}
