import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BIRTH_END, BIRTH_START } from '../geo'
import { GLSL_COMMON, GLSL_HERD, shared } from '../shaders/common'
import { mulberry32 } from '../terrain'

type Part = { size: [number, number, number]; at: [number, number, number]; rotX?: number; color: string; leg?: number }

// A low-poly wildebeest facing +Z, hooves at y = 0. Each box carries its colour
// and, for legs, the gait phase (+1 / −1) used by the vertex shader.
const PARTS: Part[] = [
  { size: [0.34, 0.42, 0.92], at: [0, 0.8, 0], color: '#6a625a' },
  { size: [0.36, 0.26, 0.42], at: [0, 1.0, 0.22], color: '#57504a' },
  { size: [0.2, 0.22, 0.62], at: [0, 0.83, 0.62], rotX: 0.85, color: '#2b2724' },
  { size: [0.46, 0.05, 0.06], at: [0, 1.04, 0.58], color: '#b8ab95' },
  { size: [0.07, 0.62, 0.08], at: [0.11, 0.31, 0.32], color: '#3d3833', leg: 1 },
  { size: [0.07, 0.62, 0.08], at: [-0.11, 0.31, 0.32], color: '#3d3833', leg: -1 },
  { size: [0.07, 0.62, 0.08], at: [0.11, 0.31, -0.33], color: '#3d3833', leg: -1 },
  { size: [0.07, 0.62, 0.08], at: [-0.11, 0.31, -0.33], color: '#3d3833', leg: 1 },
  { size: [0.05, 0.4, 0.05], at: [0, 0.78, -0.5], rotX: -0.3, color: '#1c1a18' },
]

function buildAnimal() {
  const geos = PARTS.map((p) => {
    const g = new THREE.BoxGeometry(...p.size)
    // Sloping back: the rump sits lower than the shoulders.
    if (p === PARTS[0]) {
      const pos = g.attributes.position
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0 && pos.getZ(i) < 0) pos.setY(i, pos.getY(i) - 0.1)
      }
    }
    if (p.rotX) g.rotateX(p.rotX)
    g.translate(...p.at)
    const n = g.attributes.position.count
    const c = new THREE.Color(p.color)
    const col = new Float32Array(n * 3)
    const leg = new Float32Array(n).fill(p.leg ?? 0)
    for (let i = 0; i < n; i++) c.toArray(col, i * 3)
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aLeg', new THREE.BufferAttribute(leg, 1))
    g.deleteAttribute('uv')
    return g
  })
  return mergeGeometries(geos)!
}

function gaussian(rnd: () => number) {
  return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd())
}

// Inverse of smoothstep, so birth dates follow the same curve as the counter.
function invSmoothstep(y: number) {
  return 0.5 - Math.sin(Math.asin(1 - 2 * y) / 3)
}

// Sub-herds strung along the route: lag (months), lateral centre, weight.
const CLUSTERS = [
  [-0.62, -0.2, 0.6], [-0.4, 0.35, 1], [-0.2, -0.3, 1.3], [0, 0.1, 1.6],
  [0.18, 0.4, 1.2], [0.36, -0.25, 1], [0.55, 0.15, 0.7],
]

function buildHerdAttributes(adults: number, calves: number) {
  const rnd = mulberry32(1337)
  const total = adults + calves
  const seeds = new Float32Array(total * 4)
  const extra = new Float32Array(total * 4) // phase, isCalf, birth, tint
  const weightSum = CLUSTERS.reduce((s, c) => s + c[2], 0)

  for (let i = 0; i < adults; i++) {
    let r = rnd() * weightSum
    let cl = CLUSTERS[0]
    for (const c of CLUSTERS) {
      if ((r -= c[2]) <= 0) { cl = c; break }
    }
    seeds[i * 4] = cl[0] + gaussian(rnd) * 0.07
    seeds[i * 4 + 1] = THREE.MathUtils.clamp(cl[1] + gaussian(rnd) * 0.38, -1.4, 1.4)
    seeds[i * 4 + 2] = gaussian(rnd) * 0.5
    seeds[i * 4 + 3] = gaussian(rnd) * 0.5
    extra[i * 4] = rnd()
    extra[i * 4 + 1] = 0
    extra[i * 4 + 2] = 0
    extra[i * 4 + 3] = rnd()
  }
  // Each calf trots beside a mother.
  for (let j = 0; j < calves; j++) {
    const i = adults + j
    const mother = Math.floor(rnd() * adults)
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = seeds[mother * 4 + k]
    seeds[i * 4 + 1] += 0.012
    seeds[i * 4 + 2] += 0.04
    extra[i * 4] = extra[mother * 4] + 0.13
    extra[i * 4 + 1] = 1
    extra[i * 4 + 2] = BIRTH_START + (BIRTH_END - BIRTH_START) * invSmoothstep(rnd())
    extra[i * 4 + 3] = rnd()
  }
  return { seeds, extra, total }
}

