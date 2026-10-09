import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFauna, type FaunaBake } from '../fauna'
import { CAUDAL } from '../geo'
import { stageAt } from '../shaders/rivers'
import { GLSL_COMMON, shared } from '../shaders/common'
import { mulberry32, useHeightfield, type Heightfield, type RiverLine } from '../terrain'
import { useStore } from '../store'
import { Bajas, type Avalancha } from './Bajas'
import { Partos, type OnMancha } from './Partos'

// The Manada as a liquid poured along the Recorrido. It is a chain of drops, each running a
// little ahead of or behind the calendar, merged into one smooth surface like metaballs. On the
// move the drops string out along the curve of the way into a stream: the head pushes on, the
// tail drains after it. At a stay the ones in front stop while the rest keep arriving, so the
// stream pools. Every drop's place comes straight from the Recorrido, so nothing can jump.

const DROPS = 1
/** How far ahead of or behind the calendar the drops run (months, one sigma). */
const LAG_SIGMA = 0.17
/** The Presencia averages five years of collars, so the pool is drawn this much tighter. */
const SPREAD = 0.45
/** On the move the stream narrows: the faster, the thinner (km/month). */
const SQUEEZE_KM_PER_MONTH = 30
/** Drop radius, as a share of the Presencia's size. */
const DROP_SIZE = 1.65
/**
 * The Presencia spreads from ~13 km (σ) at the Mara to ~34 km in December, and drawn to scale the
 * Manada swamps the plains. Its size is tamed towards the Mara's: SIZE_POWER of 1 keeps it to
 * scale, 0 makes it the Mara's everywhere. Its shape (long, wide, which way) is kept as it is.
 */
const SIZE_REF_KM = 13
const SIZE_POWER = 0.3
/** The field at the liquid's edge, and the field over which it deepens from there. */
const EDGE = 0.9
const EDGE_FROM = 0.15
const EDGE_FULL = 1.4
/** The field over which the Apiñamiento goes from none to full, and its glow. */
const CROWD_FROM = 2
const CROWD_FULL = 9
const CROWD_GLOW = 0.12
/** How fast the streaks run down the Manada on the move (km a second at full pace). */
const FLOW_KM_PER_S = 1.2
/**
 * The liquid runs out over green, level grass and draws back off slopes and bare ground, so its
 * edge follows the land it crosses: the field is raised to 1 / land, land running from LAND_POOR
 * on bare or steep ground to LAND_RICH on full flush. A power rather than a scale only moves the
 * outskirts: the middle (field 1 and up) stays above the edge, so no stretch of the Manada
 * vanishes over poor ground.
 */
const LAND_POOR = 0.6
const LAND_RICH = 1.2
/**
 * The ground under the liquid is warped by slow noise before the body is traced, so its rim runs
 * in lobes and inlets that drift and change. WARP_KM pooled, eased to WARP_MOVING_KM on the move
 * so the stream is not broken; WARP_SCALE sets how broad the lobes are (smaller is broader).
 */
const WARP_KM = 4
const WARP_MOVING_KM = 1.2
const WARP_SCALE = 0.35
/**
 * The Manada fills a stretch of the Recorrido, from its head CHAIN_HEAD months ahead of the
 * calendar to its tail CHAIN_TAIL behind, traced through CHAIN_POINTS points as one tube. On the
 * move the stretch is as long as the pace makes it and bends with every turn of the way; standing
 * still its points fall on one spot and it pools. Each point is as wide as the Presencia across
 * the way there, times CHAIN_WIDTH, so it narrows where the way funnels to a crossing.
 */
const CHAIN_HEAD = 0.12
const CHAIN_TAIL = 0.45
const CHAIN_POINTS = 13
const CHAIN_WIDTH = 3
/**
 * Pooled, the Presencia and the stretch of the way add up and the rim sits well out; streaming,
 * the stretch is all there is and its middle only just tops the rim. It runs this much deeper on
 * the move so the stream reads about as broad as it is.
 */
const STREAM_DEPTH = 1.8
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
 * NECK_MIN of their width on the river itself.
 */
