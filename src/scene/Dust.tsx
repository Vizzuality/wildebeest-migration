import { useMemo } from 'react'
import * as THREE from 'three'
import { GLSL_COMMON, GLSL_HERD, shared } from '../shaders/common'
import { mulberry32 } from '../terrain'

const vertex = /* glsl */ `
${GLSL_COMMON}
${GLSL_HERD}
attribute vec4 aSeed;
attribute vec2 aLife;
varying float vAlpha;
void main() {
  vec2 dir; float speed;
  vec2 xz = animalPos(aSeed, aLife.x, dir, speed);
  float life = fract(uClock * 0.08 * (0.7 + aLife.y) + aLife.x);
  // Dust trails behind the herd and drifts with the wind.
  xz -= dir * life * 3.0;
  xz += vec2(1.0, 0.4) * life * 4.0;
  float ground = heightAt(xz);
  float dry = 1.0 - greenness(xz.y, uMonth);
  float moving = smoothstep(10.0, 35.0, speed) * uMoving;
  vAlpha = sin(life * 3.14159) * dry * (0.25 + 0.75 * moving);
  vec3 world = vec3(xz.x, ground + 0.4 + life * 3.5, xz.y);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (10.0 + 30.0 * life) * (220.0 / -mv.z);
}
`
const fragment = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.16;
  gl_FragColor = vec4(vec3(0.85, 0.68, 0.45) * a, a);
}
`

export function Dust({ count = 7000 }: { count?: number }) {
  const geometry = useMemo(() => {
    const rnd = mulberry32(5)
    const seeds = new Float32Array(count * 4)
    const life = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = (rnd() - 0.5) * 1.2
      seeds[i * 4 + 1] = (rnd() - 0.5) * 2
      seeds[i * 4 + 2] = (rnd() - 0.5) * 1.2
      seeds[i * 4 + 3] = (rnd() - 0.5) * 1.2
      life[i * 2] = rnd()
      life[i * 2 + 1] = rnd()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4))
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 2))
    return g
  }, [count])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: shared,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  )
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}
