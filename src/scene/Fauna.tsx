import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFauna, type FaunaBake } from '../fauna'
import { CAUDAL, MAP } from '../geo'
import { stageAt } from '../shaders/rivers'
import { GLSL_COMMON, shared } from '../shaders/common'
import { BROCHAZO_GLSL, CellPass } from '../shaders/brochazos'
import { mulberry32, useHeightfield, type RiverLine } from '../terrain'
import { useStore } from '../store'

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
/** The field at the body's edge. */
const EDGE = 0.9
/**
 * Each Brochazo joins the Mancha at its own field, up to STAGGER either side of EDGE, all at once,
 * so the edge sweeping across the Mapa takes the Brochazos one by one and stays grainy.
 */
const STAGGER = 0.35
/** The Mancha's wobble and lobes come round this many times a year, so they close the year too. */
const WOBBLES_PER_YEAR = 2
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
const WARP_MOVING_KM = 3.5
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
 * The width across the way follows the line the way runs along, so the whole body changes shape
 * when it turns. Setting off from a stay it swings from the pool's facing to the way out; that
 * swing is spread over this many months (one sigma) so the body reshapes gently, however fast it
 * sets off.
 */
const TURN_MONTHS = 0.12
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

/**
 * One Mancha per species, all in one field, so they run together where they meet and part where
 * their ways do. The zebras keep the wildebeest's way mixed into its head, about a day (`ahead`,
 * months) in front, cropping the long grass first; the gazelles keep a shorter way of their own.
 * Each is drawn to its share of the head count (millions; area goes with numbers, so size with the
 * square root). Each Brochazo the Mancha takes goes to one species, picked by the species' share of
 * the animals there, and is repainted in its colour.
 */
export const ESPECIES = [
  { name: 'ñu', count: 1.3, ahead: 0 },
  { name: 'cebra', count: 0.2, ahead: 0.025 },
  { name: 'gacela', count: 0.35, ahead: 0 },
] as const
const HEAD_COUNT = ESPECIES.reduce((sum, e) => sum + e.count, 0)
const SLOTS = DROPS * ESPECIES.length

const uniforms = {
  /** Each drop of every species: x, z and radius (km). */
  uDrops: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3()) },
  /** Each drop's heading and its radius along it: on the move drops stretch into a stream. */
  uAxes: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3(1, 0, 1)) },
  /** Each drop's point on the Recorrido itself (x, z) and radius, in order along the stream. */
  uSpine: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3()) },
  /** Each drop's stretch of the way, head to tail: x, z and half-width (km). */
  uChain: { value: Array.from({ length: SLOTS * CHAIN_POINTS }, () => new THREE.Vector3()) },
  uOrigin: { value: new THREE.Vector2() },
  uSize: { value: 1 },
  /** How much each drop is on the move (0 pooled, 1 streaming). */
  uMotion: { value: Array.from({ length: SLOTS }, () => 0) },
  /** Each species' head count (millions). */
  uHeads: { value: ESPECIES.map((e) => e.count) },
  /** Where the Manada can be at all (r: the ground the collars reach, off the Lagos) and which bank of the Mara it is (g). */
  uGround: { value: null as THREE.Texture | null },
  uGroundSize: { value: new THREE.Vector3() },
  /** Which bank of the Mara each drop is on, and each point of its stretch of the way. */
  uDropBank: { value: Array.from({ length: SLOTS }, () => 0) },
  uChainBank: { value: Array.from({ length: SLOTS * CHAIN_POINTS }, () => 0) },
}

/**
 * Per Brochazo cell of the Mapa, how much of it the Mancha has painted: its colour runs along the
 * Brochazo from r to g (0 its start, 1 its end), and it goes to the species b, a and what is left.
 */
export const mancha = { uMancha: { value: null as THREE.Texture | null } }

/** How long (s) the brush takes to sweep the Mancha's colour along a Brochazo, or the ground's back over it. */
const PAINT_SECONDS = 0.6

