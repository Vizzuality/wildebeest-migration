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
/**
 * Seconds a drop takes to catch up with its place and heading: the head almost at once, the
 * tail slowly, so the front leads and drags the rest. Size and stretch ease slower still, which
 * is what makes the liquid read as thick.
 */
const HEAD_EASE_S = 0.25
const TAIL_EASE_S = 2.5
const SHAPE_EASE_S = 1
/** A drop may trail the one ahead by this much more than their usual spacing before it is pulled. */
const ROPE_SLACK = 1.3
/**
 * The Recorrido is routed on the ground, with corners of up to ~120° and dead stops at each
 * stay. It is blurred over this many months (one sigma) so the Manada sweeps round in wide
 * curves and slows into a stay instead of turning or stopping on the spot.
 */
const ROUND_MONTHS = 0.15
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
varying vec2 vWorld;

// A thread of liquid from a to b. At its centre line it always reaches 1, above the surface,
// whatever the ground does: the terrain can thin a thread over a rise but never break it.
float thread(vec2 p, vec3 a, vec3 b, float r, float ground, inout vec2 grad) {
  vec2 ab = b.xy - a.xy;
  float k = clamp(dot(p - a.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec2 d = p - a.xy - ab * k;
  float d2 = dot(d, d);
  float r2 = r * r;
  if (d2 > r2 * 6.0) return 0.0;
  float climb = max(0.0, ground - mix(a.z, b.z, k) - ${CLIMB.toFixed(3)});
  float core = exp(-d2 / (r2 * 0.12));
  float w = exp(-d2 / r2) * mix(exp(-climb / ${CLIMB_FADE.toFixed(3)}), 1.0, core);
  grad -= 2.0 * d / r2 * w;
  return w;
}

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
    float spread = a * a / ra2 + b * b / r2;
    if (spread > 6.0) continue;
    // Liquid cannot climb above its drop, nor reach the far side of a rise between them.
    float rise = max(ground, heightAt(mix(p, uDrops[i].xy, 0.5)));
    float climb = max(0.0, rise - uDrops[i].w - ${CLIMB.toFixed(3)});
    float w = exp(-spread - climb / ${CLIMB_FADE.toFixed(3)});
    field += w;
    grad -= 2.0 * (t * a / ra2 + n * b / r2) * w;
    local += (d + vec2(float(i) * 37.1, float(i) * 17.3)) * w;
  }
  // Spine along the Recorrido and a bridge from each drop to it: the Manada is always one piece.
  for (int i = 0; i < ${DROPS}; i++) {
    vec3 drop = vec3(uDrops[i].xy, uDrops[i].w);
    field += thread(p, drop, uSpine[i], uDrops[i].z * 0.55, ground, grad);
    if (i + 1 < ${DROPS}) {
      field += thread(p, uSpine[i], uSpine[i + 1], min(uDrops[i].z, uDrops[i + 1].z) * 0.55, ground, grad);
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

interface State {
  x: number
  z: number
  /** The drop's point on the Recorrido. */
  sx: number
  sz: number
  r: number
  tx: number
  tz: number
  along: number
}

function place(bake: FaunaBake, hf: Heightfield, all: Drop[], now: State[], month: number, clock: number, dt: number) {
  const first = !now.length
  const targets: State[] = []
  const shapeEase = now.length ? 1 - Math.exp(-dt / SHAPE_EASE_S) : 1
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
    const u = drop.u + 0.08 * Math.sin(clock * 0.2 + drop.wobble)
    const v = drop.v + 0.08 * Math.cos(clock * 0.17 + drop.wobble * 1.7)
    const size = Math.sqrt(Math.sqrt(xx * zz - xz * xz)) * squeeze * DROP_SIZE
    // The stream tapers towards its head and tail.
    const taper = 1 - 0.45 * Math.min(1, Math.abs(drop.lag) / (2.3 * LAG_SIGMA))
    const r = Math.max(0.6, size * taper)
    const target: State = {
      x: x + l11 * u * squeeze,
      z: z + (l21 * u + l22 * v) * squeeze,
      sx: x,
      sz: z,
      r,
      // Neighbouring drops are about this far apart along the way; stretching each one over
      // the gap keeps the stream whole instead of breaking it into beads.
      along: r + pace * LAG_SIGMA * STRETCH,
      tx: pace > 1e-3 ? vx / pace : 1,
      tz: pace > 1e-3 ? vz / pace : 0,
    }
    targets.push(target)
    const s = (now[i] ??= { ...target })
    // The head reacts at once and each drop further back more sluggishly, so a start or a stop
    // travels back through the Manada instead of reaching every part of it at the same time.
    const back = 1 - i / (DROPS - 1)
    const ease = first ? 1 : 1 - Math.exp(-dt / (HEAD_EASE_S + (TAIL_EASE_S - HEAD_EASE_S) * back))
    s.x += (target.x - s.x) * ease
    s.z += (target.z - s.z) * ease
    s.sx += (target.sx - s.sx) * ease
    s.sz += (target.sz - s.sz) * ease
    s.r += (target.r - s.r) * shapeEase
    s.along += (target.along - s.along) * shapeEase
    // Standing still the heading does not matter (the drop is round), so it is kept.
    if (pace > 1e-3) {
      s.tx += (target.tx - s.tx) * ease
      s.tz += (target.tz - s.tz) * ease
      const n = Math.hypot(s.tx, s.tz) || 1
      s.tx /= n
      s.tz /= n
    }
  })

  // Each drop hangs off the one ahead of it on a rope: when the head pulls away, the rest are
  // dragged after it. Drop and spine point move together so the bridge between them holds.
  for (let i = DROPS - 2; i >= 0; i--) {
    const s = now[i]
    const lead = now[i + 1]
    const rest = Math.hypot(targets[i].x - targets[i + 1].x, targets[i].z - targets[i + 1].z) * ROPE_SLACK + s.r
    const dx = s.x - lead.x
    const dz = s.z - lead.z
    const d = Math.hypot(dx, dz)
    if (d > rest) {
      const k = (d - rest) / d
      s.x -= dx * k
      s.z -= dz * k
      s.sx -= dx * k
      s.sz -= dz * k
    }
  }

  now.forEach((s, i) => {
    uniforms.uDrops.value[i].set(s.x, s.z, s.r, hf.heightAt(s.x, s.z))
    uniforms.uAxes.value[i].set(s.tx, s.tz, s.along)
    uniforms.uSpine.value[i].set(s.sx, s.sz, hf.heightAt(s.sx, s.sz))
    minX = Math.min(minX, s.x)
    minZ = Math.min(minZ, s.z)
    maxX = Math.max(maxX, s.x)
    maxZ = Math.max(maxZ, s.z)
    biggest = Math.max(biggest, s.along)
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
