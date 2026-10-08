import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFauna, type FaunaBake } from '../fauna'
import { GLSL_COMMON, shared } from '../shaders/common'
import { mulberry32, useHeightfield, type Heightfield } from '../terrain'
import { useStore } from '../store'

// The Manada as a liquid poured along the Recorrido. It is a chain of drops, each running a
// little ahead of or behind the calendar, merged into one smooth surface like metaballs. On the
// move the drops string out along the curve of the way into a stream: the head pushes on, the
// tail drains after it. At a stay the ones in front stop while the rest keep arriving, so the
// stream pools. Every drop's place comes straight from the Recorrido, so nothing can jump.
// The ground shapes it like water: the liquid cannot climb much above the drop it came from, so
// it pools in hollows and stops against the slopes.

const DROPS = 40
/** How far ahead of or behind the calendar the drops run (months, one sigma). */
const LAG_SIGMA = 0.13
/** The Presencia averages five years of collars, so the pool is drawn this much tighter. */
const SPREAD = 0.45
/** On the move the stream narrows: the faster, the thinner (km/month). */
const SQUEEZE_KM_PER_MONTH = 30
/** Drop radius, as a share of the Presencia's size. */
const DROP_SIZE = 0.42
/** How much each drop stretches along the way, per km/month of pace. */
const STRETCH = 0.25
/** Where the merged field becomes liquid. */
const SURFACE = 0.55
/** Seconds each drop takes to catch up with where it should be. */
const EASE_S = 0.3
/** The liquid fades out this far above the drop it came from (world units, exaggerated). */
const CLIMB = 0.03
const CLIMB_FADE = 0.06
/** Draped grid resolution, and the lift that keeps it off the ground (km). */
const GRID = 320
const LIFT = 0.03

interface Drop {
  lag: number
  u: number
  v: number
  wobble: number
}

function drops(): Drop[] {
  const rnd = mulberry32(11)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-6))) * Math.cos(2 * Math.PI * rnd())
  return Array.from({ length: DROPS }, () => ({
    lag: THREE.MathUtils.clamp(gauss(), -2.3, 2.3) * LAG_SIGMA,
    u: gauss() * 0.8,
    v: gauss() * 0.8,
    wobble: rnd() * Math.PI * 2,
  }))
}

const uniforms = {
  /** Each drop: x, z, radius (km) and the ground height under it. */
  uDrops: { value: Array.from({ length: DROPS }, () => new THREE.Vector4()) },
  /** Each drop's heading and its radius along it: on the move drops stretch into a stream. */
  uAxes: { value: Array.from({ length: DROPS }, () => new THREE.Vector3(1, 0, 1)) },
  uOrigin: { value: new THREE.Vector2() },
  uSize: { value: 1 },
}

const vertex = /* glsl */ `
${GLSL_COMMON}
uniform vec2 uOrigin;
uniform float uSize;
varying vec2 vWorld;
void main() {
  vec2 xz = uOrigin + uv * uSize;
  vWorld = xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, heightAt(xz) + ${LIFT.toFixed(3)}, xz.y, 1.0);
}
`

const fragment = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uDrops[${DROPS}];
uniform vec3 uAxes[${DROPS}];
varying vec2 vWorld;

