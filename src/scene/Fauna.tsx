import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFauna, type FaunaBake } from '../fauna'
import { GLSL_COMMON, shared } from '../shaders/common'
import { mulberry32, useHeightfield, type Heightfield, type RiverLine } from '../terrain'
import { useStore } from '../store'
import { Partos, type OnMancha } from './Partos'

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
/**
 * A real crossing is a single gentle bank a few hundred metres wide, so the Manada funnels into
 * it: within NECK_REACH km of where the way crosses a main river its lanes close in, down to
 * NECK_MIN of their width (and the drops to NECK_DROP of their size) on the river itself.
 */
const NECK_REACH = 30
const NECK_MIN = 0.12
const NECK_DROP = 0.55
/**
 * Each drop takes its own line through the year: it drifts across the stream by up to about
 * WANDER_SIDE of the Presencia's width, and up to about WANDER_LAG months ahead or behind its usual
 * place in it, as a sum of slow yearly waves, so its line closes on itself each year. Measured
 * against the stream, it narrows with it at a crossing and never strays out of it.
 */
const WANDER_SIDE = 0.3
const WANDER_LAG = 0.05
const WANDER_WAVES = 4
/**
 * A drop never strays further from its point on the Recorrido than the nearest main river, so
 * none ends up across a river the way has not crossed. Close to a river (a corridor, a bank, a
 * crossing) the Manada draws in: it keeps within BANK of that distance, giving way softly.
 */
const BANK = 0.6
/** Draped grid resolution, and the lift that keeps it off the ground (km). */
const GRID = 320
const LIFT = 0.03

interface Wave {
  size: number
  phase: number
}

interface Drop {
  lag: number
  u: number
  v: number
  wobble: number
  side: Wave[]
  late: Wave[]
}

/** A slow wave through the year, about ±1, that comes back to the same value each year. */
function swell(waves: Wave[], month: number) {
  return waves.reduce((sum, w, k) => sum + w.size * Math.sin((2 * Math.PI * (k + 1) * month) / 12 + w.phase), 0)
}

/** How far ahead of or behind the calendar a drop runs at this moment (months). */
function lagAt(drop: Drop, month: number) {
  return drop.lag + swell(drop.late, month) * WANDER_LAG
}

function drops(): Drop[] {
  const rnd = mulberry32(11)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-6))) * Math.cos(2 * Math.PI * rnd())
  // Slower waves swing wider, scaled so the sum stays about ±1.
  const norm = Math.sqrt(Array.from({ length: WANDER_WAVES }, (_, k) => 1 / (k + 1) ** 2).reduce((a, b) => a + b, 0) / 2)
  const waves = () => Array.from({ length: WANDER_WAVES }, (_, k) => ({ size: (rnd() + 0.5) / (k + 1) / norm / 1.5, phase: rnd() * Math.PI * 2 }))
  return Array.from({ length: DROPS }, () => ({
    lag: THREE.MathUtils.clamp(gauss(), -2.3, 2.3) * LAG_SIGMA,
    u: gauss() * 0.8,
    v: gauss() * 0.8,
    wobble: rnd() * Math.PI * 2,
    side: waves(),
    late: waves(),
  }))
}