const FIELD = /* glsl */ `
${GLSL_COMMON}
uniform vec3 uDrops[${SLOTS}];
uniform vec3 uAxes[${SLOTS}];
uniform vec3 uSpine[${SLOTS}];
uniform vec3 uChain[${SLOTS * CHAIN_POINTS}];
uniform float uMotion[${SLOTS}];
uniform float uHeads[${ESPECIES.length}];
uniform sampler2D uGround;
uniform vec3 uGroundSize;
uniform float uDropBank[${SLOTS}];
uniform float uChainBank[${SLOTS * CHAIN_POINTS}];

vec2 groundAt(vec2 world) { return texture2D(uGround, ((world - uMapMin) / uGroundSize.z + 0.5) / uGroundSize.xy).rg; }

// A thread of liquid from a to b. At its centre line it always reaches 1, above the surface.
float thread(vec2 p, vec3 a, vec3 b, float r) {
  vec2 ab = b.xy - a.xy;
  float k = clamp(dot(p - a.xy, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec2 d = p - a.xy - ab * k;
  float d2 = dot(d, d);
  float r2 = r * r;
  if (d2 > r2 * 6.0) return 0.0;
  return exp(-d2 / r2);
}

// How far p is from a tube from a to b that thins from ra to rb, in radii squared.
float tube(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 ab = b - a;
  float k = clamp(dot(p - a, ab) / max(dot(ab, ab), ra * ra), 0.0, 1.0);
  vec2 d = p - a - ab * k;
  float r2 = pow(mix(ra, rb, k), 2.0);
  return dot(d, d) / r2;
}

// How much of the Manada there is at world, and how much of it each species brings.
float fieldAt(vec2 world, inout float own[${ESPECIES.length}]) {
  // How much the liquid here is on the move, from the drops nearby.
  float moving = 0.0;
  float nearby = 1e-6;
  for (int i = 0; i < ${SLOTS}; i++) {
    vec2 d = world - uDrops[i].xy;
    float reach = max(uAxes[i].z, uDrops[i].z) * 3.0;
    float w = exp(-dot(d, d) / (reach * reach));
    moving += uMotion[i] * w;
    nearby += w;
  }
  moving /= nearby;
  float warp = mix(${WARP_KM.toFixed(2)}, ${WARP_MOVING_KM.toFixed(2)}, moving);
  vec2 lobes = world * ${WARP_SCALE.toFixed(2)};
  // The lobes drift with the calendar, round a loop that closes at the end of the year.
  float turn = uMonth * ${((2 * Math.PI) / 12).toFixed(5)};
  vec2 slow = 0.29 * vec2(cos(turn), sin(turn));
  vec2 fast = 0.48 * vec2(cos(turn), sin(turn));
  vec2 p = world + warp * vec2(
    tnoise(lobes + vec2(slow.x, 3.1 + slow.y)) * 0.7 + tnoise(lobes * 2.3 - vec2(5.7 + fast.y, fast.x)) * 0.3,
    tnoise(lobes + vec2(11.3 + slow.y, -slow.x)) * 0.7 + tnoise(lobes * 2.3 + vec2(fast.x, 8.9 + fast.y)) * 0.3
  );
  // The Mara cuts the Manada: a drop takes only its own bank of it, and a stretch of the way only
  // the banks its ends are on, so it spills across only where it crosses. Taken on the ground, not
  // the warped body, so the cut runs along the river itself.
  vec2 ground = groundAt(world);
  float field = 0.0;
  for (int i = 0; i < ${SLOTS}; i++) {
    if (abs(ground.g - uDropBank[i]) > 0.5) continue;
    vec2 d = p - uDrops[i].xy;
    vec2 t = uAxes[i].xy;
    vec2 n = vec2(-t.y, t.x);
    float ra2 = uAxes[i].z * uAxes[i].z;
    float r2 = uDrops[i].z * uDrops[i].z;
    float a = dot(d, t);
    float b = dot(d, n);
    float spread = a * a / ra2 + b * b / r2;
    if (spread > 6.0) continue;
    // Only pooled: on the move the stretch of the way is the whole body.
    float w = exp(-spread) * (1.0 - uMotion[i]);
    field += w;
    own[i / ${DROPS}] += w;
  }
  // Spine along the Recorrido, and each drop's stretch of the way as one tube round the nearest
  // of its points, so it bends smoothly with the way instead of beading where the points meet.
  for (int i = 0; i < ${SLOTS}; i++) {
    float best = 1e9;
    for (int k = 0; k + 1 < ${CHAIN_POINTS}; k++) {
      if (min(abs(ground.g - uChainBank[i * ${CHAIN_POINTS} + k]), abs(ground.g - uChainBank[i * ${CHAIN_POINTS} + k + 1])) > 0.5) continue;
      vec3 a = uChain[i * ${CHAIN_POINTS} + k];
      vec3 b = uChain[i * ${CHAIN_POINTS} + k + 1];
      best = min(best, tube(p, a.xy, b.xy, a.z, b.z));
    }
    float w = 0.0;
    if (best < 6.0) w += exp(-best) * mix(1.0, ${STREAM_DEPTH.toFixed(2)}, uMotion[i]);
    // Threaded only within a species: two Manchas join where they touch, not along a spine.
    if ((i + 1) % ${DROPS} != 0) {
      w += thread(p, uSpine[i], uSpine[i + 1], min(uSpine[i].z, uSpine[i + 1].z) * 0.55);
    }
    field += w;
    own[i / ${DROPS}] += w;
  }
  float lush = greenOf(verdor(world, 0.5));
  vec2 slope = vec2(heightAt(world + vec2(1.5, 0.0)) - heightAt(world - vec2(1.5, 0.0)), heightAt(world + vec2(0.0, 1.5)) - heightAt(world - vec2(0.0, 1.5))) / 3.0;
  float steep = smoothstep(0.04, 0.2, length(slope));
  float land = mix(${LAND_POOR.toFixed(2)}, ${LAND_RICH.toFixed(2)}, lush * (1.0 - steep));
  field = pow(max(field, 1e-6), 1.0 / land);
  // Pinned to the ground rather than the warped body: where the collars never go, the Mancha doesn't.
  field *= ground.r;
  return field;
}
`

