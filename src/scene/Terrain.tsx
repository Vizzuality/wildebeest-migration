import { useMemo } from 'react'
import * as THREE from 'three'
import { MAP, project } from '../geo'
import { GLSL_COMMON, shared } from '../shaders/common'
import { useHeightfield, type Heightfield } from '../terrain'
import { HORIZON } from './Sky'

const vertex = /* glsl */ `
${GLSL_COMMON}
attribute vec4 aCover;
attribute vec2 aMask;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vCover;
varying vec2 vMask;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normal;
  vCover = aCover;
  vMask = aMask;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
}
`

const fragment = /* glsl */ `
${GLSL_COMMON}
uniform vec2 uCrater;
uniform vec2 uCraterLake;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vCover;
varying vec2 vMask;

// Tree crowns as a mask whose area matches the Cobertura's tree share. Each scale of clumping
// fades out once it is smaller than a pixel, so far away it settles on the plain average.
float canopy(vec2 xz, float tree, float fw) {
  float clumps = 1.0 - smoothstep(0.03, 0.12, fw);
  float crowns = 1.0 - smoothstep(0.008, 0.03, fw);
  float n = snoise(xz * 4.0) * clumps * 0.6 + snoise(xz * 14.0) * crowns * 0.4;
  float u = 0.5 + 0.5 * n / max(clumps * 0.6 + crowns * 0.4, 1e-3);
  float sharp = smoothstep(1.0 - tree - 0.12, 1.0 - tree + 0.12, u);
  return mix(tree, sharp, max(clumps, crowns));
}

void main() {
  vec3 N = normalize(vNormal);
  vec2 xz = vWorld.xz;
  float tree = clamp(vCover.x, 0.0, 1.0);
  float shrub = clamp(vCover.y, 0.0, 1.0);
  float wet = clamp(vCover.z, 0.0, 1.0);
  float bare = clamp(vCover.w, 0.0, 1.0);
  float grass = max(0.0, 1.0 - tree - shrub - wet - bare);
  float lake = vMask.y;
  float fw = length(fwidth(xz));

  float n1 = snoise(xz * 0.08);
  float n2 = snoise(xz * 0.35 + 3.0);
  float n3 = snoise(xz * 2.2 - 7.0) * (1.0 - smoothstep(0.05, 0.2, fw));
  float g = clamp(greenness(xz.y, uMonth) * (0.9 + 0.15 * n1), 0.0, 1.0);

  // Hierba swings hardest with the rain: straw in the dry season, fresh green in the rains.
  vec3 straw = mix(srgb(vec3(0.78, 0.65, 0.42)), srgb(vec3(0.66, 0.53, 0.33)), 0.4 + 0.25 * n2);
  vec3 fresh = mix(srgb(vec3(0.48, 0.54, 0.28)), srgb(vec3(0.38, 0.47, 0.21)), 0.4 + 0.25 * n2);
  vec3 grassCol = mix(straw, fresh, g) * (0.96 + 0.05 * n3);
  // Matorral only half follows it: grey-brown Commiphora thorn at worst, dull olive at best.
  vec3 shrubCol = mix(srgb(vec3(0.50, 0.43, 0.31)), srgb(vec3(0.36, 0.41, 0.21)), g * 0.7) * (0.92 + 0.1 * n3);
  vec3 wetCol = mix(srgb(vec3(0.36, 0.42, 0.20)), srgb(vec3(0.22, 0.40, 0.17)), 0.4 + 0.6 * g);
  vec3 bareCol = srgb(vec3(0.72, 0.66, 0.56));
  float under = max(1.0 - tree, 1e-3);
  vec3 floorCol = (grassCol * grass + shrubCol * shrub + wetCol * wet + bareCol * bare) / under;
  if (grass + shrub + wet + bare < 1e-3) floorCol = grassCol;

  // Dense canopy (galería, highland forest) stays evergreen; open acacia yellows a little when dry.
  float dense = smoothstep(0.35, 0.8, tree);
  vec3 acacia = mix(srgb(vec3(0.44, 0.42, 0.22)), srgb(vec3(0.26, 0.34, 0.13)), 0.35 + 0.65 * g);
  vec3 forest = srgb(vec3(0.13, 0.24, 0.10));
  vec3 treeCol = mix(acacia, forest, dense) * (0.8 + 0.3 * (0.5 + 0.5 * snoise(xz * 11.0 + 5.0)));

  // Crowns, plus the shadow each one throws away from the sun.
  float c = canopy(xz, tree, fw);
  float shaded = canopy(xz + uSunDir.xz * 0.035, tree, fw);
  vec3 col = mix(floorCol, treeCol, c);
  col *= 1.0 - 0.4 * shaded * (1.0 - c);

  // Bare rock on steep slopes and high ground.
  vec3 rock = srgb(vec3(0.46, 0.40, 0.34));
  float steep = smoothstep(0.86, 0.62, N.y);
  col = mix(col, rock, steep * 0.8);

  // Ngorongoro crater floor and Lake Magadi, its soda lake.
  float dC = distance(xz, uCrater);
  col = mix(col, fresh, smoothstep(9.0, 7.0, dC) * 0.4);
  col = mix(col, srgb(vec3(0.86, 0.80, 0.78)), smoothstep(2.0, 1.5, distance(xz, uCraterLake)));

  // Lakes.
  float shimmer = 0.5 + 0.5 * snoise(xz * 0.15 + vec2(uClock * 0.05, uClock * 0.03));
  vec3 water = mix(srgb(vec3(0.07, 0.20, 0.27)), srgb(vec3(0.16, 0.36, 0.42)), shimmer * 0.6);
  col = mix(col, water, smoothstep(0.4, 0.9, lake));

  vec3 lit = sunlight(col, N, cloudShadow(xz));
  lit += water * lake * pow(max(dot(reflect(-uSunDir, N), vec3(0.0, 1.0, 0.0)), 0.0), 8.0) * 0.08;

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// Real coordinates: centre of the crater floor, and Lake Magadi from OpenStreetMap.
const CRATER = project([35.575, -3.18])
const CRATER_LAKE = project([35.536, -3.193])

function buildGeometry({ nx, nz, step, heights, cover, masks }: Heightfield) {
  const pos = new Float32Array(nx * nz * 3)
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix
      pos[i * 3] = MAP.minX + ix * step
      pos[i * 3 + 1] = heights[i]
      pos[i * 3 + 2] = MAP.minZ + iz * step
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6)
  let k = 0
  for (let iz = 0; iz < nz - 1; iz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iz * nx + ix
      const b = a + 1
      const c = a + nx
      const d = c + 1
      index[k++] = a; index[k++] = c; index[k++] = b
      index[k++] = b; index[k++] = c; index[k++] = d
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aCover', new THREE.BufferAttribute(cover, 4))
  geo.setAttribute('aMask', new THREE.BufferAttribute(masks, 2))
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

export function Terrain() {
  const hf = useHeightfield()
  const geometry = useMemo(() => buildGeometry(hf), [hf])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          ...shared,
          uCrater: { value: new THREE.Vector2(...CRATER) },
          uCraterLake: { value: new THREE.Vector2(...CRATER_LAKE) },
        },
      }),
    [],
  )
  return (
    <>
      <mesh geometry={geometry} material={material} />
      {/* Endless ground under the haze so the map never ends in a cliff. */}
      <mesh rotation-x={-Math.PI / 2} position-y={-3}>
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial color={HORIZON} />
      </mesh>
    </>
  )
}
