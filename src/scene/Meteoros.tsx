import { useFrame } from '@react-three/fiber'
import { Effect } from 'postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFauna } from '../fauna'
import { useLluvia } from '../lluvia'
import { meteoros } from '../meteoros'
import { shared } from '../shaders/common'
import { useStore } from '../store'
import { useHeightfield } from '../terrain'
import { sitioAt } from './sitio'

/** How fast the air moves when the viewer has asked for less motion. */
const CALM_PACE = 0.3
/**
 * Polvo comes and goes with the Manada's pace and every Chubasco, far quicker than the eye wants a
 * cloud to change. Its strength is eased over this long (s) before it reshapes the billows, and it
 * only shows or clears past a gap of two thresholds, fading over FADE seconds each time.
 */
const DUST_EASE = 4
const DUST_ON = 0.12
const DUST_OFF = 0.04
const DUST_FADE = 3

// Everything here sits between the eye and the Mapa: none of it is anchored to the ground, so it
// reads the screen only. Each Meteoro has a ceiling on how much it can hide, low enough that the
// Mancha always shows through the worst Chubasco or dust cloud.
const fragment = /* glsl */ `
uniform float uLluvia;
uniform float uNubes;
uniform float uPolvo;
uniform float uPolvoVisible;
uniform float uHumo;
uniform float uReverbero;
uniform float uTime;
uniform vec3 uDust;
uniform vec3 uSmoke;

// Dave Hoskins' hash: no sin(), so it holds up as the coordinates grow with the clock.
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Simplex 2D noise (Ashima / Ian McEwan, MIT): no square lattice to show through when the
// smoke and dust are cut with hard thresholds.
vec3 permute3(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// About 0–1. Each octave is turned, so their features never line up along the axes.
float fbm(vec2 p) {
  const mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * snoise(p);
    p = turn * p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return 0.5 + 0.5 * sum;
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
float specks(vec2 p, float scale, vec2 drift, float seed, float size) {
  vec2 q = p * scale - drift * uTime;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float h = hash(cell + seed);
  if (h > 0.35) return 0.0;
  // Kept clear of the cell's edge, or the speck is clipped square.
  vec2 at = vec2(hash(cell + seed + 1.7), hash(cell + seed + 4.2)) * 0.5 + 0.25;
  at += 0.06 * vec2(sin(uTime * 0.7 + h * 40.0), cos(uTime * 0.9 + h * 30.0));
  return 1.0 - smoothstep(size * 0.4, size, length(f - at));
}

// The Reverbero: hot air bends the light, so the whole picture wavers by under a pixel.
void mainUv(inout vec2 uv) {
  if (uReverbero <= 0.0) return;
  vec2 p = uv * vec2(resolution.x / resolution.y, 1.0) * 22.0;
  float a = vnoise(p + vec2(0.0, -uTime * 1.4)) - 0.5;
  float b = vnoise(p * 1.7 + vec2(uTime * 0.8, 0.0)) - 0.5;
  uv += vec2(b * 0.5, a) * uReverbero * 0.0008;
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
    // Comes in from the side the wind blows from and thins out across the picture. Cool grey
    // in soft banks, so it doesn't read as more of the warm Bruma.
    float reach = smoothstep(-0.2, 0.8, uv.x);
    vec2 sp = vec2(p.x * 2.2, p.y * 3.4) - wind * uTime * 0.08;
    float body = fbm(sp + 0.5 * vec2(fbm(sp * 0.5 + 3.7), fbm(sp * 0.5 - 1.9)));
    float bank = smoothstep(0.42, 0.78, body);
    c = mix(c, uSmoke * (0.6 + 0.3 * body), uHumo * reach * (0.06 + 0.45 * bank));
    float ash = specks(p, 22.0, vec2(-0.3, -0.12), 5.0, 0.06);
    c = mix(c, uSmoke * 0.35, ash * uHumo * 0.6);
  }

  if (uPolvoVisible > 0.0) {
    // Lit billows, paler than the dry ground beneath, or they vanish into it. How much dust there
    // is shows in their shape, not their opacity: a few loose wisps, then denser clumps. Opacity
    // only fades it in and out, and stays light so the ground reads through.
    float present = smoothstep(0.0, 1.0, uPolvoVisible);
    float cover = mix(0.66, 0.5, smoothstep(0.1, 0.8, uPolvo));
    // Nothing here travels. The clumps the dust gathers in stay put, swelling and fading slowly,
    // with clear air between them; inside them it only turns over.
    float t = uTime * 0.03;
    vec2 breathe = vec2(cos(t), sin(t * 1.3)) * 0.8;
    float clump = smoothstep(0.5, 0.72, vnoise(p * 1.4 + breathe) * 0.7 + vnoise(p * 3.3 - breathe + 9.0) * 0.3);
    // Inside each clump it turns over lazily, round and round, never going anywhere.
    float roll = uTime * 0.03;
    vec2 churn = vec2(cos(roll), sin(roll)) * 1.2 + vec2(sin(roll * 1.7), cos(roll * 2.3)) * 0.5;
    // Lying low in flat sheets over the ground. Rising columns read as flames over the Quemas.
    vec2 dp = vec2(p.x * 2.2, p.y * 4.6);
    vec2 warp = vec2(fbm(dp * 0.6 + 5.2 + churn), fbm(dp * 0.6 - 2.4 - churn.yx));
    float cloud = fbm(dp + 0.7 * warp);
    // Soft wisps at the edges.
    float wisp = fbm(dp * 2.6 + warp * 0.9);
    cloud += (wisp - 0.5) * 0.12;
    float billow = smoothstep(cover - 0.1 * clump, cover - 0.1 * clump + 0.16, cloud) * clump;
    c = mix(c, uDust * (0.9 + 0.4 * cloud), present * 0.16 * billow);
    float mote = specks(p, 34.0, vec2(0.0), 1.0, 0.055);
    c = mix(c, uDust * 1.4, mote * clump * present * 0.3);
  }

  if (uLluvia > 0.0) {
    // A shower darkens and greys the light, then the streaks fall through it.
    float grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, grey * vec3(0.86, 0.93, 1.04), uLluvia * 0.22);
    c *= 1.0 - uLluvia * 0.1;
    float density = 0.15 + 0.35 * uLluvia;
    float streaks = rainSheet(p, 140.0, 3.4, density, 0.0) * 0.6
      + rainSheet(p, 90.0, 2.4, density, 11.0) * 0.8
      + rainSheet(p, 55.0, 1.6, density * 0.7, 23.0);
    c += vec3(0.62, 0.68, 0.76) * streaks * uLluvia * 0.12;
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
        ['uPolvoVisible', new THREE.Uniform(0)],
        ['uHumo', new THREE.Uniform(0)],
        ['uReverbero', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
        ['uDust', new THREE.Uniform(srgb('#e3c49a'))],
        ['uSmoke', new THREE.Uniform(srgb('#7c828b'))],
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


  const time = useRef(0)
  const last = useRef(shared.uClock.value)
  const dust = useRef({ strength: 0, on: false, visible: 0 })

  useFrame((_, delta) => {
    const month = useStore.getState().month
    const now = meteoros(month, sitioAt(raw, hf, lluvia, month), calma.current)
    const u = effect.uniforms
    u.get('uLluvia')!.value = now.lluvia
    u.get('uNubes')!.value = now.nubes
    const dt = Math.min(delta, 0.1)
    const d = dust.current
    d.strength += (now.polvo - d.strength) * (1 - Math.exp(-dt / DUST_EASE))
    d.on = d.on ? d.strength > DUST_OFF : d.strength > DUST_ON
    d.visible = THREE.MathUtils.clamp(d.visible + (d.on ? dt : -dt) / DUST_FADE, 0, 1)
    u.get('uPolvo')!.value = d.strength
    u.get('uPolvoVisible')!.value = d.visible
    u.get('uHumo')!.value = now.humo
    u.get('uReverbero')!.value = now.reverbero
    // Its own clock, so asking for less motion slows the streaks and drift, not just dims them.
    time.current += (shared.uClock.value - last.current) * (calma.current ? CALM_PACE : 1)
    last.current = shared.uClock.value
    u.get('uTime')!.value = time.current
  })

  return <primitive object={effect} dispose={null} />
}