/**
 * Whether the Mancha has each Brochazo, from its field now, and which species takes it. Worked out
 * afresh every frame from the moment of the year alone, so scrubbing the Timeline lands on the same
 * Brochazos as playing up to it.
 */
const stepFragment = /* glsl */ `
${FIELD}
${BROCHAZO_GLSL}
uniform vec2 uOrigin;
uniform float uSize;
void main() {
  vec2 id = CELLS_MIN + floor(gl_FragCoord.xy);
  vec2 at = brochazoAt(id);
  // Off the quad there is no Manada.
  vec2 inside = (at - uOrigin) / uSize;
  if (min(inside.x, inside.y) < 0.0 || max(inside.x, inside.y) > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float own[${ESPECIES.length}];
  for (int s = 0; s < ${ESPECIES.length}; s++) own[s] = 0.0;
  float field = fieldAt(at, own);
  float on = (hash12(id + 5.3) - 0.5) * ${(2 * STAGGER).toFixed(2)};
  if (field < ${EDGE.toFixed(2)} + on) {
    gl_FragColor = vec4(0.0);
    return;
  }
  // Its species, drawn by each one's share of the animals there; blended across a short band of
  // shares so it doesn't flicker between two where they're even. Every Mancha is as thick at its
  // middle whatever its numbers (it is their area that goes with them), so where they overlap
  // each one's field counts for its head count.
  for (int s = 0; s < ${ESPECIES.length}; s++) own[s] *= uHeads[s];
  float owned = 1e-6;
  for (int s = 0; s < ${ESPECIES.length}; s++) owned += own[s];
  float pick = hash12(id + 43.1);
  float kind[${ESPECIES.length}];
  float from = 0.0;
  for (int s = 0; s < ${ESPECIES.length}; s++) {
    float to = from + own[s] / owned;
    float lo = s == 0 ? -1.0 : from;
    float hi = s == ${ESPECIES.length - 1} ? 2.0 : to;
    kind[s] = smoothstep(lo - 0.08, lo + 0.08, pick) - smoothstep(hi - 0.08, hi + 0.08, pick);
    from = to;
  }
  gl_FragColor = vec4(1.0, kind[0], kind[1], kind[2]);
}
`

/**
 * The Mancha's colour is not swapped in, it is painted: on a Brochazo the Mancha takes, the brush
 * sweeps it along from start to end; on one it leaves, the ground is swept back over it the same
 * way. It keeps the species it was painted in until the ground has covered it.
 */
