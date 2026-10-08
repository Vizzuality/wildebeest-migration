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

const DROPS = 40
/** How far ahead of or behind the calendar the drops run (months, one sigma). */
const LAG_SIGMA = 0.17
/** The Presencia averages five years of collars, so the pool is drawn this much tighter. */
const SPREAD = 0.45
/** On the move the stream narrows: the faster, the thinner (km/month). */
const SQUEEZE_KM_PER_MONTH = 30
/** Drop radius, as a share of the Presencia's size. */
const DROP_SIZE = 0.48
/** How much each drop stretches along the way, per km/month of pace. */
const STRETCH = 0.35
/** Where the merged field becomes liquid. */
const SURFACE = 0.45
/** How far back in time each drop's trail reaches, per segment (months), and how it thins. */
const TRAIL_MONTHS = 0.06
const TRAIL_HEAD = 0.55
const TRAIL_MID = 0.4
const TRAIL_END = 0.25
/**
 * On the move each drop keeps its own lane beside the way, across it rather than along the
 * map's axes, so a turn does not swap the drops from one side of the stream to the other. The
 * lane takes over from the pool's spread between these paces (km/month).
 */
const LANE_FROM = 5
const LANE_FULL = 25
/**
 * The Recorrido is routed on the ground, with corners of up to ~120° and dead stops at each
 * stay. It is blurred over this many months (one sigma) so the Manada sweeps round in wide
 * curves and slows into a stay instead of turning or stopping on the spot.
 */
const ROUND_MONTHS = 0.15
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
  // Sorted by lag, so neighbouring drops are neighbours along the spine.
  return Array.from({ length: DROPS }, () => ({
    lag: THREE.MathUtils.clamp(gauss(), -2.3, 2.3) * LAG_SIGMA,
    u: gauss() * 0.8,
    v: gauss() * 0.8,
    wobble: rnd() * Math.PI * 2,
  })).sort((a, b) => a.lag - b.lag)
}

