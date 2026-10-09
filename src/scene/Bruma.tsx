import { useFrame } from '@react-three/fiber'
import { BlendFunction, Effect, EffectAttribute, ShaderPass } from 'postprocessing'
import { useMemo } from 'react'
import * as THREE from 'three'
import { MAP, PLACES, project } from '../geo'
import { SUN_DIR, shared } from '../shaders/common'
import { mulberry32 } from '../terrain'

// Bruma: for every pixel the view ray is marched through a field of warm calima, thick and
// tall beyond the edge of the Mapa and gone well before the middle, so the land inside stays
// clear. Relief standing above the layer cuts it.

/** Rays only march through this height band (scene units); above it the air is clear. */
const SLAB_TOP = 18
const SLAB_BOTTOM = -4
const STEPS = 28

/** How far the ragged shoreline can reach inwards (km) before the edge calima is gone. */
const EDGE_REACH = 40
/** Superellipse exponent: 2 is a true ellipse, higher squares it off towards the Mapa's corners. */
const OVAL = 4
/** Tongues of calima reach this far (km) inwards; the shoreline never retreats past the edge. */
const TONGUES = 58
/** Sideways wobble (km) that bends the straight sides of the Mapa. */
const WARP = 16
/** Every named place keeps a clearing this wide (km); the calima thins out over the next stretch. */
const CLEARING = 16
const CLEARING_FADE = 18
const PLACE_XZ = PLACES.map((p) => project(p.at))

/** The shoreline is baked once into a texture so each raymarch step is a single lookup. */
const FIELD_MARGIN = 40
const FIELD_MIN = new THREE.Vector2(MAP.minX - FIELD_MARGIN, MAP.minZ - FIELD_MARGIN)
const FIELD_SIZE = new THREE.Vector2(MAP.maxX - MAP.minX + FIELD_MARGIN * 2, MAP.maxZ - MAP.minZ + FIELD_MARGIN * 2)
/** Texels store distance + FIELD_OFFSET in km, so the shoreline spans −64…191 km at 1 km precision. */
const FIELD_OFFSET = 64

function smooth(t: number) {
  return t * t * (3 - 2 * t)
}

function smoothstep(a: number, b: number, x: number) {
  return smooth(Math.min(1, Math.max(0, (x - a) / (b - a))))
}

function valueNoise(seed: number) {
  const lattice = (ix: number, iz: number) => {
    const h = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453
    return h - Math.floor(h)
  }
  return (x: number, z: number) => {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const fx = smooth(x - ix)
    const fz = smooth(z - iz)
    const a = lattice(ix, iz) + (lattice(ix + 1, iz) - lattice(ix, iz)) * fx
    const b = lattice(ix, iz + 1) + (lattice(ix + 1, iz + 1) - lattice(ix, iz + 1)) * fx
    return a + (b - a) * fz
  }
}

/** Distance inside an oval (a superellipse filling the Mapa), in km, negative outside. */
function ovalInside(x: number, z: number) {
  const rx = (MAP.maxX - MAP.minX) / 2
  const rz = (MAP.maxZ - MAP.minZ) / 2
  const ux = Math.abs(x - (MAP.minX + MAP.maxX) / 2) / rx
  const uz = Math.abs(z - (MAP.minZ + MAP.maxZ) / 2) / rz
  return (1 - (ux ** OVAL + uz ** OVAL) ** (1 / OVAL)) * Math.min(rx, rz)
}

/**
 * The oval, bent sideways, bitten by tongues of calima, and drawn back from every named place
 * with a ragged rim rather than a round hole.
 */
function shoreline(x: number, z: number) {
  const [n1, n2, n3, n4, n5, n6] = SHORE_NOISE
  const qx = x * 0.022
  const qz = z * 0.022
  const wx = n1(qx * 0.7, qz * 0.7) - 0.5
  const wz = n2(qx * 0.7, qz * 0.7) - 0.5
  let d = ovalInside(x + wx * WARP * 2, z + wz * WARP * 2)
  const tongue = n3(qx, qz) * 0.62 + n4(qx * 2.7, qz * 2.7) * 0.26 + n5(qx * 7.3, qz * 7.3) * 0.12
  d += 8 - smoothstep(0.3, 0.75, tongue) * TONGUES
  let near = Infinity
  for (const [px, pz] of PLACE_XZ) near = Math.min(near, Math.hypot(x - px, z - pz))
  near += (n6(qx * 4.3, qz * 4.3) - 0.5) * 12
  const clearing = 1 - smoothstep(CLEARING, CLEARING + CLEARING_FADE, near)
  return Math.max(d, clearing * EDGE_REACH)
}

const SHORE_NOISE = [1, 2, 3, 4, 5, 6].map(valueNoise)

