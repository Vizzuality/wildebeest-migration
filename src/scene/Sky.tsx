import { useMemo } from 'react'
import * as THREE from 'three'

export const HORIZON = '#e9bf9c'

export function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {},
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 horizon = vec3(0.91, 0.75, 0.61);
            vec3 mid = vec3(0.55, 0.62, 0.72);
            vec3 zenith = vec3(0.16, 0.24, 0.40);
            vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
            col = mix(col, zenith, smoothstep(0.25, 0.8, h));
            // Sun glow towards the west.
            float sun = max(dot(vDir, normalize(vec3(-0.62, 0.12, 0.56))), 0.0);
            col += vec3(1.0, 0.7, 0.4) * pow(sun, 12.0) * 0.5;
            gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [],
  )
  return (
    <mesh material={material} renderOrder={-1}>
      <sphereGeometry args={[1400, 32, 16]} />
    </mesh>
  )
}
