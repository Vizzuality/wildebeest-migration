import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { GLSL_COMMON, shared } from '../shaders/common'

// Señales: marks that tell an event of the Manada on the ground, each one a quad that lives a
// moment after its date. They hang on the date alone, so a paused moment always shows the same
// ones. Every sign is x, z (km), month and radius (km).

/** The least a sign shrinks to on screen far away (px), and its lift off the ground (km). */
const MIN_PX = 4
const LIFT = 0.06

const vertex = /* glsl */ `
${GLSL_COMMON}
attribute vec4 aSign;
uniform float uViewport;
uniform float uLife;
varying vec2 vUv;
varying float vAge;
void main() {
  vAge = mod(uMonth - aSign.z + 12.0, 12.0) / uLife;
  if (vAge > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 centre = vec3(aSign.x, heightAt(aSign.xy), aSign.y);
  float perPixel = 2.0 * distance(cameraPosition, centre) / (projectionMatrix[1][1] * uViewport);
  float radius = max(aSign.w, ${MIN_PX.toFixed(1)} * perPixel);
  vUv = position.xy;
  vec2 xz = aSign.xy + position.xy * radius;
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, heightAt(xz) + ${LIFT.toFixed(2)}, xz.y, 1.0);
}
`

/**
 * `look` is GLSL that sets `float a`, the sign's strength, from `d` (distance from its centre, 1
 * at its rim) and `t` (its age, 0 to 1).
 */
function fragment(look: string) {
  return /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAge;
void main() {
  float d = length(vUv);
  float t = vAge;
  float a = 0.0;
  ${look}
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}
`
}

/** The canvas height (px), the same for every Señal. */
const viewport = { value: 1 }

export function Senales({ signs, color, life, look }: { signs: Float32Array; color: THREE.Color; life: number; look: string }) {
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(2, 2, 6, 6)
    const g = new THREE.InstancedBufferGeometry()
    g.index = plane.index
    g.setAttribute('position', plane.getAttribute('position'))
    g.setAttribute('aSign', new THREE.InstancedBufferAttribute(signs, 4))
    g.instanceCount = signs.length / 4
    return g
  }, [signs])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment(look),
        uniforms: { ...shared, uViewport: viewport, uLife: { value: life }, uColor: { value: color } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [color, life, look],
  )

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame(({ size }) => {
    viewport.value = size.height
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}