function shorelineTexture() {
  const w = Math.round(FIELD_SIZE.x)
  const h = Math.round(FIELD_SIZE.y)
  const data = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const d = shoreline(FIELD_MIN.x + ((i + 0.5) / w) * FIELD_SIZE.x, FIELD_MIN.y + ((j + 0.5) / h) * FIELD_SIZE.y)
      data[j * w + i] = Math.max(0, Math.min(255, Math.round(d + FIELD_OFFSET)))
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/**
 * The calima is soft, so it is marched at half the resolution each way (a quarter of the pixels)
 * and brought back up guided by depth, so relief still cuts it cleanly.
 */
const SCALE = 0.5

const marchVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

const march = /* glsl */ `
uniform sampler2D uDepth;
varying vec2 vUv;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uMapMin;
uniform vec2 uMapMax;
uniform float uClock;
uniform vec3 uSunDir;
uniform vec3 uHaze;
uniform vec3 uSun;
uniform highp sampler3D uNoise;
uniform sampler2D uShore;
uniform vec2 uShoreMin;
uniform vec2 uShoreSize;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// One lattice cell per unit, like a hash-based value noise.
float noise(vec3 p) { return texture(uNoise, p / 32.0).r; }

// Distance inside the Mapa's oval (negative outside), without the ragged shoreline.
float rawInside(vec2 xz) {
  vec2 radius = (uMapMax - uMapMin) * 0.5;
  vec2 u = abs(xz - (uMapMin + uMapMax) * 0.5) / radius;
  float r = pow(pow(u.x, ${OVAL.toFixed(1)}) + pow(u.y, ${OVAL.toFixed(1)}), ${(1 / OVAL).toFixed(4)});
  return (1.0 - r) * min(radius.x, radius.y);
}

// The baked shoreline, breathing a few km in and out over time.
float inside(vec2 xz) {
  float d = texture(uShore, (xz - uShoreMin) / uShoreSize).r * 255.0 - ${FIELD_OFFSET.toFixed(1)};
  return d + (noise(vec3(xz * 0.05, uClock * 0.02)) - 0.5) * 8.0;
}

// Extinction per km of the edge calima.
float density(vec3 p) {
  float edge = 1.0 - smoothstep(-6.0, ${EDGE_REACH.toFixed(1)}, inside(p.xz));
  if (edge <= 0.0) return 0.0;
  float billow = noise(vec3(p.xz * 0.012, 0.37 + uClock * 0.004));
  float top = mix(1.0, ${SLAB_TOP.toFixed(1)}, edge) * (0.55 + 0.7 * billow);
  float puff = noise(p * vec3(0.04, 0.12, 0.04) + vec3(uClock * 0.02, 0.0, uClock * 0.01));
  float body = smoothstep(top, top * 0.2, p.y + (puff - 0.5) * top * 0.6);
  return edge * 0.5 * body * (0.35 + 1.3 * puff);
}

// Each low-res texel marches along the ray of the top-left full-res pixel it covers, so the
// upsampling below knows exactly which depth it was marched to.
void main() {
  ivec2 full = textureSize(uDepth, 0);
  ivec2 at = min(ivec2(gl_FragCoord.xy) * 2, full - 1);
  float depth = texelFetch(uDepth, at, 0).r;
  vec2 uv = (vec2(at) + 0.5) / vec2(full);
  vec4 view = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  view /= view.w;
  vec3 world = (uCamWorld * view).xyz;
  vec3 ro = uCamPos;
  vec3 rd = normalize(world - ro);
  bool sky = depth >= 1.0;
  float dist = sky ? 4000.0 : distance(world, ro);

  float trans = 1.0;
  vec3 light = vec3(0.0);

  // Clip the ray to the slab where the edge calima lives.
  float t0 = 0.0;
  float t1 = dist;
  if (abs(rd.y) > 1e-4) {
    float ta = (${SLAB_TOP.toFixed(1)} - ro.y) / rd.y;
    float tb = (${SLAB_BOTTOM.toFixed(1)} - ro.y) / rd.y;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (ro.y > ${SLAB_TOP.toFixed(1)}) {
    t1 = -1.0;
  }
  // Distance to the edge is concave along a straight segment, so if both ends are deep
  // inside the Mapa, the whole segment is clear of the edge calima.
  float clear = ${(EDGE_REACH + TONGUES + WARP * 1.5 + 4).toFixed(1)};
  if (t1 > t0 && min(rawInside((ro + rd * t0).xz), rawInside((ro + rd * t1).xz)) < clear) {
    float dt = (t1 - t0) / float(${STEPS});
    float t = t0 + dt * hash13(vec3(gl_FragCoord.xy, fract(uClock) * 61.0));
    // Forward scattering towards the sun (Henyey–Greenstein, g = 0.5).
    float mu = dot(rd, uSunDir);
    float phase = 0.75 / pow(1.25 - mu, 1.5);
    for (int i = 0; i < ${STEPS}; i++) {
      vec3 p = ro + rd * t;
      float sigma = density(p);
      if (sigma > 0.0) {
        // Darker at the foot of the calima, glowing where the sun catches its top.
        float lift = smoothstep(${SLAB_BOTTOM.toFixed(1)}, ${SLAB_TOP.toFixed(1)}, p.y);
        vec3 lum = uHaze * (0.8 + 0.35 * lift) + uSun * phase * (0.12 + 0.25 * lift);
        float a = 1.0 - exp(-sigma * dt);
        light += trans * a * lum;
        trans *= 1.0 - a;
        if (trans < 0.01) break;
      }
      t += dt;
    }
  }

  gl_FragColor = vec4(light, trans);
}
`

const composite = /* glsl */ `
uniform sampler2D uFog;
uniform float uNear;
uniform float uFar;

float viewDepth(float d) {
  return uNear * uFar / (uFar - d * (uFar - uNear));
}

// Joint bilateral upsampling: the four nearest low-res texels, weighted bilinearly and by how
// close the depth each was marched to is to this pixel's own.
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  ivec2 low = textureSize(uFog, 0);
  ivec2 full = textureSize(depthBuffer, 0);
  vec2 f = uv * vec2(low) - 0.5;
  ivec2 base = ivec2(floor(f));
  vec2 t = fract(f);
  float here = viewDepth(depth);
  vec4 sum = vec4(0.0);
  float total = 0.0;
  vec4 nearest = vec4(0.0, 0.0, 0.0, 1.0);
  float best = 1e9;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 texel = clamp(base + o, ivec2(0), low - 1);
    vec4 fog = texelFetch(uFog, texel, 0);
    float there = viewDepth(texelFetch(depthBuffer, min(texel * 2, full - 1), 0).r);
    float gap = abs(there - here) / here;
    float w = (o.x == 1 ? t.x : 1.0 - t.x) * (o.y == 1 ? t.y : 1.0 - t.y) * exp(-gap * 40.0);
    sum += fog * w;
    total += w;
    if (gap < best) {
      best = gap;
      nearest = fog;
    }
  }
  vec4 fog = total > 1e-4 ? sum / total : nearest;
  outputColor = vec4(inputColor.rgb * fog.a + fog.rgb, inputColor.a);
}
`

/** Tileable value noise: random lattice values, trilinearly filtered by the GPU. */
function noiseTexture(size = 32) {
  const rnd = mulberry32(11)
  const data = new Uint8Array(size ** 3)
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256)
  const tex = new THREE.Data3DTexture(data, size, size, size)
  tex.format = THREE.RedFormat
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping
  tex.needsUpdate = true
  return tex
}

