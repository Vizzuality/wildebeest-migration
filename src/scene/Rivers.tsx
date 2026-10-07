import { useMemo } from 'react'
import * as THREE from 'three'
import { GLSL_COMMON, shared } from '../shaders/common'
import { RIVER_LINES, heightAt } from '../terrain'

const vertex = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`
const fragment = /* glsl */ `
${GLSL_COMMON}
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float flow = snoise(vec2(vUv.x * 0.6 - uClock * 0.35, vUv.y * 3.0));
  float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  // Swollen and brighter in the rains, low and muddy in the dry season.
  float wet = smoothstep(20.0, 140.0, rainN(uMonth - 0.4));
  vec3 mud = srgb(vec3(0.40, 0.31, 0.20));
  vec3 clear = srgb(vec3(0.30, 0.42, 0.40));
  vec3 col = mix(mud, clear, wet * 0.6) * (0.9 + 0.25 * flow);
  col += srgb(vec3(1.0, 0.85, 0.6)) * smoothstep(0.55, 0.9, flow) * 0.25;
  gl_FragColor = vec4(col, edge * 0.95);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

function ribbon(points: [number, number][], width: number) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let along = 0
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const dx = next[0] - prev[0]
    const dz = next[1] - prev[1]
    const len = Math.hypot(dx, dz) || 1
    const nx = -dz / len
    const nz = dx / len
    if (i > 0) along += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
    const [x, z] = points[i]
    const y = heightAt(x, z) + 0.35
    pos.push(x + nx * width, y, z + nz * width, x - nx * width, y, z - nz * width)
    uv.push(along, 0, along, 1)
    if (i < points.length - 1) {
      const a = i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

export function Rivers() {
  const geometries = useMemo(
    () => RIVER_LINES.map((r) => ribbon(r.points, r.name === 'Mara' ? 0.75 : 0.5)),
    [],
  )
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { ...shared, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
        transparent: true,
        depthWrite: false,
        fog: true,
        side: THREE.DoubleSide,
      }),
    [],
  )
  return (
    <group>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g} material={material} renderOrder={1} />
      ))}
    </group>
  )
}