const NECK_REACH = 30
const NECK_MIN = 0.5
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
 * Viscosity: the waves are the same for every drop, only shifted by FLOW_PHASE radians per sigma
 * of the drop's place in the body. Neighbours move almost as one and a slow swell runs through
 * the Manada from one end to the other, instead of each drop wandering off on its own.
 */
const FLOW_PHASE = 1.1
/**
 * Each drop is dragged by how far its neighbours have moved lately, less its own move, by up to
 * VISCOSITY of the difference. "Lately" is measured from where it was over the last few
 * VISCOUS_MONTHS, the nearer past counting most. Only the motion is shared, so the shape at rest
 * is the same; on the move drops side by side go along together instead of sliding apart.
 */
const VISCOSITY = 0.8
const VISCOUS_MONTHS = 0.1
const VISCOUS_LOOKS = [1, 2, 3, 4, 5, 6]
const VISCOUS_WEIGHTS = (() => {
  const w = VISCOUS_LOOKS.map((k) => Math.exp(-k / 2))
  const total = w.reduce((a, b) => a + b, 0)
  return w.map((v) => v / total)
})()
/**
 * A drop never strays further from its point on the Recorrido than the nearest main river, so
 * none ends up across a river the way has not crossed. Close to a river (a corridor, a bank, a
 * crossing) the Manada draws in: it keeps within BANK of that distance, giving way softly.
 */
const BANK = 0.6
/**
 * Agolpamiento: short of a Cruce the Manada eases to a halt BANK_KM from the river and waits
 * there HOLD_MONTHS of that river at full Caudal (less as the water drops), every drop pooling as
 * it arrives, then sets off again at its usual pace. The time lost is made up at the next stay,
 * where the Manada is standing still anyway, so it never has to rush. The Mara is where it
 * waits; the Grumeti and Mbalageti are crossed almost along their whole course and barely hold
 * it up.
 */
const BANK_KM = 3
const HOLD_MONTHS: Record<string, number> = { Mara: 0.1, Grumeti: 0.02, Mbalageti: 0.02 }
/** How long (months) it takes to slow to a halt on the bank, and to get going again. */
const HOLD_EASE = 0.05
/** Over how long (months) a stay makes up the time, and how far past the river it is looked for. */
const CATCH_UP = 0.5
const STAY_SEARCH = [0.2, 0.6]
/** The way's clock is counted from here (months), where nothing holds it up or makes up time. */
const CLOCK_FROM = 3
/** Crossings of the same river closer than this along the way (months) are one Cruce. */
const SAME_CRUCE = 0.3
/** Draped grid resolution, and the lift that keeps it off the ground (km). */
const GRID = 320
const LIFT = 0.03
/**
 * The grid is coarser than the ground and its Bosquetes, so between its vertices a ridge or a
 * crown can rise above it. Each vertex is drawn this much nearer the camera along its own line of
 * sight (km): it stays put on screen but wins over anything that close behind it.
 */
const PULL = 0.6

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
  const all = Array.from({ length: DROPS }, () => ({
    lag: THREE.MathUtils.clamp(gauss(), -2.3, 2.3) * LAG_SIGMA,
    u: gauss() * 0.8,
    v: gauss() * 0.8,
    wobble: rnd() * Math.PI * 2,
    side: waves(),
    late: waves(),
  }))
  // Centred on the Recorrido and the calendar, so a handful of drops (or one) is not pulled off it.
  const mean = (key: 'lag' | 'u' | 'v') => all.reduce((sum, drop) => sum + drop[key], 0) / DROPS
  const [lag, u, v] = [mean('lag'), mean('u'), mean('v')]
  all.forEach((drop) => Object.assign(drop, { lag: drop.lag - lag, u: drop.u - u, v: drop.v - v }))
  // Shared waves, each running through the body its own way; a seed of their own keeps every
  // drop's starting place as it was.
  const flow = mulberry32(23)
  const heading = () => {
    const a = flow() * Math.PI * 2
    const b = Math.acos(flow() * 2 - 1)
    return [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)]
  }
  const shared = (base: Wave[]) => base.map((w) => ({ ...w, heading: heading() }))
  const side = shared(all[0].side)
  const late = shared(all[0].late)
  const wobble = { phase: flow() * Math.PI * 2, heading: heading() }
  return all.map((drop) => {
    const at = (h: number[]) => FLOW_PHASE * (h[0] * drop.u + h[1] * drop.v + (h[2] * drop.lag) / LAG_SIGMA)
    const along = (waves: typeof side) => waves.map(({ size, phase, heading }) => ({ size, phase: phase + at(heading) }))
    return { ...drop, wobble: wobble.phase + at(wobble.heading), side: along(side), late: along(late) }
  })
}