const paintFragment = /* glsl */ `
${GLSL_COMMON}
uniform sampler2D uTaken;
uniform sampler2D uPainted;
uniform float uStroke;
void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 taken = texelFetch(uTaken, texel, 0);
  vec4 was = texelFetch(uPainted, texel, 0);
  float stroke = uStroke * mix(0.7, 1.3, hash12(gl_FragCoord.xy + 17.9));
  if (taken.r > 0.5) {
    gl_FragColor = vec4(max(was.r - stroke, 0.0), min(was.g + stroke, 1.0), taken.g, taken.b);
    return;
  }
  float from = was.r + stroke;
  gl_FragColor = from >= was.g ? vec4(0.0) : vec4(from, was.g, was.ba);
}
`

/**
 * The Recorrido as the Manada follows it and, at each sample, how open it is (1 away from the
 * rivers) and which way it faces (unit x, z).
 */
type Way = FaunaBake & { neck: number[]; facing: [number, number][]; heading: [number, number][]; room: number[] }

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
  const facing = facings({ ...bake, recorrido })
  return {
    ...bake,
    recorrido,
    neck: necks(recorrido, rivers),
    facing,
    heading: headings({ ...bake, recorrido }, facing),
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

/**
 * The line the way runs along at each sample, as a doubled angle (cos 2θ, sin 2θ): still, the
 * velocity left is noise pointing anywhere, so below a walk the pool's facing rules. Blurred over
 * the year so the turn between them is gentle. A line, not a direction, so setting off back the
 * way it came (as from the Mara) is no turn at all rather than a swing through the side.
 */
function headings(bake: FaunaBake, facing: [number, number][]) {
  const spm = bake.samplesPerMonth
  const n = bake.recorrido.length
  const raw = bake.recorrido.map((_, i) => {
    const [vx, vz] = velocityAt(bake, i / spm)
    const pace = Math.hypot(vx, vz)
    const [dx, dz] = pace > LANE_FROM ? [vx / pace, vz / pace] : facing[i]
    return [dx * dx - dz * dz, 2 * dx * dz]
  })
  const sigma = TURN_MONTHS * spm
  const reach = Math.ceil(sigma * 3)
  return raw.map((_, i) => {
    let x = 0
    let z = 0
    for (let k = -reach; k <= reach; k++) {
      const w = Math.exp(-0.5 * (k / sigma) ** 2)
      const [dx, dz] = raw[(((i + k) % n) + n) % n]
      x += dx * w
      z += dz * w
    }
    const l = Math.hypot(x, z) || 1
    return [x / l, z / l] as [number, number]
  })
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

function directionAt(way: Way, samples: [number, number][], month: number): [number, number] {
  const [a, b, w] = sampleAt(way, samples, month)
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
function spot(bake: Way, drop: Drop, t: number, calendar: number, open = neckAt(bake, t)) {
  // Every drop runs the same way, just earlier or later: its place is the Recorrido itself.
  const [sx, sz] = recorridoAt(bake, t)
  const [vx, vz] = velocityAt(bake, t)
  const pace = Math.hypot(vx, vz)
  const [fx, fz] = directionAt(bake, bake.facing, t)
  // Back from the doubled angle to the line, pointed the way the Manada is going.
  const [cx, cz] = directionAt(bake, bake.heading, t)
  const angle = Math.atan2(cz, cx) / 2
  const [ox0, oz0] = pace > LANE_FROM ? [vx, vz] : [fx, fz]
  const sense = Math.cos(angle) * ox0 + Math.sin(angle) * oz0 < 0 ? -1 : 1
  const tx = Math.cos(angle) * sense
  const tz = Math.sin(angle) * sense
  const squeeze = (SPREAD / (1 + pace / SQUEEZE_KM_PER_MONTH)) * (NECK_MIN + (1 - NECK_MIN) * open)
  const [xx, xz, zz] = formaAt(bake.forma, t)
  const geo = Math.sqrt(Math.sqrt(Math.max(xx * zz - xz * xz, 1e-6)))
  const tame = Math.pow(geo / SIZE_REF_KM, SIZE_POWER - 1)
  const wobble = (2 * Math.PI * WOBBLES_PER_YEAR * calendar) / 12
  const u = drop.u + 0.08 * Math.sin(wobble + drop.wobble)
  const v = drop.v + 0.08 * Math.cos(wobble + drop.wobble * 1.7)
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

/** Which bank of the Mara a point is on, 0 or 1. */
function bankAt(ground: FaunaBake['ground'], x: number, z: number) {
  const ix = THREE.MathUtils.clamp(Math.round((x - MAP.minX) / ground.step), 0, ground.nx - 1)
  const iz = THREE.MathUtils.clamp(Math.round((z - MAP.minZ) / ground.step), 0, ground.nz - 1)
  return ground.data[(iz * ground.nx + ix) * 2 + 1] / 255
}

function place(bake: Way, ground: FaunaBake['ground'], all: Drop[], month: number, calendar: number, especie: number) {
  const scale = Math.sqrt(ESPECIES[especie].count / HEAD_COUNT)
  const slot = especie * DROPS
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  let biggest = 0
  const spine: { lag: number; x: number; z: number; r: number }[] = []
  const now = all.map((drop) => {
    const lag = lagAt(drop, month)
    const here = spot(bake, drop, month + lag, calendar)
    // The stream tapers towards its head and tail.
    const taper = 1 - 0.45 * Math.min(1, Math.abs(lag) / (2.3 * LAG_SIGMA))
    let thenX = 0
    let thenZ = 0
    VISCOUS_LOOKS.forEach((k, n) => {
      const before = month - (k * VISCOUS_MONTHS) / 2
      const then = spot(bake, drop, before + lagAt(drop, before), calendar)
      thenX += then.x * VISCOUS_WEIGHTS[n]
      thenZ += then.z * VISCOUS_WEIGHTS[n]
    })
    return { lag, here, r: Math.max(0.6, here.size * taper * scale), moveX: here.x - thenX, moveZ: here.z - thenZ }
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
      const at = spot(bake, drop, t + CHAIN_HEAD - along * (CHAIN_HEAD + CHAIN_TAIL), calendar)
      const shape = Math.max(0.3, Math.sqrt(Math.min(1, along / 0.25))) * (1 - 0.65 * along)
      return [at.x + dx, at.z + dz, at.half * CHAIN_WIDTH * shape * scale]
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
    uniforms.uDrops.value[slot + i].set(x, z, r / long)
    uniforms.uDropBank.value[slot + i] = bankAt(ground, x, z)
    uniforms.uAxes.value[slot + i].set(px, pz, along)
    uniforms.uMotion.value[slot + i] = lane
    spine.push({ lag, x: sx, z: sz, r })
    chain.forEach(([cx, cz, cr], k) => {
      uniforms.uChain.value[(slot + i) * CHAIN_POINTS + k].set(cx, cz, cr)
      uniforms.uChainBank.value[(slot + i) * CHAIN_POINTS + k] = bankAt(ground, cx, cz)
    })
    for (const [px, pz, pr] of [[x, z, along], ...chain]) {
      minX = Math.min(minX, px)
      minZ = Math.min(minZ, pz)
      maxX = Math.max(maxX, px)
      maxZ = Math.max(maxZ, pz)
      biggest = Math.max(biggest, pr)
    }
  })
  // Drops overtake one another, so the spine is threaded in their order along the stream now.
  spine.sort((a, b) => a.lag - b.lag).forEach((s, k) => uniforms.uSpine.value[slot + k].set(s.x, s.z, s.r))
  return { minX, minZ, maxX, maxZ, biggest }
}

/** One square round every Mancha, outside which no Brochazo is looked at. Past ~2.5 radii a drop
 * adds nothing (the shader skips it), so that is all the margin needed. */
function cover(bounds: ReturnType<typeof place>[]) {
  const minX = Math.min(...bounds.map((b) => b.minX))
  const minZ = Math.min(...bounds.map((b) => b.minZ))
  const maxX = Math.max(...bounds.map((b) => b.maxX))
  const maxZ = Math.max(...bounds.map((b) => b.maxZ))
  const size = Math.max(maxX - minX, maxZ - minZ) + 2 * 2.5 * Math.max(...bounds.map((b) => b.biggest))
  uniforms.uOrigin.value.set((minX + maxX) / 2 - size / 2, (minZ + maxZ) / 2 - size / 2)
  uniforms.uSize.value = size
}

/** ?recorrido draws the way the Manada follows, coloured by month, for checking it by eye. */
const SHOW_RECORRIDO = new URLSearchParams(window.location.search).has('recorrido')

function RecorridoLine({ bake }: { bake: FaunaBake }) {
  const { points, colors } = useMemo(() => {
    const pts = [...bake.recorrido, bake.recorrido[0]]
    return {
      points: pts.map(([x, z]) => new THREE.Vector3(x, 1, z)),
      colors: pts.map((_, i) => new THREE.Color().setHSL(i / bake.recorrido.length, 0.9, 0.55)),
    }
  }, [bake])
  return <Line points={points} vertexColors={colors} lineWidth={2.5} />
}

const built = new WeakMap<FaunaBake, WeakMap<RiverLine[], Way[]>>()

/** Each species' way through the year, built once and shared with whatever else follows the Manada. */
function waysOf(raw: FaunaBake, rivers: RiverLine[]) {
  let byRivers = built.get(raw)
  if (!byRivers) built.set(raw, (byRivers = new WeakMap()))
  let ways = byRivers.get(rivers)
  if (!ways) {
    ways = ESPECIES.map((e) => rounded({ ...raw, recorrido: e.name === 'gacela' ? raw.gacelas : raw.recorrido }, rivers))
    byRivers.set(rivers, ways)
  }
  return ways
}

/** Where the centre of the ñus is at a moment of the year. */
export function manadaAt(raw: FaunaBake, rivers: RiverLine[], month: number) {
  return recorridoAt(waysOf(raw, rivers)[0], month)
}

/** How fast the ñus are going at a moment of the year (km a month). */
export function pasoAt(raw: FaunaBake, rivers: RiverLine[], month: number) {
  const [vx, vz] = velocityAt(waysOf(raw, rivers)[0], month)
  return Math.hypot(vx, vz)
}

export function Fauna() {
  const raw = useFauna()
  const hf = useHeightfield()
  const ways = useMemo(() => waysOf(raw, hf.rivers), [raw, hf.rivers])
  const all = useMemo(() => drops(), [])
  const [bake] = ways
  const ground = useMemo(() => {
    const { nx, nz, data } = raw.ground
    const tex = new THREE.DataTexture(data, nx, nz, THREE.RGFormat)
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearFilter
    tex.needsUpdate = true
    return tex
  }, [raw.ground])
  useEffect(() => {
    const { nx, nz, step } = raw.ground
    uniforms.uGround.value = ground
    uniforms.uGroundSize.value.set(nx, nz, step)
    return () => ground.dispose()
  }, [ground, raw.ground])

  const cells = useMemo(() => new CellPass(stepFragment, { ...shared, ...uniforms }), [])
  // Each frame paints from the last one's, so two passes take turns reading and drawing.
  const paint = useMemo(() => {
    const stroke = { value: 0 }
    const a = new CellPass(paintFragment, { ...shared, uTaken: { value: cells.texture }, uPainted: { value: null }, uStroke: stroke })
    const b = new CellPass(paintFragment, { ...shared, uTaken: { value: cells.texture }, uPainted: { value: a.texture }, uStroke: stroke })
    a.uniforms.uPainted.value = b.texture
    return { passes: [a, b], stroke, turn: 0 }
  }, [cells])
  useEffect(
    () => () => {
      cells.dispose()
      paint.passes.forEach((p) => p.dispose())
    },
    [cells, paint],
  )

  useFrame(({ gl }, dt) => {
    const month = useStore.getState().month
    cover(ways.map((way, k) => place(way, raw.ground, all, month + ESPECIES[k].ahead, month, k)))
    cells.draw(gl)
    paint.stroke.value = Math.min(dt, 0.1) / PAINT_SECONDS
    paint.turn ^= 1
    const pass = paint.passes[paint.turn]
    pass.draw(gl)
    mancha.uMancha.value = pass.texture
  })

  return SHOW_RECORRIDO ? <RecorridoLine bake={bake} /> : null
}
