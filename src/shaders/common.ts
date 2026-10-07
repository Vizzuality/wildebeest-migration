import * as THREE from 'three'
import { MAP, RAIN_NORTH, RAIN_SOUTH } from '../geo'

export const SUN_DIR = new THREE.Vector3(-0.62, 0.55, 0.56).normalize()

/**
 * Tileable smooth value noise, 32 lattice cells across. Sampled through mipmaps, so detail
 * averages out on its own once it is smaller than a pixel. One fetch replaces a simplex call.
 */
function noiseTexture(size = 256, cells = 32) {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const lattice = Array.from({ length: cells * cells }, rnd)
  const at = (i: number, j: number) => lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells
      const fy = (y / size) * cells
      const i = Math.floor(fx)
      const j = Math.floor(fy)
      const tx = smooth(fx - i)
      const ty = smooth(fy - j)
      const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx
      const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx
      const k = (y * size + x) * 4
      data[k] = data[k + 1] = data[k + 2] = Math.round((a + (b - a) * ty) * 255)
      data[k + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, size, size)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

/** Uniforms shared (by reference) across every material in the scene. */
export const shared = {
  uMonth: { value: 0 },
  uClock: { value: 0 },
  uSunDir: { value: SUN_DIR },
  // Filled in by loadHeightfield() before anything that samples them renders.
  uHeight: { value: null as THREE.DataTexture | null },
  uMapMin: { value: new THREE.Vector2(MAP.minX, MAP.minZ) },
  uMapStep: { value: 0 },
  uRainS: { value: RAIN_SOUTH },
  uRainN: { value: RAIN_NORTH },
  uNoise2: { value: noiseTexture() },
}

export const GLSL_COMMON = /* glsl */ `
uniform float uMonth;
uniform float uClock;
uniform vec3 uSunDir;
uniform sampler2D uHeight;
uniform vec2 uMapMin;
uniform float uMapStep;
uniform float uRainS[12];
uniform float uRainN[12];
uniform sampler2D uNoise2;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

// Cheap stand-in for snoise: about −1…1, one lattice cell per unit.
float tnoise(vec2 p) { return texture2D(uNoise2, p / 32.0).r * 2.0 - 1.0; }

float heightAt(vec2 xz) {
  vec2 f = (xz - uMapMin) / uMapStep;
  ivec2 size = textureSize(uHeight, 0);
  f = clamp(f, vec2(0.0), vec2(size - 2));
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  float a = texelFetch(uHeight, i, 0).r;
  float b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeight, i + ivec2(0, 1), 0).r;
  float d = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

int wrap12(int i) { return ((i % 12) + 12) % 12; }

float rainS(float month) {
  float t = month - 0.5; float fi = floor(t); int i = int(fi);
  return mix(uRainS[wrap12(i)], uRainS[wrap12(i + 1)], t - fi);
}
float rainN(float month) {
  float t = month - 0.5; float fi = floor(t); int i = int(fi);
  return mix(uRainN[wrap12(i)], uRainN[wrap12(i + 1)], t - fi);
}
float northness(float z) { return smoothstep(80.0, -110.0, z); }
float rainAt(float z, float month) { return mix(rainS(month), rainN(month), northness(z)); }
float greenness(float z, float month) { return smoothstep(0.0, 110.0, rainAt(z, month - 0.6)); }

// Simplex 2D noise (Ashima / Ian McEwan, MIT).
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
  m = m * m; m = m * m;
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

// Drifting cloud shadows where it is raining this month (0 = clear, ~0.45 = under a cloud).
float cloudShadow(vec2 xz) {
  float rainy = smoothstep(30.0, 120.0, rainAt(xz.y, uMonth));
  float cloud = smoothstep(0.25, 0.75, tnoise(xz * 0.012 + vec2(uClock * 0.012, uClock * 0.005)) * 0.7 + 0.3 * tnoise(xz * 0.04 - uClock * 0.01));
  return cloud * rainy * 0.45;
}

// Warm low sun and cool sky fill, shared so ground and Bosquetes light the same.
vec3 sunlight(vec3 albedo, vec3 N, float shadow) {
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 sun = srgb(vec3(1.0, 0.86, 0.66)) * 1.55;
  vec3 sky = mix(srgb(vec3(0.45, 0.42, 0.40)), srgb(vec3(0.55, 0.62, 0.75)), N.y * 0.5 + 0.5) * 0.55;
  return albedo * (sky + sun * diff * (1.0 - shadow));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`