const uniforms = {
  /** Each drop: x, z, radius (km) and the ground height under it. */
  uDrops: { value: Array.from({ length: DROPS }, () => new THREE.Vector4()) },
  /** Each drop's heading and its radius along it: on the move drops stretch into a stream. */
  uAxes: { value: Array.from({ length: DROPS }, () => new THREE.Vector3(1, 0, 1)) },
  /** Each drop's point on the Recorrido itself (x, z) and radius, in order along the stream. */
  uSpine: { value: Array.from({ length: DROPS }, () => new THREE.Vector3()) },
  /** Each drop's stretch of the way, head to tail: x, z and half-width (km). */
  uChain: { value: Array.from({ length: DROPS * CHAIN_POINTS }, () => new THREE.Vector3()) },
  uOrigin: { value: new THREE.Vector2() },
  uSize: { value: 1 },
  /** How much the Manada is on the move (0 pooled, 1 streaming) and which way. */
  uMotion: { value: 0 },
  uHeading: { value: new THREE.Vector2(0, 1) },
  /** How far the streaks on its surface have run (km). */
  uFlow: { value: 0 },
}

const vertex = /* glsl */ `
${GLSL_COMMON}
uniform vec2 uOrigin;
uniform float uSize;
varying vec2 vWorld;
varying float vHeight;
void main() {
  vec2 xz = uOrigin + uv * uSize;
  vWorld = xz;
  vHeight = heightAt(xz) + ${LIFT.toFixed(3)};
  vec3 world = vec3(xz.x, vHeight, xz.y);
  world += normalize(cameraPosition - world) * ${PULL.toFixed(2)};
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`

const fragment = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uDrops[${DROPS}];
uniform vec3 uAxes[${DROPS}];
uniform vec3 uSpine[${DROPS}];
uniform vec3 uChain[${DROPS * CHAIN_POINTS}];
uniform float uMotion;
uniform vec2 uHeading;
uniform float uFlow;
varying vec2 vWorld;
varying float vHeight;

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

// How far p is from a tube from a to b that thins from ra to rb, in radii squared, and which way
// that grows.
float tube(vec2 p, vec2 a, vec2 b, float ra, float rb, out vec2 away) {
  vec2 ab = b - a;
  float k = clamp(dot(p - a, ab) / max(dot(ab, ab), ra * ra), 0.0, 1.0);
  vec2 d = p - a - ab * k;
  float r2 = pow(mix(ra, rb, k), 2.0);
  away = 2.0 * d / r2;
  return dot(d, d) / r2;
}

