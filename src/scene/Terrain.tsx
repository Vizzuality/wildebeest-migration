import { useMemo } from 'react'
import * as THREE from 'three'
import { MAP, project } from '../geo'
import { GLSL_COMMON, shared } from '../shaders/common'
import { RIVER_GLSL, riverUniforms } from '../shaders/rivers'
import { useHeightfield, type Heightfield } from '../terrain'
import { HORIZON } from './Sky'

/**
 * The mesh keeps one vertex in STRIDE each way. At full resolution most triangles were smaller
 * than a pixel, and the GPU shades every triangle in 2×2 blocks, so the ground shader ran several
 * times per pixel. Normals (finer still than the grid), Cobertura, Cultivo and lakes come from textures
 * instead, so the shading keeps every gully.
 */
const STRIDE = 2

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragment = /* glsl */ `
${GLSL_COMMON}
${RIVER_GLSL}
uniform vec2 uCrater;
uniform vec2 uCraterLake;
uniform sampler2D uNormal;
uniform sampler2D uLake;
uniform sampler2D uCover;
uniform sampler2D uCrops;
varying vec3 vWorld;

// Tree crowns as a mask whose area matches the Cobertura's tree share. Each scale of clumping
// fades out once it is smaller than a pixel, so far away it settles on the plain average.
float canopy(vec2 xz, float tree, float fw) {
  float clumps = 1.0 - smoothstep(0.03, 0.12, fw);
  float crowns = 1.0 - smoothstep(0.008, 0.03, fw);
  if (clumps + crowns <= 0.0) return tree;
  float n = tnoise(xz * 4.0) * clumps * 0.6 + tnoise(xz * 14.0) * crowns * 0.4;
  float u = 0.5 + 0.5 * n / max(clumps * 0.6 + crowns * 0.4, 1e-3);
  float sharp = smoothstep(1.0 - tree - 0.12, 1.0 - tree + 0.12, u);
  return mix(tree, sharp, max(clumps, crowns));
}

void main() {
  vec2 xz = vWorld.xz;
  vec2 grid = gridUv(xz);
  vec2 fine = detailUv(xz, textureSize(uNormal, 0));
  vec2 sideways = texture2D(uNormal, fine).xy;
  vec3 N = normalize(vec3(sideways.x, sqrt(max(0.0, 1.0 - dot(sideways, sideways))), sideways.y));
  vec4 cover = texture2D(uCover, fine);
  float tree = cover.x;
  float shrub = cover.y;
  float wet = cover.z;
  float bare = cover.w;
  float grass = max(0.0, 1.0 - tree - shrub - wet - bare);
  float crop = min(texture2D(uCrops, fine).r, grass);
  grass -= crop;
  float lake = texture2D(uLake, grid).r;
  float fw = length(fwidth(xz));

  float n2 = tnoise(xz * 0.35 + 3.0);
  float n3 = tnoise(xz * 2.2 - 7.0) * (1.0 - smoothstep(0.05, 0.2, fw));
  // Which spots turn first when the Verdor changes month: patches a few km across.
  float order = clamp(0.5 + 0.6 * (tnoise(xz * 0.5 + 11.0) * 0.6 + tnoise(xz * 2.4 - 3.0) * 0.4), 0.0, 1.0);
  float g = greenOf(verdor(xz, order));

  // Hierba swings hardest with the rain: straw in the dry season, fresh green in the rains.
  vec3 straw = mix(srgb(vec3(0.78, 0.62, 0.50)), srgb(vec3(0.66, 0.52, 0.41)), 0.4 + 0.25 * n2);
  vec3 fresh = mix(srgb(vec3(0.41, 0.54, 0.36)), srgb(vec3(0.32, 0.47, 0.27)), 0.4 + 0.25 * n2);
  vec3 grassCol = mix(straw, fresh, g) * (0.96 + 0.05 * n3);
  // Matorral only half follows it: grey-brown Commiphora thorn at worst, dull olive at best.
  vec3 shrubCol = mix(srgb(vec3(0.50, 0.43, 0.31)), srgb(vec3(0.31, 0.41, 0.27)), g * 0.7) * (0.92 + 0.1 * n3);
  vec3 wetCol = mix(srgb(vec3(0.31, 0.42, 0.26)), srgb(vec3(0.19, 0.40, 0.22)), 0.4 + 0.6 * g);
  vec3 bareCol = srgb(vec3(0.72, 0.66, 0.56));

  // Cultivo: a patchwork of plots a few hundred metres across, each tilled red soil, stubble or,
  // as the rains come, green crop. Once plots shrink below a pixel it settles on their average.
  vec2 plotUv = mat2(0.94, -0.34, 0.34, 0.94) * xz / 0.45;
  vec2 plotId = floor(vec2(plotUv.x, plotUv.y + hash12(vec2(floor(plotUv.x), 7.0))));
  float pick = hash12(plotId + 13.0);
  float sown = g * 0.75;
  vec3 soil = srgb(vec3(0.60, 0.40, 0.29));
  vec3 plot = pick < sown ? fresh : pick < sown + (1.0 - sown) * 0.55 ? soil : straw;
  vec3 cropAvg = fresh * sown + (soil * 0.55 + straw * 0.45) * (1.0 - sown);
  vec3 cropCol = mix(cropAvg, plot, 1.0 - smoothstep(0.08, 0.2, fw)) * (0.95 + 0.05 * n3);

  float under = max(1.0 - tree, 1e-3);
  vec3 floorCol = (grassCol * grass + cropCol * crop + shrubCol * shrub + wetCol * wet + bareCol * bare) / under;
  if (grass + crop + shrub + wet + bare < 1e-3) floorCol = grassCol;

  // Quemas: black scar, greying to ash, then fresh shoots greener than the grass around.
  // Bend the 300 m cells of the burn record so scars get the ragged outline of a real fire.
  vec2 bent = xz + vec2(tnoise(xz * 0.9 + 3.0), tnoise(xz * 0.9 + 21.0)) * 0.6;
  float age = burnAge(bent, order);
  if (age >= 0.0 && age < 8.0) {
    float rag = tnoise(xz * 1.7 + 5.0) * 0.6 + tnoise(xz * 5.3) * 0.4;
    float scar = burnScar(bent, rag) * (grass + shrub) / under;
    // Charred for a few weeks, then wind and new growth blur the scar back into the straw.
    vec3 burnt = mix(srgb(vec3(0.10, 0.09, 0.08)), srgb(vec3(0.36, 0.33, 0.29)), smoothstep(0.1, 1.2, age));
    float fresh = 0.85 * (1.0 - smoothstep(0.6, 3.5, age)) * (1.0 - g);
    floorCol = mix(floorCol, burnt, scar * fresh);
    floorCol = mix(floorCol, srgb(vec3(0.26, 0.48, 0.21)), scar * g * 0.4 * (1.0 - smoothstep(4.0, 8.0, age)));
  }

  // Dense canopy (galería, highland forest) stays evergreen; open acacia yellows a little when dry.
  float dense = smoothstep(0.35, 0.8, tree);
  vec3 acacia = mix(srgb(vec3(0.44, 0.42, 0.22)), srgb(vec3(0.22, 0.34, 0.17)), 0.35 + 0.65 * g);
  vec3 forest = srgb(vec3(0.11, 0.24, 0.13));
  vec3 treeCol = mix(acacia, forest, dense) * (0.8 + 0.3 * (0.5 + 0.5 * tnoise(xz * 11.0 + 5.0)));

  // Crowns, plus the shadow each one throws away from the sun.
  float c = canopy(xz, tree, fw);
  float shaded = canopy(xz + uSunDir.xz * 0.035, tree, fw);
  vec3 col = mix(floorCol, treeCol, c);
  col *= 1.0 - 0.4 * shaded * (1.0 - c);

  // Bare rock on steep slopes and high ground.
  vec3 rock = srgb(vec3(0.46, 0.40, 0.34));
  float steep = smoothstep(0.86, 0.62, N.y);
  col = mix(col, rock, steep * 0.8);

  // Rivers: pale Lecho, water turbid with silt when it runs and dark olive once it stands in Pozas.
  River river = riverAt(xz, fw);
  float onLand = 1.0 - smoothstep(0.4, 0.9, lake);
  float weight = mix(0.75, 1.0, river.main) * onLand;
  vec3 waterCol = mix(srgb(vec3(0.15, 0.18, 0.11)), srgb(vec3(0.36, 0.30, 0.20)), smoothstep(0.3, 0.85, river.stage));
  // The current only shows close up; from the usual view it would just shimmer.
  float close = 1.0 - smoothstep(0.01, 0.05, fw);
  if (close > 0.0 && river.water > 0.0) {
    vec2 across = vec2(-river.flow.y, river.flow.x);
    float streak = tnoise(vec2(dot(xz, river.flow) * 8.0 - uClock * (0.3 + 0.6 * river.stage), dot(xz, across) * 40.0));
    waterCol *= 1.0 + 0.12 * streak * close;
  }
  col = mix(col, srgb(vec3(0.62, 0.54, 0.41)), river.lecho * weight);
  col = mix(col, waterCol, river.water * weight);

  // Ngorongoro crater floor and Lake Magadi, its soda lake.
  float dC = distance(xz, uCrater);
  col = mix(col, fresh, smoothstep(9.0, 7.0, dC) * 0.4);
  col = mix(col, srgb(vec3(0.86, 0.80, 0.78)), smoothstep(2.0, 1.5, distance(xz, uCraterLake)));

  // Lakes.
  float shimmer = 0.5 + 0.5 * tnoise(xz * 0.15 + vec2(uClock * 0.05, uClock * 0.03));
  vec3 water = mix(srgb(vec3(0.07, 0.20, 0.27)), srgb(vec3(0.16, 0.36, 0.42)), shimmer * 0.6);
  col = mix(col, water, smoothstep(0.4, 0.9, lake));

  float open = skyOpen(xz);
  // Valleys and the foot of escarpments also lose some bounced sun, not just sky.
  vec3 lit = sunlight(col, N, sunShadow(xz), open) * mix(0.8, 1.0, open);
  lit += water * lake * pow(max(dot(reflect(-uSunDir, N), vec3(0.0, 1.0, 0.0)), 0.0), 8.0) * 0.08;
  float glint = pow(max(dot(reflect(-uSunDir, vec3(0.0, 1.0, 0.0)), normalize(cameraPosition - vWorld)), 0.0), 60.0);
  lit += srgb(vec3(1.0, 0.9, 0.75)) * glint * river.water * weight * 0.6;

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// Real coordinates: centre of the crater floor, and Lake Magadi from OpenStreetMap.
const CRATER = project([35.575, -3.18])
const CRATER_LAKE = project([35.536, -3.193])

function gridIndex(nx: number, nz: number, stride: number) {
  const cols = Math.floor((nx - 1) / stride)
  const rows = Math.floor((nz - 1) / stride)
  const index = new Uint32Array(cols * rows * 6)
  let k = 0
  for (let iz = 0; iz < rows * stride; iz += stride) {
    for (let ix = 0; ix < cols * stride; ix += stride) {
      const a = iz * nx + ix
      const b = a + stride
      const c = a + stride * nx
      const d = c + stride
      index[k++] = a; index[k++] = c; index[k++] = b
      index[k++] = b; index[k++] = c; index[k++] = d
    }
  }
  return index
}

function buildGeometry({ nx, nz, step, heights }: Heightfield) {
  const pos = new Float32Array(nx * nz * 3)
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix
      pos[i * 3] = MAP.minX + ix * step
      pos[i * 3 + 1] = heights[i]
      pos[i * 3 + 2] = MAP.minZ + iz * step
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setIndex(new THREE.BufferAttribute(gridIndex(nx, nz, STRIDE), 1))
  geo.computeBoundingSphere()
  return geo
}

/** Half float so lighting does not band on the plains, where normals barely tilt. */
function normalTexture({ nx, nz, normals, detail }: Heightfield) {
  return linear(new THREE.DataTexture(normals, (nx - 1) * detail + 1, (nz - 1) * detail + 1, THREE.RGFormat, THREE.HalfFloatType))
}

function lakeTexture({ nx, nz, masks }: Heightfield) {
  const data = new Uint8Array(nx * nz)
  for (let i = 0; i < nx * nz; i++) data[i] = Math.round(masks[i * 2 + 1] * 255)
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RedFormat)
  tex.unpackAlignment = 1
  return linear(tex)
}

/** Cobertura at the detail's resolution: a 300 m cell would smear every thicket into its neighbours. */
function coverTexture({ nx, nz, detail, coverDetail }: Heightfield) {
  return linear(new THREE.DataTexture(coverDetail, (nx - 1) * detail + 1, (nz - 1) * detail + 1, THREE.RGBAFormat))
}

function cropsTexture({ nx, nz, detail, cropsDetail }: Heightfield) {
  const tex = new THREE.DataTexture(cropsDetail, (nx - 1) * detail + 1, (nz - 1) * detail + 1, THREE.RedFormat)
  tex.unpackAlignment = 1
  return linear(tex)
}

function linear(tex: THREE.DataTexture) {
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
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
          ...riverUniforms,
          uCrater: { value: new THREE.Vector2(...CRATER) },
          uCraterLake: { value: new THREE.Vector2(...CRATER_LAKE) },
          uNormal: { value: normalTexture(hf) },
          uLake: { value: lakeTexture(hf) },
          uCover: { value: coverTexture(hf) },
          uCrops: { value: cropsTexture(hf) },
        },
      }),
    [hf],
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