const uniforms = {
  /** Each drop: x, z, radius (km) and the ground height under it. */
  uDrops: { value: Array.from({ length: DROPS }, () => new THREE.Vector4()) },
  /** Each drop's heading and its radius along it: on the move drops stretch into a stream. */
  uAxes: { value: Array.from({ length: DROPS }, () => new THREE.Vector3(1, 0, 1)) },
  /** Each drop's point on the Recorrido itself (x, z) and radius, in order along the stream. */
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
      field += thread(p, uSpine[i], uSpine[i + 1], min(uSpine[i].z, uSpine[i + 1].z) * 0.55, grad);
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

/**
 * The Recorrido as the Manada follows it and, at each sample, how open it is (1 away from the
 * rivers) and which way it faces (unit x, z).
 */
type Way = FaunaBake & { neck: number[]; facing: [number, number][]; room: number[] }

function crosses(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const side = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

/** How far (km) each sample is from the nearest main river. */
function rooms(recorrido: [number, number][], rivers: RiverLine[]) {
  const segments = rivers.filter((r) => r.kind === 'main').flatMap((r) => r.points.slice(1).map((q, k) => [r.points[k], q] as const))
  return recorrido.map(([x, z]) => {
    let best = Infinity
    for (const [[ax, az], [bx, bz]] of segments) {
      const rx = bx - ax
      const rz = bz - az
      const k = THREE.MathUtils.clamp(((x - ax) * rx + (z - az) * rz) / Math.max(rx * rx + rz * rz, 1e-9), 0, 1)
      best = Math.min(best, Math.hypot(x - ax - rx * k, z - az - rz * k))
    }
    return best
  })
}

/** How far along the way (km, wrapping round the year) each sample is from the nearest main river crossing. */
function necks(recorrido: [number, number][], rivers: RiverLine[]) {
  const n = recorrido.length
  const km = [0]
  for (let i = 1; i <= n; i++) km.push(km[i - 1] + Math.hypot(recorrido[i % n][0] - recorrido[i - 1][0], recorrido[i % n][1] - recorrido[i - 1][1]))
  const loop = km[n]
  const segments = rivers.filter((r) => r.kind === 'main').flatMap((r) => r.points.slice(1).map((q, k) => [r.points[k], q] as const))
  const crossings: number[] = []
  for (let i = 0; i < n; i++) {
    const a = recorrido[i]
    const b = recorrido[(i + 1) % n]
    if (a[0] === b[0] && a[1] === b[1]) continue
    const [x0, x1, z0, z1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]
    const near = ([c, d]: (typeof segments)[number]) =>
      Math.max(c[0], d[0]) >= x0 && Math.min(c[0], d[0]) <= x1 && Math.max(c[1], d[1]) >= z0 && Math.min(c[1], d[1]) <= z1
    if (segments.some((seg) => near(seg) && crosses(a, b, seg[0], seg[1]))) crossings.push((km[i] + km[i + 1]) / 2)
  }
  return km.slice(0, n).map((at) => {
    const gap = Math.min(Infinity, ...crossings.map((c) => Math.min(Math.abs(at - c), loop - Math.abs(at - c))))
    return THREE.MathUtils.smoothstep(gap, 0, NECK_REACH)
  })
}

/** The Recorrido blurred over time, wrapping round the year. */
function rounded(bake: FaunaBake, rivers: RiverLine[]): Way {
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
  return {
    ...bake,
    recorrido,
    neck: necks(recorrido, rivers),
    facing: facings({ ...bake, recorrido }),
    room: rooms(recorrido, rivers),
  }
}

/**
 * Which way the pool faces. Slowing into a stay it faces the way the Manada is going, so the
 * drops only spread along their lanes. Through the stay it holds still rather than spin round,
 * and it only swings to the way out once the Manada is fast enough to be all lanes, where the
 * pool no longer shows.
 */
function facings(bake: FaunaBake) {
  const spm = bake.samplesPerMonth
  const velocity = bake.recorrido.map((_, i) => velocityAt(bake, i / spm))
  const facing: [number, number][] = velocity.map(() => [1, 0])
  let held: [number, number] = [1, 0]
  let arriving = true
  // Twice round the year, so the first stay knows which way the Manada came in.
  for (let pass = 0; pass < 2; pass++)
    velocity.forEach(([vx, vz], i) => {
      const pace = Math.hypot(vx, vz)
      if (pace >= LANE_FULL) arriving = true
      else if (pace < LANE_FROM) arriving = false
      if (arriving) held = [vx / pace, vz / pace]
      facing[i] = held
    })
  return facing
}

function sampleAt<T>(way: Way, samples: T[], month: number): [T, T, number] {
  const n = samples.length
  const f = (((month * way.samplesPerMonth) % n) + n) % n
  const i = Math.floor(f)
  return [samples[i], samples[(i + 1) % n], f - i]
}

function neckAt(way: Way, month: number) {
  const [a, b, w] = sampleAt(way, way.neck, month)
  return a + (b - a) * w
}

function roomAt(way: Way, month: number) {
  const [a, b, w] = sampleAt(way, way.room, month)
  return a + (b - a) * w
}

function facingAt(way: Way, month: number): [number, number] {
  const [a, b, w] = sampleAt(way, way.facing, month)
  const x = a[0] + (b[0] - a[0]) * w
  const z = a[1] + (b[1] - a[1]) * w
  const l = Math.hypot(x, z) || 1
  return [x / l, z / l]
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

/**
 * Where a drop is at moment `t` of the year, and the shape of the Manada there. A trail passes
 * its drop's `open` so it funnels with the drop instead of fanning out behind it.
 */
function spot(bake: Way, drop: Drop, t: number, clock: number, open = neckAt(bake, t)) {
  // Every drop runs the same way, just earlier or later: its place is the Recorrido itself.
  const [sx, sz] = recorridoAt(bake, t)
  const [vx, vz] = velocityAt(bake, t)
  const pace = Math.hypot(vx, vz)
  const [fx, fz] = facingAt(bake, t)
  // Still, the velocity left is noise pointing anywhere: below a walk the pool's facing rules.
  const tx = pace > LANE_FROM ? vx / pace : fx
  const tz = pace > LANE_FROM ? vz / pace : fz
  const squeeze = (SPREAD / (1 + pace / SQUEEZE_KM_PER_MONTH)) * (NECK_MIN + (1 - NECK_MIN) * open)
  const shrink = NECK_DROP + (1 - NECK_DROP) * open
  const [xx, xz, zz] = formaAt(bake.forma, t)
  const u = drop.u + 0.08 * Math.sin(clock * 0.2 + drop.wobble)
  const v = drop.v + 0.08 * Math.cos(clock * 0.17 + drop.wobble * 1.7)
  const lane = THREE.MathUtils.smoothstep(pace, LANE_FROM, LANE_FULL)
  // On the move each keeps its lane across the way, as wide as the Presencia is that way.
  const nx = -tz
  const nz = tx
  const across = Math.sqrt(Math.max(0, nx * nx * xx + 2 * nx * nz * xz + nz * nz * zz))
  // Standing still the drops open out over the Presencia into the pool. Its spread is factored
  // across the way it faces first, so arriving each drop keeps its lane and only spreads along
  // the way: none has to cut across the others to reach a place of its own.
  const [gx, gz] = [-fz, fx]
  const wide = Math.sqrt(Math.max(0, gx * gx * xx + 2 * gx * gz * xz + gz * gz * zz))
  const shear = (fx * gx * xx + (fx * gz + fz * gx) * xz + fz * gz * zz) / Math.max(wide, 1e-6)
  const ahead = Math.sqrt(Math.max(0, fx * fx * xx + 2 * fx * fz * xz + fz * fz * zz - shear * shear))
  const poolX = (gx * v * wide + fx * (shear * v + ahead * u)) * squeeze
  const poolZ = (gz * v * wide + fz * (shear * v + ahead * u)) * squeeze
  // Its own line drifts across the stream: across the way on the move, across the pool when still.
  const drift = swell(drop.side, t) * WANDER_SIDE * squeeze
  const sideX = gx * wide * drift + (nx * across - gx * wide) * drift * lane
  const sideZ = gz * wide * drift + (nz * across - gz * wide) * drift * lane
  const ox = poolX + (nx * v * across * squeeze - poolX) * lane + sideX
  const oz = poolZ + (nz * v * across * squeeze - poolZ) * lane + sideZ
  const kept = 1 / Math.sqrt(Math.sqrt(1 + (Math.hypot(ox, oz) / Math.max(roomAt(bake, t) * BANK, 1e-3)) ** 4))
  return {
    x: sx + ox * kept,
    z: sz + oz * kept,
    sx,
    sz,
    tx,
    tz,
    pace,
    open,
    size: Math.sqrt(Math.sqrt(xx * zz - xz * xz)) * (SPREAD / (1 + pace / SQUEEZE_KM_PER_MONTH)) * shrink * DROP_SIZE,
  }
}

function place(bake: Way, hf: Heightfield, all: Drop[], month: number, clock: number) {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  let biggest = 0
  const spine: { lag: number; x: number; z: number; r: number }[] = []
  all.forEach((drop, i) => {
    const lag = lagAt(drop, month)
    const t = month + lag
    const { x, z, sx, sz, tx, tz, pace, open, size } = spot(bake, drop, t, clock)
    const mid = spot(bake, drop, t - TRAIL_MONTHS, clock, open)
    const end = spot(bake, drop, t - 2 * TRAIL_MONTHS, clock, open)
    // The stream tapers towards its head and tail.
    const taper = 1 - 0.45 * Math.min(1, Math.abs(lag) / (2.3 * LAG_SIGMA))
    const r = Math.max(0.6, size * taper)
    // Neighbouring drops are about this far apart along the way; stretching each one over
    // the gap keeps the stream whole instead of breaking it into beads.
    const along = r + pace * LAG_SIGMA * STRETCH
    uniforms.uDrops.value[i].set(x, z, r, hf.heightAt(x, z))
    uniforms.uAxes.value[i].set(tx, tz, along)
    spine.push({ lag, x: sx, z: sz, r })
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
  // Drops overtake one another, so the spine is threaded in their order along the stream now.
  spine.sort((a, b) => a.lag - b.lag).forEach((s, k) => uniforms.uSpine.value[k].set(s.x, s.z, s.r))
  // Past ~2.5 radii a drop adds nothing (the shader skips it), so that is all the margin needed.
  const size = Math.max(maxX - minX, maxZ - minZ) + 2 * 2.5 * biggest
  uniforms.uOrigin.value.set((minX + maxX) / 2 - size / 2, (minZ + maxZ) / 2 - size / 2)
  uniforms.uSize.value = size
}

/** ?recorrido draws the way the Manada follows, coloured by month, for checking it by eye. */
const SHOW_RECORRIDO = new URLSearchParams(window.location.search).has('recorrido')

function RecorridoLine({ bake, hf }: { bake: FaunaBake; hf: Heightfield }) {
  const { points, colors } = useMemo(() => {
    const pts = [...bake.recorrido, bake.recorrido[0]]
    return {
      points: pts.map(([x, z]) => new THREE.Vector3(x, hf.heightAt(x, z) + 0.8, z)),
      colors: pts.map((_, i) => new THREE.Color().setHSL(i / bake.recorrido.length, 0.9, 0.55)),
    }
  }, [bake, hf])
  return <Line points={points} vertexColors={colors} lineWidth={2.5} />
}

export function Fauna() {
  const raw = useFauna()
  const hf = useHeightfield()
  const bake = useMemo(() => rounded(raw, hf.rivers), [raw, hf.rivers])
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

  // Well inside one drop, so the point is on the liquid whatever its neighbours do.
  const onMancha = useCallback<OnMancha>(
    (month, rnd) => {
      const drop = all[Math.floor(rnd() * all.length)]
      const { x, z, size } = spot(bake, drop, month + lagAt(drop, month), 0)
      const angle = rnd() * Math.PI * 2
      const reach = Math.sqrt(rnd()) * size * 0.45
      return [x + Math.cos(angle) * reach, z + Math.sin(angle) * reach]
    },
    [bake, all],
  )

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      <Partos onMancha={onMancha} />
      {SHOW_RECORRIDO && <RecorridoLine bake={bake} hf={hf} />}
    </>
  )
}
