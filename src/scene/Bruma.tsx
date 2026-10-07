import { useFrame } from '@react-three/fiber'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { useMemo } from 'react'
import * as THREE from 'three'
import { MAP } from '../geo'
import { SUN_DIR, shared } from '../shaders/common'
import { mulberry32 } from '../terrain'

// Bruma and Perspectiva aérea in one pass. For every pixel the view ray is marched through a
// field of warm calima: thick and tall beyond the edge of the Mapa, thinning inwards to a low
// layer that only pools over lakes and low ground. Relief standing above the layer cuts it.

/** Rays only march through this height band (scene units); above it the air is clear. */
const SLAB_TOP = 18
const SLAB_BOTTOM = -4
const STEPS = 28

/** How far the ragged shoreline can reach inwards (km) before the edge calima is gone. */
const EDGE_REACH = 50
const RAGGED = 23

const fragment = /* glsl */ `
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

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// One lattice cell per unit, like a hash-based value noise.
float noise(vec3 p) { return texture(uNoise, p / 32.0).r; }

float rawInside(vec2 xz) {
  vec2 e = min(xz - uMapMin, uMapMax - xz);
  return min(e.x, e.y);
}

// Distance inside the Mapa (negative outside), with a ragged, slowly drifting shoreline.
float inside(vec2 xz) {
  vec3 q = vec3(xz * 0.022, uClock * 0.01);
  return rawInside(xz) + (noise(q) - 0.5) * ${(RAGGED * 1.5).toFixed(1)} + (noise(q * 3.1) - 0.5) * 10.0;
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

// Low calima pooling over lakes and low ground everywhere: exponential in height, integrated
// exactly along the ray instead of marched.
float pooled(vec3 ro, vec3 rd, float dist) {
  const float A = 0.03;
  const float H = 0.9;
  float start = exp(-ro.y / H);
  if (abs(rd.y) < 1e-4) return A * start * dist;
  return A * H * (start - exp(-(ro.y + rd.y * dist) / H)) / rd.y;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 view = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  view /= view.w;
  vec3 world = (uCamWorld * view).xyz;
  vec3 ro = uCamPos;
  vec3 rd = normalize(world - ro);
  bool sky = depth >= 1.0;
  float dist = sky ? 4000.0 : distance(world, ro);

  // Perspectiva aérea plus the pooled layer: a warm veil that grows with distance, denser low down.
  vec3 col = inputColor.rgb;
  if (!sky) {
    float meanY = max(0.0, (ro.y + world.y) * 0.5);
    float tau = dist * 0.0016 * exp(-meanY / 40.0) + pooled(ro, rd, dist);
    col = mix(col, uHaze * 1.05, 1.0 - exp(-tau));
  }

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
  float clear = ${(EDGE_REACH + RAGGED + 6).toFixed(1)};
  if (t1 > t0 && min(rawInside((ro + rd * t0).xz), rawInside((ro + rd * t1).xz)) < clear) {
    float dt = (t1 - t0) / float(${STEPS});
    float t = t0 + dt * hash13(vec3(gl_FragCoord.xy, fract(uClock) * 61.0));
    // Forward scattering towards the sun (Henyey–Greenstein, g = 0.5).
    float mu = dot(rd, uSunDir);
    float phase = 0.75 / pow(1.25 - mu, 1.5);
    float trans = 1.0;
    vec3 light = vec3(0.0);
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
    col = col * trans + light;
  }

  outputColor = vec4(col, inputColor.a);
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
  constructor() {
    super('Bruma', fragment, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uMapMin', new THREE.Uniform(new THREE.Vector2(MAP.minX, MAP.minZ))],
        ['uMapMax', new THREE.Uniform(new THREE.Vector2(MAP.maxX, MAP.maxZ))],
        ['uClock', new THREE.Uniform(0)],
        ['uSunDir', new THREE.Uniform(SUN_DIR)],
        ['uHaze', new THREE.Uniform(srgb('#e6cdaa'))],
        ['uSun', new THREE.Uniform(srgb('#ffd9a8'))],
        ['uNoise', new THREE.Uniform(noiseTexture())],
      ]),
    })
  }
}

export function Bruma() {
  const effect = useMemo(() => new BrumaEffect(), [])
  useFrame(({ camera }) => {
    effect.uniforms.get('uProjInv')!.value.copy(camera.projectionMatrixInverse)
    effect.uniforms.get('uCamWorld')!.value.copy(camera.matrixWorld)
    effect.uniforms.get('uCamPos')!.value.setFromMatrixPosition(camera.matrixWorld)
    effect.uniforms.get('uClock')!.value = shared.uClock.value
  })
  return <primitive object={effect} dispose={null} />
}