void main() {
  float warp = mix(${WARP_KM.toFixed(2)}, ${WARP_MOVING_KM.toFixed(2)}, uMotion);
  vec2 lobes = vWorld * ${WARP_SCALE.toFixed(2)};
  vec2 p = vWorld + warp * vec2(
    tnoise(lobes + vec2(uClock * 0.03, 3.1)) * 0.7 + tnoise(lobes * 2.3 - vec2(5.7, uClock * 0.05)) * 0.3,
    tnoise(lobes + vec2(11.3, -uClock * 0.03)) * 0.7 + tnoise(lobes * 2.3 + vec2(uClock * 0.05, 8.9)) * 0.3
  );
  float field = 0.0;
  vec2 grad = vec2(0.0);
  // Where this point sits relative to the drops around it, so the texture travels with them.
  vec2 local = vec2(0.0);
  float near = 0.0;
  for (int i = 0; i < ${DROPS}; i++) {
    vec2 d = p - uDrops[i].xy;
    vec2 t = uAxes[i].xy;
    vec2 n = vec2(-t.y, t.x);
    float ra2 = uAxes[i].z * uAxes[i].z;
    float r2 = uDrops[i].z * uDrops[i].z;
    float a = dot(d, t);
    float b = dot(d, n);
    float spread = a * a / ra2 + b * b / r2;
    // Far and wide, so the texture keeps to the drop all down its body.
    float wl = exp(-spread * 0.05);
    local += (d + vec2(float(i) * 37.1, float(i) * 17.3)) * wl;
    near += wl;
    if (spread > 6.0) continue;
    // Only pooled: on the move the stretch of the way is the whole body.
    float w = exp(-spread) * (1.0 - uMotion);
    field += w;
    grad -= 2.0 * (t * a / ra2 + n * b / r2) * w;
  }
  // Spine along the Recorrido, and each drop's stretch of the way as one tube round the nearest
  // of its points, so it bends smoothly with the way instead of beading where the points meet.
  for (int i = 0; i < ${DROPS}; i++) {
    float best = 1e9;
    vec2 bestAway = vec2(0.0);
    for (int k = 0; k + 1 < ${CHAIN_POINTS}; k++) {
      vec3 a = uChain[i * ${CHAIN_POINTS} + k];
      vec3 b = uChain[i * ${CHAIN_POINTS} + k + 1];
      vec2 away;
      float s = tube(p, a.xy, b.xy, a.z, b.z, away);
      if (s < best) {
        best = s;
        bestAway = away;
      }
    }
    if (best < 6.0) {
      float w = exp(-best) * mix(1.0, ${STREAM_DEPTH.toFixed(2)}, uMotion);
      field += w;
      grad -= bestAway * w;
    }
    if (i + 1 < ${DROPS}) {
      field += thread(p, uSpine[i], uSpine[i + 1], min(uSpine[i].z, uSpine[i + 1].z) * 0.55, grad);
    }
  }
  float lush = greenOf(verdor(vWorld, 0.5));
  vec2 slope = vec2(heightAt(vWorld + vec2(1.5, 0.0)) - heightAt(vWorld - vec2(1.5, 0.0)), heightAt(vWorld + vec2(0.0, 1.5)) - heightAt(vWorld - vec2(0.0, 1.5))) / 3.0;
  float steep = smoothstep(0.04, 0.2, length(slope));
  float land = mix(${LAND_POOR.toFixed(2)}, ${LAND_RICH.toFixed(2)}, lush * (1.0 - steep));
  float tamed = pow(max(field, 1e-6), 1.0 / land);
  grad *= tamed / max(field, 1e-6) / land;
  field = tamed;

  // A clean rim, only antialiased; inside it the liquid runs deeper towards the middle.
  float aa = fwidth(field);
  float edge = smoothstep(${EDGE.toFixed(2)} - aa, ${EDGE.toFixed(2)} + aa, field);
  float body = smoothstep(${EDGE_FROM.toFixed(2)}, ${EDGE_FULL.toFixed(2)}, field);
  float alpha = edge * 0.9;
  if (alpha < 0.005) discard;
  // At a third of the distance, so swirls and streaks stay broad across the body.
  local *= 0.33 / max(near, 1e-6);

  // On the move streaks run back down the Manada from its head, faster down its middle than at its
  // edges, as in a river; pooled they slow to a lazy swirl.
  vec2 across = vec2(-uHeading.y, uHeading.x);
  vec2 run = vec2(dot(local, uHeading), dot(local, across));
  float shear = uFlow * (0.4 + 0.6 * body);
  vec2 streakAt = vec2(run.x * 0.5 + shear, run.y * 2.5);
  vec2 swirlAt = local * 0.6 + vec2(uClock * 0.05, -uClock * 0.04);
  float streak = mix(tnoise(swirlAt), tnoise(streakAt), uMotion);
  float ahead = mix(tnoise(swirlAt + vec2(0.4, 0.0)), tnoise(streakAt + vec2(0.4, 0.0)), uMotion);
  float aside = mix(tnoise(swirlAt + vec2(0.0, 0.4)), tnoise(streakAt + vec2(0.0, 0.4)), uMotion);
  vec2 ripple = ((ahead - streak) * mix(vec2(1.0, 0.0), uHeading, uMotion) + (aside - streak) * mix(vec2(0.0, 1.0), across, uMotion)) * body * body;

  // The surface bulges a little where the liquid runs deep, and ripples, so the sun models it.
  vec3 normal = normalize(vec3(-grad.x * 0.6 - ripple.x * 1.5, 1.0, -grad.y * 0.6 - ripple.y * 1.5));
  // Apiñamiento: the more drops pile up on a point, the more packed the Manada is there.
  float crowd = smoothstep(${CROWD_FROM.toFixed(1)}, ${CROWD_FULL.toFixed(1)}, field);
  // Pooled it packs warm round its middle; streaming it runs dark and thin.
  float pooled = (1.0 - uMotion) * smoothstep(0.6, 2.6, field);
  crowd = max(crowd, pooled);
  float grain = tnoise(local * 3.0) * 0.5 + tnoise(local * 9.0) * 0.3;
  vec3 albedo = mix(vec3(0.2, 0.16, 0.12), vec3(0.38, 0.2, 0.08), crowd);
  albedo = mix(albedo, vec3(0.13, 0.1, 0.08), uMotion * 0.6);
  albedo *= 1.0 + grain * 0.18 + streak * 0.35 * uMotion;
  vec3 lit = sunlight(srgb(albedo), normal, cloudShadow(vWorld));
  // Packed tight it glows a little on top of the light, so the crowd reads even in shadow.
  lit += srgb(vec3(0.62, 0.3, 0.08)) * crowd * crowd * ${CROWD_GLOW.toFixed(2)} * body;
  // Wet: the sun glints off it.
  vec3 view = normalize(cameraPosition - vec3(vWorld.x, vHeight, vWorld.y));
  float glint = pow(max(dot(normal, normalize(uSunDir + view)), 0.0), 60.0);
  lit += srgb(vec3(1.0, 0.85, 0.65)) * glint * 0.35 * body * (1.0 - cloudShadow(vWorld));
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

/** Each sample after which the way steps over a main river, that river and the stretch of it crossed. */
function crossingsOf(recorrido: [number, number][], rivers: RiverLine[]) {
  const n = recorrido.length
  const segments = rivers.filter((r) => r.kind === 'main').flatMap((r) => r.points.slice(1).map((q, k) => ({ a: r.points[k], b: q, river: r.name })))
  const found: { i: number; river: string; a: [number, number]; b: [number, number] }[] = []
  for (let i = 0; i < n; i++) {
    const a = recorrido[i]
    const b = recorrido[(i + 1) % n]
    if (a[0] === b[0] && a[1] === b[1]) continue
    const [x0, x1, z0, z1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]
    const hit = segments.find(
      ({ a: c, b: d }) =>
        Math.max(c[0], d[0]) >= x0 && Math.min(c[0], d[0]) <= x1 && Math.max(c[1], d[1]) >= z0 && Math.min(c[1], d[1]) <= z1 && crosses(a, b, c, d),
    )
    if (hit) found.push({ i, ...hit })
  }
  return found
}

/** How far along the way (km, wrapping round the year) each sample is from the nearest main river crossing. */
function necks(recorrido: [number, number][], rivers: RiverLine[]) {
  const n = recorrido.length
  const km = [0]
  for (let i = 1; i <= n; i++) km.push(km[i - 1] + Math.hypot(recorrido[i % n][0] - recorrido[i - 1][0], recorrido[i % n][1] - recorrido[i - 1][1]))
  const loop = km[n]
  const crossings = crossingsOf(recorrido, rivers).map(({ i }) => (km[i] + km[i + 1]) / 2)
  return km.slice(0, n).map((at) => {
    const gap = Math.min(Infinity, ...crossings.map((c) => Math.min(Math.abs(at - c), loop - Math.abs(at - c))))
    return THREE.MathUtils.smoothstep(gap, 0, NECK_REACH)
  })
}

/** 0 to 1 and back over `ease`, with `flat` of 1 in between: how hard the way is held at a moment. */
function plateau(x: number, flat: number, ease: number) {
  if (x <= 0 || x >= flat + 2 * ease) return 0
  if (x < ease) return (1 - Math.cos((Math.PI * x) / ease)) / 2
  if (x <= flat + ease) return 1
  return (1 + Math.cos((Math.PI * (x - flat - ease)) / ease)) / 2
}

/**
 * The way retimed for the Agolpamientos. Positions are untouched; only when the Manada is at each
 * one changes.
 */
function agolpar(recorrido: [number, number][], samplesPerMonth: number, rivers: RiverLine[]) {
  const n = recorrido.length
  const room = rooms(recorrido, rivers)
  const pace = recorrido.map(([x, z], i) => {
    const [px, pz] = recorrido[(i + 1) % n]
    return Math.hypot(px - x, pz - z) * samplesPerMonth
  })
  // How fast the way's own clock runs through each sample: 0 while held, above 1 while catching up.
  const rate = new Float64Array(n).fill(1)
  let last: { i: number; river: string } | null = null
  for (const c of crossingsOf(recorrido, rivers)) {
    if (last && last.river === c.river && (c.i - last.i) / samplesPerMonth < SAME_CRUCE) continue
    last = c
    const full = HOLD_MONTHS[c.river]
    if (!full) continue
    // Back along the way to where the river is BANK_KM off, no further than a Cruce apart.
    let j = c.i
    while (j > c.i - SAME_CRUCE * samplesPerMonth && room[((j % n) + n) % n] < BANK_KM) j--
    const lost = full * stageAt(CAUDAL[c.river], j / samplesPerMonth)
    // Eases to a halt and off again; the halt plus half of each ease is the time lost. Easing in
    // carries the way on half the ease, so it starts slowing that much short of the bank.
    const ease = Math.min(HOLD_EASE, lost)
    const flat = lost - ease
    const span = flat + 2 * ease
    const from = j - Math.round((ease / 2) * samplesPerMonth)
    for (let k = 0; k <= span * samplesPerMonth; k++) {
      const s = (((from + k) % n) + n) % n
      rate[s] -= plateau(k / samplesPerMonth, flat, ease)
    }
    // Made up where the way is stillest soon after the river, as a gentle bump in the clock's
    // pace. Running late, the Manada gets there `lost` after the calendar would.
    let stay = c.i + Math.round(STAY_SEARCH[0] * samplesPerMonth)
    for (let k = stay; k <= c.i + STAY_SEARCH[1] * samplesPerMonth; k++) if (pace[k % n] < pace[stay % n]) stay = k
    const width = CATCH_UP * samplesPerMonth
    for (let k = 0; k <= width; k++) {
      const s = (stay + Math.round(lost * samplesPerMonth) + k) % n
      rate[s] += (lost / CATCH_UP) * (1 - Math.cos((2 * Math.PI * k) / width))
    }
  }
  // Integrate the clock, then read the old way at the new time.
  const clock = new Float64Array(n)
  const origin = CLOCK_FROM * samplesPerMonth
  clock[origin] = CLOCK_FROM
  for (let k = 1; k < n; k++) {
    const i = (origin + k) % n
    const prev = (i - 1 + n) % n
    clock[i] = clock[prev] + Math.max(0, rate[prev]) / samplesPerMonth
  }
  // Holds and catch-ups only cancel out to within a sample, so the clock is stretched to close
  // the year exactly; otherwise the Manada jumps where it comes back round to CLOCK_FROM.
  const end = (origin + n - 1) % n
  const year = clock[end] + Math.max(0, rate[end]) / samplesPerMonth - CLOCK_FROM
  for (let i = 0; i < n; i++) clock[i] = CLOCK_FROM + ((clock[i] - CLOCK_FROM) * 12) / year
  const at = (time: number) => {
    const f = (((time * samplesPerMonth) % n) + n) % n
    const i = Math.floor(f)
    const [ax, az] = recorrido[i]
    const [bx, bz] = recorrido[(i + 1) % n]
    return [ax + (bx - ax) * (f - i), az + (bz - az) * (f - i)] as [number, number]
  }
  return Array.from(clock, at)
}

/** The Recorrido blurred over time, wrapping round the year, then held up at its Cruces. */
function rounded(bake: FaunaBake, rivers: RiverLine[]): Way {
  const pts = bake.recorrido
  const n = pts.length
  const sigma = ROUND_MONTHS * bake.samplesPerMonth
  const reach = Math.ceil(sigma * 3)
  const weights = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-0.5 * ((k - reach) / sigma) ** 2))
  const total = weights.reduce((a, b) => a + b, 0)
  const blurred = pts.map((_, i) => {
    let x = 0
    let z = 0
    weights.forEach((w, k) => {
      const [px, pz] = pts[(((i + k - reach) % n) + n) % n]
      x += px * w
      z += pz * w
    })
    return [x / total, z / total] as [number, number]
  })
  const recorrido = agolpar(blurred, bake.samplesPerMonth, rivers)
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
  const [xx, xz, zz] = formaAt(bake.forma, t)
  const geo = Math.sqrt(Math.sqrt(Math.max(xx * zz - xz * xz, 1e-6)))
  const tame = Math.pow(geo / SIZE_REF_KM, SIZE_POWER - 1)
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
    size: geo * tame * (SPREAD / (1 + pace / SQUEEZE_KM_PER_MONTH)) * DROP_SIZE,
    forma: [xx, xz, zz],
    half: across * squeeze * tame,
  }
}