const uniforms = {
  /** Each drop: x, z, radius (km) and the ground height under it. */
  uDrops: { value: Array.from({ length: DROPS }, () => new THREE.Vector4()) },
  /** Each drop's heading and its radius along it: on the move drops stretch into a stream. */
  uAxes: { value: Array.from({ length: DROPS }, () => new THREE.Vector3(1, 0, 1)) },
  /** Each drop's point on the Recorrido itself (x, z, ground height), in lag order. */
  uSpine: { value: Array.from({ length: DROPS }, () => new THREE.Vector3()) },
  /** Where each drop was a moment ago and a moment before that: its trail along its own lane. */
  uTrail: { value: Array.from({ length: DROPS }, () => new THREE.Vector4()) },
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
uniform vec3 uSpine[${DROPS}];
uniform vec4 uTrail[${DROPS}];
varying vec2 vWorld;

// A thread of liquid from a to b. At its centre line it always reaches 1, above the surface.
float thread(vec2 p, vec3 a, vec3 b, float r, inout vec2 grad) {
  vec2 ab = b.xy - a.xy;
  float k = clamp(dot(p - a.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec2 d = p - a.xy - ab * k;
  float d2 = dot(d, d);
  float r2 = r * r;
  if (d2 > r2 * 6.0) return 0.0;
  float w = exp(-d2 / r2);
  grad -= 2.0 * d / r2 * w;
  return w;
}

// A thread that thins from ra at a to rb at b.
float taper(vec2 p, vec2 a, vec2 b, float ra, float rb, inout vec2 grad) {
  vec2 ab = b - a;
  float k = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec2 d = p - a - ab * k;
  float d2 = dot(d, d);
  float r = mix(ra, rb, k);
  float r2 = r * r;
  if (d2 > r2 * 6.0) return 0.0;
  float w = exp(-d2 / r2);
  grad -= 2.0 * d / r2 * w;
  return w;
}

void main() {
  vec2 p = vWorld;
  float field = 0.0;
  vec2 grad = vec2(0.0);
  // Where this point sits relative to the drops around it, so the texture travels with them.
  vec2 local = vec2(0.0);
  for (int i = 0; i < ${DROPS}; i++) {
    vec2 d = p - uDrops[i].xy;
    vec2 t = uAxes[i].xy;
    vec2 n = vec2(-t.y, t.x);
    float ra2 = uAxes[i].z * uAxes[i].z;
    float r2 = uDrops[i].z * uDrops[i].z;
    float a = dot(d, t);
    float b = dot(d, n);
    float spread = a * a / ra2 + b * b / r2;
    if (spread > 6.0) continue;
    float w = exp(-spread);
    field += w;
    grad -= 2.0 * (t * a / ra2 + n * b / r2) * w;
    local += (d + vec2(float(i) * 37.1, float(i) * 17.3)) * w;
  }
  // Spine along the Recorrido, and behind each drop the trail it leaves down its own lane, thinning
  // as it stretches: a drop that runs ahead stays joined to the rest the way mud pulls out.
  for (int i = 0; i < ${DROPS}; i++) {
    float r = uDrops[i].z;
    field += taper(p, uDrops[i].xy, uTrail[i].xy, r * ${TRAIL_HEAD.toFixed(2)}, r * ${TRAIL_MID.toFixed(2)}, grad);
    field += taper(p, uTrail[i].xy, uTrail[i].zw, r * ${TRAIL_MID.toFixed(2)}, r * ${TRAIL_END.toFixed(2)}, grad);
    if (i + 1 < ${DROPS}) {
      field += thread(p, uSpine[i], uSpine[i + 1], min(uDrops[i].z, uDrops[i + 1].z) * 0.55, grad);
    }
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

/** The Recorrido blurred over time, wrapping round the year. */
function rounded(bake: FaunaBake): FaunaBake {
  const pts = bake.recorrido
  const n = pts.length
  const sigma = ROUND_MONTHS * bake.samplesPerMonth
  const reach = Math.ceil(sigma * 3)
  const weights = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-0.5 * ((k - reach) / sigma) ** 2))
  const total = weights.reduce((a, b) => a + b, 0)
  const recorrido = pts.map((_, i) => {
    let x = 0
    let z = 0
    weights.forEach((w, k) => {
      const [px, pz] = pts[(((i + k - reach) % n) + n) % n]
      x += px * w
      z += pz * w
    })
    return [x / total, z / total] as [number, number]
  })
  return { ...bake, recorrido }
}

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

/** Where a drop is at moment `t` of the year, and the shape of the Manada there. */
function spot(bake: FaunaBake, drop: Drop, t: number, clock: number) {
  // Every drop runs the same way, just earlier or later: its place is the Recorrido itself.
  const [sx, sz] = recorridoAt(bake, t)
  const [vx, vz] = velocityAt(bake, t)
  const pace = Math.hypot(vx, vz)
  const tx = pace > 1e-3 ? vx / pace : 1
  const tz = pace > 1e-3 ? vz / pace : 0
  const squeeze = SPREAD / (1 + pace / SQUEEZE_KM_PER_MONTH)
  const [xx, xz, zz] = formaAt(bake.forma, t)
  const u = drop.u + 0.08 * Math.sin(clock * 0.2 + drop.wobble)
  const v = drop.v + 0.08 * Math.cos(clock * 0.17 + drop.wobble * 1.7)
  // Standing still the drops open out over the Presencia into the pool.
  const l11 = Math.sqrt(xx)
  const l21 = xz / l11
  const l22 = Math.sqrt(Math.max(0, zz - l21 * l21))
  const poolX = l11 * u * squeeze
  const poolZ = (l21 * u + l22 * v) * squeeze
  // On the move each keeps its lane across the way, as wide as the Presencia is that way.
  const nx = -tz
  const nz = tx
  const across = Math.sqrt(Math.max(0, nx * nx * xx + 2 * nx * nz * xz + nz * nz * zz))
  const lane = THREE.MathUtils.smoothstep(pace, LANE_FROM, LANE_FULL)
  return {
    x: sx + poolX + (nx * v * across * squeeze - poolX) * lane,
    z: sz + poolZ + (nz * v * across * squeeze - poolZ) * lane,
    sx,
    sz,
    tx,
    tz,
    pace,
    size: Math.sqrt(Math.sqrt(xx * zz - xz * xz)) * squeeze * DROP_SIZE,
  }
}

function place(bake: FaunaBake, hf: Heightfield, all: Drop[], month: number, clock: number) {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  let biggest = 0
  all.forEach((drop, i) => {
    const t = month + drop.lag
    const { x, z, sx, sz, tx, tz, pace, size } = spot(bake, drop, t, clock)
    const mid = spot(bake, drop, t - TRAIL_MONTHS, clock)
    const end = spot(bake, drop, t - 2 * TRAIL_MONTHS, clock)
    // The stream tapers towards its head and tail.
    const taper = 1 - 0.45 * Math.min(1, Math.abs(drop.lag) / (2.3 * LAG_SIGMA))
    const r = Math.max(0.6, size * taper)
    // Neighbouring drops are about this far apart along the way; stretching each one over
    // the gap keeps the stream whole instead of breaking it into beads.
    const along = r + pace * LAG_SIGMA * STRETCH
    uniforms.uDrops.value[i].set(x, z, r, hf.heightAt(x, z))
    uniforms.uAxes.value[i].set(tx, tz, along)
    uniforms.uSpine.value[i].set(sx, sz, hf.heightAt(sx, sz))
    uniforms.uTrail.value[i].set(mid.x, mid.z, end.x, end.z)
    for (const [px, pz] of [
      [x, z],
      [end.x, end.z],
    ]) {
      minX = Math.min(minX, px)
      minZ = Math.min(minZ, pz)
      maxX = Math.max(maxX, px)
      maxZ = Math.max(maxZ, pz)
    }
    biggest = Math.max(biggest, along)
  })
  // Past ~2.5 radii a drop adds nothing (the shader skips it), so that is all the margin needed.
  const size = Math.max(maxX - minX, maxZ - minZ) + 2 * 2.5 * biggest
  uniforms.uOrigin.value.set((minX + maxX) / 2 - size / 2, (minZ + maxZ) / 2 - size / 2)
  uniforms.uSize.value = size
}

export function Fauna() {
  const raw = useFauna()
  const bake = useMemo(() => rounded(raw), [raw])
  const hf = useHeightfield()
  const all = useMemo(() => drops(), [])
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

  useFrame(() => place(bake, hf, all, useStore.getState().month, shared.uClock.value))

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