const vertex = /* glsl */ `
${GLSL_COMMON}
${GLSL_HERD}
uniform float uScale;
attribute vec3 aColor;
attribute float aLeg;
attribute vec4 aSeed;
attribute vec4 aExtra;
varying vec3 vColor;
varying vec3 vNormal;
varying float vLight;
#include <fog_pars_vertex>

void main() {
  float phase = aExtra.x;
  float isCalf = aExtra.y;
  float birth = aExtra.z;
  float tint = aExtra.w;

  vec2 dir; float speed;
  vec2 xz = animalPos(aSeed, phase, dir, speed);

  float moving = smoothstep(8.0, 30.0, speed) * uMoving;
  // When the herd lingers, animals graze facing every which way.
  float a = phase * 6.2831 + uClock * 0.02;
  vec2 grazeDir = vec2(sin(a), cos(a));
  vec2 heading = normalize(mix(grazeDir, dir, moving) + 1e-4);

  float scale = uScale;
  float m = mod(uMonth, 12.0);
  if (isCalf > 0.5) {
    float age = m - birth;
    scale *= age < 0.0 ? 0.0 : mix(0.5, 0.8, clamp(age / 9.0, 0.0, 1.0));
  }
  float ground = heightAt(xz);
  if (ground < -0.3) scale = 0.0; // never stand in the lake

  vec3 p = position;
  // Trotting gait: shear the legs back and forth around the hip.
  float gait = sin(uClock * 9.0 + phase * 40.0) * aLeg;
  float stride = mix(0.04, 0.32, moving);
  p.z += gait * stride * (0.62 - p.y) * step(0.001, abs(aLeg));
  // Grazing animals dip their heads.
  float headDown = (1.0 - moving) * step(0.45, p.z) * (0.5 + 0.5 * sin(uClock * 0.7 + phase * 20.0));
  p.y -= headDown * (p.z - 0.45) * 0.9;

  float c = heading.y;
  float s = heading.x;
  vec3 rotated = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  vec3 n = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);

  vec3 world = vec3(xz.x, ground, xz.y) + rotated * scale;
  vNormal = n;
  vec3 calfTone = vec3(0.62, 0.48, 0.32);
  vColor = mix(aColor * (0.85 + 0.3 * tint), calfTone, isCalf * 0.85);
  vColor = pow(vColor, vec3(2.2));

  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const fragment = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vColor;
varying vec3 vNormal;
#include <fog_pars_fragment>
void main() {
  vec3 N = normalize(vNormal);
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 col = vColor * (0.55 + 1.6 * diff * vec3(1.0, 0.86, 0.66));
  // Warm rim from the low sun so the herd reads against the grass.
  col += vec3(0.9, 0.55, 0.25) * pow(1.0 - max(N.y, 0.0), 3.0) * 0.08;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function Herd({ adults, calves }: { adults: number; calves: number }) {
  const geometry = useMemo(() => {
    const base = buildAnimal()
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = base.index
    for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.attributes[name])
    const { seeds, extra, total } = buildHerdAttributes(adults, calves)
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    geo.setAttribute('aExtra', new THREE.InstancedBufferAttribute(extra, 4))
    geo.instanceCount = total
    return geo
  }, [adults, calves])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          ...shared,
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uScale: { value: 0.2 },
        },
        fog: true,
      }),
    [],
  )

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