const srgb = (hex: string) => new THREE.Color(hex).convertSRGBToLinear()

class BrumaEffect extends Effect {
  private readonly march: THREE.ShaderMaterial
  private readonly target: THREE.WebGLRenderTarget
  private readonly pass: ShaderPass

  constructor() {
    const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.HalfFloatType })
    super('Bruma', composite, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uFog', new THREE.Uniform(target.texture)],
        ['uNear', new THREE.Uniform(0.5)],
        ['uFar', new THREE.Uniform(3000)],
      ]),
    })
    this.target = target
    this.march = new THREE.ShaderMaterial({
      vertexShader: marchVertex,
      fragmentShader: march,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uMapMin: { value: new THREE.Vector2(MAP.minX, MAP.minZ) },
        uMapMax: { value: new THREE.Vector2(MAP.maxX, MAP.maxZ) },
        uClock: { value: 0 },
        uSunDir: { value: SUN_DIR },
        uHaze: { value: srgb('#e6cdaa') },
        uSun: { value: srgb('#ffd9a8') },
        uNoise: { value: noiseTexture() },
        uShore: { value: shorelineTexture() },
        uShoreMin: { value: FIELD_MIN },
        uShoreSize: { value: FIELD_SIZE },
      },
    })
    this.pass = new ShaderPass(this.march, 'none')
  }

  follow(camera: THREE.PerspectiveCamera, clock: number) {
    const u = this.march.uniforms
    u.uProjInv.value.copy(camera.projectionMatrixInverse)
    u.uCamWorld.value.copy(camera.matrixWorld)
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld)
    u.uClock.value = clock
    this.uniforms.get('uNear')!.value = camera.near
    this.uniforms.get('uFar')!.value = camera.far
  }

  setDepthTexture(depthTexture: THREE.Texture) {
    this.march.uniforms.uDepth.value = depthTexture
  }

  update(renderer: THREE.WebGLRenderer) {
    this.pass.render(renderer, null, this.target)
  }

  setSize(width: number, height: number) {
    this.target.setSize(Math.ceil(width * SCALE), Math.ceil(height * SCALE))
  }

  dispose() {
    super.dispose()
    this.target.dispose()
    this.march.dispose()
  }
}

export function Bruma() {
  const effect = useMemo(() => new BrumaEffect(), [])
  useFrame(({ camera }) => effect.follow(camera as THREE.PerspectiveCamera, shared.uClock.value))
  return <primitive object={effect} dispose={null} />
}