function place(bake: Way, hf: Heightfield, all: Drop[], month: number, clock: number) {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  let biggest = 0
  let motion = 0
  let headX = 0
  let headZ = 0
  const spine: { lag: number; x: number; z: number; r: number }[] = []
  const now = all.map((drop) => {
    const lag = lagAt(drop, month)
    const here = spot(bake, drop, month + lag, clock)
    // The stream tapers towards its head and tail.
    const taper = 1 - 0.45 * Math.min(1, Math.abs(lag) / (2.3 * LAG_SIGMA))
    let thenX = 0
    let thenZ = 0
    VISCOUS_LOOKS.forEach((k, n) => {
      const before = month - (k * VISCOUS_MONTHS) / 2
      const then = spot(bake, drop, before + lagAt(drop, before), clock)
      thenX += then.x * VISCOUS_WEIGHTS[n]
      thenZ += then.z * VISCOUS_WEIGHTS[n]
    })
    return { lag, here, r: Math.max(0.6, here.size * taper), moveX: here.x - thenX, moveZ: here.z - thenZ }
  })
  all.forEach((drop, i) => {
    const { lag, here, r } = now[i]
    const t = month + lag
    let pullX = 0
    let pullZ = 0
    let weight = 0
    now.forEach((other, j) => {
      if (j === i) return
      const reach = r + other.r
      const w = Math.exp(-((other.here.x - here.x) ** 2 + (other.here.z - here.z) ** 2) / (reach * reach))
      pullX += (other.moveX - now[i].moveX) * w
      pullZ += (other.moveZ - now[i].moveZ) * w
      weight += w
    })
    // A drop alone has nothing to drag it; one in the thick of the others goes with them.
    const dx = (pullX * VISCOSITY) / (weight + 1)
    const dz = (pullZ * VISCOSITY) / (weight + 1)
    const { tx, tz, pace, sx, sz, forma } = here
    const x = here.x + dx
    const z = here.z + dz
    // Head to tail; the head comes round and the tail thins out as it drains.
    const chain = Array.from({ length: CHAIN_POINTS }, (_, k) => {
      const along = k / (CHAIN_POINTS - 1)
      const at = spot(bake, drop, t + CHAIN_HEAD - along * (CHAIN_HEAD + CHAIN_TAIL), clock)
      const shape = Math.max(0.3, Math.sqrt(Math.min(1, along / 0.25))) * (1 - 0.65 * along)
      return [at.x + dx, at.z + dz, at.half * CHAIN_WIDTH * shape]
    })
    // Pooled it takes the Presencia's own shape, long where the herd spreads out along the land.
    const [xx, xz, zz] = forma
    const turn = 0.5 * Math.atan2(2 * xz, xx - zz)
    const mean = (xx + zz) / 2
    const half = Math.sqrt(((xx - zz) / 2) ** 2 + xz ** 2)
    const long = Math.sqrt(Math.sqrt((mean + half) / Math.max(mean - half, 1e-6)))
    let [px, pz] = [Math.cos(turn), Math.sin(turn)]
    if (px * tx + pz * tz < 0) [px, pz] = [-px, -pz]
    const lane = THREE.MathUtils.smoothstep(pace, LANE_FROM, LANE_FULL)
    const along = r * long
    uniforms.uDrops.value[i].set(x, z, r / long, hf.heightAt(x, z))
    uniforms.uAxes.value[i].set(px, pz, along)
    spine.push({ lag, x: sx, z: sz, r })
    chain.forEach(([cx, cz, cr], k) => uniforms.uChain.value[i * CHAIN_POINTS + k].set(cx, cz, cr))
    for (const [px, pz, pr] of [[x, z, along], ...chain]) {
      minX = Math.min(minX, px)
      minZ = Math.min(minZ, pz)
      maxX = Math.max(maxX, px)
      maxZ = Math.max(maxZ, pz)
      biggest = Math.max(biggest, pr)
    }
    motion += lane / DROPS
    headX += tx
    headZ += tz
  })
  uniforms.uMotion.value = motion
  if (Math.hypot(headX, headZ) > 1e-6) uniforms.uHeading.value.set(headX, headZ).normalize()
  // Drops overtake one another, so the spine is threaded in their order along the stream now.
  spine.sort((a, b) => a.lag - b.lag).forEach((s, k) => uniforms.uSpine.value[k].set(s.x, s.z, s.r))
  // Past ~2.5 radii a drop adds nothing (the shader skips it), so that is all the margin needed.
  const size = Math.max(maxX - minX, maxZ - minZ) + 2 * 2.5 * biggest
  uniforms.uOrigin.value.set((minX + maxX) / 2 - size / 2, (minZ + maxZ) / 2 - size / 2)
  uniforms.uSize.value = size
}