void main() {
  vec2 p = vWorld;
  float field = 0.0;
  vec2 grad = vec2(0.0);
  // Where this point sits relative to the drops around it, so the texture travels with them.
  vec2 local = vec2(0.0);
  float ground = heightAt(p);
  for (int i = 0; i < ${DROPS}; i++) {
    vec2 d = p - uDrops[i].xy;
    vec2 t = uAxes[i].xy;
    vec2 n = vec2(-t.y, t.x);
    float ra2 = uAxes[i].z * uAxes[i].z;
    float r2 = uDrops[i].z * uDrops[i].z;
    float a = dot(d, t);
    float b = dot(d, n);
    float climb = max(0.0, ground - uDrops[i].w - ${CLIMB.toFixed(3)});
    float w = exp(-a * a / ra2 - b * b / r2 - climb / ${CLIMB_FADE.toFixed(3)});
    field += w;
    grad -= 2.0 * (t * a / ra2 + n * b / r2) * w;
    local += (d + vec2(float(i) * 37.1, float(i) * 17.3)) * w;
  }
  float halo = smoothstep(0.12, ${SURFACE.toFixed(2)}, field) * 0.18;
  float edge = fwidth(field) * 1.2;
  float body = smoothstep(${SURFACE.toFixed(2)} - edge, ${SURFACE.toFixed(2)} + edge, field);
  float alpha = max(body * 0.9, halo);
  if (alpha < 0.005) discard;
  local /= max(field, 1e-4);

  // The surface bulges a little where the liquid runs deep, so the sun models it.
  vec3 normal = normalize(vec3(-grad.x * 0.6, 1.0, -grad.y * 0.6));
  float deep = smoothstep(${SURFACE.toFixed(2)}, 2.2, field);
  float grain = tnoise(local * 3.0) * 0.5 + tnoise(local * 9.0) * 0.3;
  vec3 albedo = mix(vec3(0.24, 0.19, 0.14), vec3(0.075, 0.065, 0.06), deep);
  albedo *= 1.0 + grain * 0.18;
  albedo = mix(vec3(0.42, 0.35, 0.26), albedo, body);
  vec3 lit = sunlight(srgb(albedo), normal, cloudShadow(p));
  gl_FragColor = vec4(lit, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function recorridoAt(bake: FaunaBake, month: number): [number, number] {
  const n = bake.recorrido.length
  const f = (((month * bake.samplesPerMonth) % n) + n) % n
  const i = Math.floor(f)
  const [ax, az] = bake.recorrido[i]
  const [bx, bz] = bake.recorrido[(i + 1) % n]
  const w = f - i
  return [ax + (bx - ax) * w, az + (bz - az) * w]
}

/** The Presencia now, eased between mid-months. */
function formaAt(forma: FaunaBake['forma'], month: number) {
  const t = month - 0.5
  const a = ((Math.floor(t) % 12) + 12) % 12
  const b = (a + 1) % 12
  const w = t - Math.floor(t)
  return forma[a].map((v, k) => v * (1 - w) + forma[b][k] * w)
}

/** The Recorrido's velocity around a moment (km/month), averaged over a wide window so the
 * Manada eases into a stay and out of it instead of stopping dead. */
function velocityAt(bake: FaunaBake, t: number): [number, number] {
  let vx = 0
  let vz = 0
  let total = 0
  for (const o of [-0.3, -0.15, 0, 0.15, 0.3]) {
    const w = Math.exp(-((o / 0.2) ** 2))
    const [px, pz] = recorridoAt(bake, t + o - 0.1)
    const [qx, qz] = recorridoAt(bake, t + o + 0.1)
    vx += ((qx - px) / 0.2) * w
    vz += ((qz - pz) / 0.2) * w
    total += w
  }
  return [vx / total, vz / total]
}

interface State {
  x: number
  z: number
  r: number
  tx: number
  tz: number
  along: number
}

function place(bake: FaunaBake, hf: Heightfield, all: Drop[], now: State[], month: number, clock: number, dt: number) {
  // Whatever the inputs do, each drop eases towards its target, so nothing can jump.
  const ease = now.length ? 1 - Math.exp(-dt / EASE_S) : 1
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  let biggest = 0
  all.forEach((drop, i) => {
    const t = month + drop.lag
    const [x, z] = recorridoAt(bake, t)
    const [vx, vz] = velocityAt(bake, t)
    const pace = Math.hypot(vx, vz)
    // Each drop takes its own spot in the Presencia where it is, narrowing as it runs.
    const squeeze = SPREAD / (1 + pace / SQUEEZE_KM_PER_MONTH)
    const [xx, xz, zz] = formaAt(bake.forma, t)
    const l11 = Math.sqrt(xx)
    const l21 = xz / l11
    const l22 = Math.sqrt(Math.max(0, zz - l21 * l21))
    const u = drop.u + 0.15 * Math.sin(clock * 0.35 + drop.wobble)
    const v = drop.v + 0.15 * Math.cos(clock * 0.3 + drop.wobble * 1.7)
    const size = Math.sqrt(Math.sqrt(xx * zz - xz * xz)) * squeeze * DROP_SIZE
    // The stream tapers towards its head and tail.
    const taper = 1 - 0.45 * Math.min(1, Math.abs(drop.lag) / (2.3 * LAG_SIGMA))
    const r = Math.max(0.6, size * taper)
    const target: State = {
      x: x + l11 * u * squeeze,
      z: z + (l21 * u + l22 * v) * squeeze,
      r,
      // Neighbouring drops are about this far apart along the way; stretching each one over
      // the gap keeps the stream whole instead of breaking it into beads.
      along: r + pace * LAG_SIGMA * STRETCH,
      tx: pace > 1e-3 ? vx / pace : 1,
      tz: pace > 1e-3 ? vz / pace : 0,
    }
    const s = (now[i] ??= { ...target })
    s.x += (target.x - s.x) * ease
    s.z += (target.z - s.z) * ease
    s.r += (target.r - s.r) * ease
    s.along += (target.along - s.along) * ease
    // Standing still the heading does not matter (the drop is round), so it is kept.
    if (pace > 1e-3) {
      s.tx += (target.tx - s.tx) * ease
      s.tz += (target.tz - s.tz) * ease
      const n = Math.hypot(s.tx, s.tz) || 1
      s.tx /= n
      s.tz /= n
    }
    uniforms.uDrops.value[i].set(s.x, s.z, s.r, hf.heightAt(s.x, s.z))
    uniforms.uAxes.value[i].set(s.tx, s.tz, s.along)
    minX = Math.min(minX, s.x)
    minZ = Math.min(minZ, s.z)
    maxX = Math.max(maxX, s.x)
    maxZ = Math.max(maxZ, s.z)
    biggest = Math.max(biggest, s.along)
  })
  const size = Math.max(maxX - minX, maxZ - minZ) + 5 * biggest
  uniforms.uOrigin.value.set((minX + maxX) / 2 - size / 2, (minZ + maxZ) / 2 - size / 2)
  uniforms.uSize.value = size
}

export function Fauna() {
  const bake = useFauna()
  const hf = useHeightfield()
  const all = useMemo(() => drops(), [])
  const now = useMemo<State[]>(() => [], [])
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1, GRID, GRID), [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { ...shared, ...uniforms },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  )

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, dt) => place(bake, hf, all, now, useStore.getState().month, shared.uClock.value, Math.min(dt, 0.1)))

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
