import * as THREE from 'three'
import { DISPERSE, MAP, RAIN_NORTH, RAIN_SOUTH, ROUTE_XZ, SPREAD } from '../geo'
import { HF } from '../terrain'

export const SUN_DIR = new THREE.Vector3(-0.62, 0.55, 0.56).normalize()

export const heightTexture = (() => {
  const tex = new THREE.DataTexture(HF.heights, HF.nx, HF.nz, THREE.RedFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
})()

/** Uniforms shared (by reference) across every material in the scene. */
export const shared = {
  uMonth: { value: 0 },
  uClock: { value: 0 },
  uMoving: { value: 1 },
  uSunDir: { value: SUN_DIR },
  uHeight: { value: heightTexture },
  uMapMin: { value: new THREE.Vector2(MAP.minX, MAP.minZ) },
  uMapStep: { value: HF.step },
  uPath: { value: ROUTE_XZ.map(([x, z]) => new THREE.Vector2(x, z)) },
  uSpread: { value: SPREAD },
  uDisperse: { value: DISPERSE },
  uRainS: { value: RAIN_SOUTH },
  uRainN: { value: RAIN_NORTH },
}

export const GLSL_COMMON = /* glsl */ `
uniform float uMonth;
uniform float uClock;
uniform float uMoving;
uniform vec3 uSunDir;
uniform sampler2D uHeight;
uniform vec2 uMapMin;
uniform float uMapStep;
uniform vec2 uPath[12];
uniform float uSpread[12];
uniform float uDisperse[12];
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

vec2 herdPos(float month) {
  float t = month - 0.5;
  float fi = floor(t);
  float f = t - fi;
  int i1 = int(fi);
  vec2 p0 = uPath[wrap12(i1 - 1)];
  vec2 p1 = uPath[wrap12(i1)];
  vec2 p2 = uPath[wrap12(i1 + 1)];
  vec2 p3 = uPath[wrap12(i1 + 2)];
  return 0.5 * ((2.0 * p1) + (-p0 + p2) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f * f + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * f * f * f);
}

float spreadAt(float month) {
  float t = month - 0.5; float fi = floor(t); int i = int(fi);
  return mix(uSpread[wrap12(i)], uSpread[wrap12(i + 1)], t - fi);
}
float disperseAt(float month) {
  float t = month - 0.5; float fi = floor(t); int i = int(fi);
  return mix(uDisperse[wrap12(i)], uDisperse[wrap12(i + 1)], t - fi);
}
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

/**
 * Where one animal stands. seed.x = lag (months), seed.y = lateral (−1..1),
 * seed.z/w = dispersal offset (−1..1). Returns xz and writes heading.
 */
export const GLSL_HERD = /* glsl */ `
vec2 animalPos(vec4 seed, float phase, out vec2 dir, out float speed) {
  float t = uMonth + seed.x;
  vec2 p = herdPos(t);
  vec2 ahead = herdPos(t + 0.03);
  vec2 d = ahead - p;
  speed = length(d) / 0.03; // km per month
  dir = d / max(length(d), 1e-4);
  vec2 side = vec2(-dir.y, dir.x);
  vec2 pos = p + side * seed.y * spreadAt(t) + seed.zw * disperseAt(t);
  // Slow individual wander so the herd breathes.
  pos += 0.45 * vec2(sin(uClock * 0.21 + phase * 6.28), cos(uClock * 0.17 + phase * 9.1));
  return pos;
}
`
