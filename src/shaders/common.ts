import * as THREE from 'three'
import { MAP, RAIN_NORTH, RAIN_SOUTH } from '../geo'

export const SUN_DIR = new THREE.Vector3(-0.62, 0.55, 0.56).normalize()

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

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

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
`
