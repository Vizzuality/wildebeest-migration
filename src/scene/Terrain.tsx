import { useMemo } from 'react'
import * as THREE from 'three'
import { LAT0, LON0, MAP } from '../geo'
import { GLSL_COMMON, shared } from '../shaders/common'
import { HF, NGORO_XZ } from '../terrain'
import { HORIZON } from './Sky'

const vertex = /* glsl */ `
${GLSL_COMMON}
attribute vec3 aMask;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vMask;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normal;
  vMask = aMask;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const fragment = /* glsl */ `
${GLSL_COMMON}
uniform vec2 uCrater;
uniform vec2 uMapMax;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vMask;
#include <fog_pars_fragment>

float gridLine(float v, float spacing) {
  float d = abs(fract(v / spacing + 0.5) - 0.5) * spacing;
  float w = fwidth(v) * 1.2;
  return 1.0 - smoothstep(0.0, w, d);
}

void main() {
  vec3 N = normalize(vNormal);
  vec2 xz = vWorld.xz;
  float wood = clamp(vMask.x, 0.0, 1.0);
  float riverD = vMask.y;
  float lake = vMask.z;

  float n1 = snoise(xz * 0.08);
  float n2 = snoise(xz * 0.35 + 3.0);
  float g = clamp(greenness(xz.y, uMonth) * (0.82 + 0.25 * n1) + 0.2 * wood, 0.0, 1.0);

  vec3 straw = srgb(vec3(0.80, 0.66, 0.40));
  vec3 strawDark = srgb(vec3(0.62, 0.47, 0.27));
  vec3 grass = srgb(vec3(0.52, 0.60, 0.27));
  vec3 lush = srgb(vec3(0.30, 0.44, 0.17));
  vec3 olive = srgb(vec3(0.33, 0.36, 0.17));
  vec3 rock = srgb(vec3(0.46, 0.40, 0.34));

  vec3 dry = mix(straw, strawDark, 0.5 + 0.5 * n2);
  vec3 green = mix(grass, lush, clamp(wood + 0.3 * n2, 0.0, 1.0));
  vec3 col = mix(dry, green, g);
  col = mix(col, mix(olive, lush, g), wood * 0.55 * (0.6 + 0.4 * n2));

  // Bare rock on steep slopes and high ground.
  float steep = smoothstep(0.86, 0.62, N.y);
  col = mix(col, rock, steep * 0.8);

  // Ngorongoro crater floor and its soda lake.
  float dC = distance(xz, uCrater);
  col = mix(col, mix(grass, lush, 0.4), smoothstep(6.0, 4.0, dC) * 0.7);
  col = mix(col, srgb(vec3(0.86, 0.80, 0.78)), smoothstep(1.6, 1.2, distance(xz, uCrater + vec2(0.8, 1.0))));

  // Riparian (gallery) forest along the rivers.
  col = mix(col, srgb(vec3(0.16, 0.30, 0.12)), (1.0 - smoothstep(0.8, 2.6, riverD)) * 0.85);

  // Lake Victoria.
  float shimmer = 0.5 + 0.5 * snoise(xz * 0.15 + vec2(uClock * 0.05, uClock * 0.03));
  vec3 water = mix(srgb(vec3(0.07, 0.20, 0.27)), srgb(vec3(0.16, 0.36, 0.42)), shimmer * 0.6);
  col = mix(col, water, smoothstep(0.4, 0.9, lake));

  // Drifting cloud shadows where it is raining this month.
  float rainy = smoothstep(30.0, 120.0, rainAt(xz.y, uMonth));
  float cloud = smoothstep(0.25, 0.75, snoise(xz * 0.012 + vec2(uClock * 0.012, uClock * 0.005)) * 0.7 + 0.3 * snoise(xz * 0.04 - uClock * 0.01));
  float shadow = cloud * rainy * 0.45;

  // Lighting: warm low sun, cool sky fill.
  float diff = max(dot(N, uSunDir), 0.0);
  vec3 sun = srgb(vec3(1.0, 0.86, 0.66)) * 1.55;
  vec3 sky = mix(srgb(vec3(0.45, 0.42, 0.40)), srgb(vec3(0.55, 0.62, 0.75)), N.y * 0.5 + 0.5) * 0.55;
  vec3 lit = col * (sky + sun * diff * (1.0 - shadow));
  lit += water * lake * pow(max(dot(reflect(-uSunDir, N), vec3(0.0, 1.0, 0.0)), 0.0), 8.0) * 0.08;

  // Graticule every half degree.
  float lon = vWorld.x / 111.0 + ${LON0.toFixed(2)};
  float lat = -vWorld.z / 111.0 + ${LAT0.toFixed(2)};
  float grid = max(gridLine(lon, 0.5), gridLine(lat, 0.5));
  lit = mix(lit, vec3(1.0, 0.95, 0.85), grid * 0.12);

  vec2 edge = min(xz - uMapMin, uMapMax - xz);
  float fade = 1.0 - smoothstep(0.0, 22.0, min(edge.x, edge.y));
  lit = mix(lit, fogColor, fade);

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

function buildGeometry() {
  const { nx, nz, step, heights, masks } = HF
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
  geo.setAttribute('aMask', new THREE.BufferAttribute(masks, 3))
  geo.setIndex(new THREE.BufferAttribute(index, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

export function Terrain() {
  const geometry = useMemo(() => buildGeometry(), [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          ...shared,
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uCrater: { value: new THREE.Vector2(NGORO_XZ[0], NGORO_XZ[1]) },
          uMapMax: { value: new THREE.Vector2(MAP.maxX, MAP.maxZ) },
        },
        fog: true,
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