/**
 * The Avalanchas of the Mara: where the way, held up and all, steps over it, and when each drop
 * gets there, the head first and the tail last.
 */
function avalanchasOf(way: Way, rivers: RiverLine[], all: Drop[]): Avalancha[] {
  const spm = way.samplesPerMonth
  const found: Avalancha[] = []
  let last = -Infinity
  for (const { i, river, a, b } of crossingsOf(way.recorrido, rivers)) {
    if (river !== 'Mara' || (i - last) / spm < SAME_CRUCE) continue
    last = i
    const [px, pz] = way.recorrido[i]
    const [qx, qz] = way.recorrido[(i + 1) % way.recorrido.length]
    // Where the step meets the river, along both.
    const [rx, rz] = [b[0] - a[0], b[1] - a[1]]
    const cross = (qx - px) * rz - (qz - pz) * rx
    const k = ((a[0] - px) * rz - (a[1] - pz) * rx) / cross
    const month = (i + k) / spm
    const length = Math.hypot(rx, rz)
    found.push({
      x: px + (qx - px) * k,
      z: pz + (qz - pz) * k,
      tx: rx / length,
      tz: rz / length,
      caudal: stageAt(CAUDAL.Mara, month),
      when: (rnd) => {
        const drop = all[Math.floor(rnd() * all.length)]
        return month - lagAt(drop, month - drop.lag)
      },
    })
  }
  return found
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

  useFrame((_, delta) => {
    place(bake, hf, all, useStore.getState().month, shared.uClock.value)
    uniforms.uFlow.value += delta * uniforms.uMotion.value * FLOW_KM_PER_S
  })

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

  const avalanchas = useMemo(() => avalanchasOf(bake, hf.rivers, all), [bake, hf.rivers, all])

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      <Partos onMancha={onMancha} />
      <Bajas avalanchas={avalanchas} onMancha={onMancha} />
      {SHOW_RECORRIDO && <RecorridoLine bake={bake} hf={hf} />}
    </>
  )
}
