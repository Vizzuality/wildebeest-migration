import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { GLSL_COMMON, shared } from '../shaders/common'
import { mulberry32 } from '../terrain'

// The Partos told with Señales: small rings of light that pop over the Mancha while the calves
// are born on the Ndutu plains. They hang on the date alone, so a paused moment always shows the
// same ones.

const SIGNS = 90
/**
 * The real Partos last about three weeks from late January, which at a year a minute would pass
 * in a blink. They are stretched to about a month (±2 sigma) so they read.
 */
const PEAK_MONTH = 1.3
const SIGMA_MONTHS = 0.28
/** How long each Señal lives, in months: 1.5 s at normal speed, longer than its moment. */
const LIFE_MONTHS = 0.3
/** Ring radius at its widest (km), and the least it shrinks to on screen far away (px). */
const SIZE_MIN = 0.7
const SIZE_MAX = 1.4
const MIN_PX = 4
const LIFT = 0.06
const COLOR = new THREE.Color(0.55, 0.38, 0.12)

/** A point on the Mancha at a moment of the year, picked with the given random source. */
export type OnMancha = (month: number, rnd: () => number) => [number, number]

const vertex = /* glsl */ `
${GLSL_COMMON}
attribute vec4 aSign;
uniform float uViewport;
varying vec2 vUv;
varying float vAge;
void main() {
  vAge = mod(uMonth - aSign.z + 12.0, 12.0) / ${LIFE_MONTHS.toFixed(2)};
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

const fragment = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAge;
void main() {
  float d = length(vUv);
  float t = vAge;
  // The ring races out and slows; a flash marks the moment it starts.
  float r = mix(0.08, 0.92, 1.0 - pow(1.0 - t, 3.0));
  float w = mix(0.1, 0.03, t);
  float ring = smoothstep(w, 0.0, abs(d - r)) * pow(1.0 - t, 1.5);
  float flash = exp(-d * d * 40.0) * (1.0 - smoothstep(0.0, 0.3, t)) * 0.7;
  float a = ring + flash;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <colorspace_fragment>
}
`

function births(onMancha: OnMancha) {
  const rnd = mulberry32(23)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-6))) * Math.cos(2 * Math.PI * rnd())
  const data = new Float32Array(SIGNS * 4)
  for (let k = 0; k < SIGNS; k++) {
    const month = PEAK_MONTH + THREE.MathUtils.clamp(gauss(), -2.2, 2.2) * SIGMA_MONTHS
    const [x, z] = onMancha(month, rnd)
    data.set([x, z, month, SIZE_MIN + rnd() * (SIZE_MAX - SIZE_MIN)], k * 4)
  }
  return data
}

const uniforms = {
  uViewport: { value: 1 },
  uColor: { value: COLOR },
}

export function Partos({ onMancha }: { onMancha: OnMancha }) {
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(2, 2, 6, 6)
    const g = new THREE.InstancedBufferGeometry()
    g.index = plane.index
    g.setAttribute('position', plane.getAttribute('position'))
    g.setAttribute('aSign', new THREE.InstancedBufferAttribute(births(onMancha), 4))
    g.instanceCount = SIGNS
    return g
  }, [onMancha])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { ...shared, ...uniforms },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  )

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame(({ size }) => {
    uniforms.uViewport.value = size.height
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
}
