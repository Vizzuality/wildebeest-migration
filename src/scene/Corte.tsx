import { useMemo } from 'react'
import * as THREE from 'three'
import { type Corte as Island, corteOf, distanceField, FIELD_OFFSET, meshHeight, seaward } from '../corte'
import { MAP } from '../geo'
import { GLSL_COMMON, shared } from '../shaders/common'
import { type Heightfield, useHeightfield } from '../terrain'

// Corte: the Mapa is a piece broken out of the ground, like a museum relief model. Its jagged
// sides drop as walls that follow the Relieve along the edge and show the strata under it, and
// the piece stands on a table that fades into the haze at the horizon.

/** How far the block reaches below the lowest ground (scene units). */
const THICKNESS = 7
/** Below the surface the walls show this much soil before the strata start. */
const SOIL = 0.12
/** Where a Lago meets the edge, the wall shows its water this deep. */
const WATER = 0.9
/** Pale sand, lighter than the sky's horizon so the piece stands out on it. */
const TABLE = '#e6d2b8'

const wallVertex = /* glsl */ `
attribute float aTop;
attribute float aLake;
attribute float aAlong;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vTop;
varying float vLake;
varying float vAlong;
void main() {
  vWorld = position;
  vAlong = aAlong;
  vNormal = normal;
  vTop = aTop;
  vLake = aLake;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`

const wallFragment = /* glsl */ `
${GLSL_COMMON}
uniform float uBase;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vTop;
varying float vLake;
varying float vAlong;

// Volcanic tuff, laterite, ash, sandstone: the layers under the plains, warm and earthy.
vec3 stratum(float id) {
  float h = hash12(vec2(id, 3.7));
  if (h < 0.22) return srgb(vec3(0.62, 0.36, 0.24));
  if (h < 0.42) return srgb(vec3(0.74, 0.58, 0.42));
  if (h < 0.58) return srgb(vec3(0.52, 0.42, 0.34));
  if (h < 0.76) return srgb(vec3(0.80, 0.70, 0.56));
  if (h < 0.90) return srgb(vec3(0.45, 0.30, 0.22));
  return srgb(vec3(0.34, 0.31, 0.29));
}

void main() {
  vec3 N = normalize(vNormal);
  float along = vAlong;
  float depth = vTop - vWorld.y;
  float fw = fwidth(vWorld.y);

  // The layers lie flat and fold gently, so the Relieve cuts across them like real ground.
  float g = vWorld.y + tnoise(vec2(along * 0.04, 1.3)) * 0.9 + tnoise(vec2(along * 0.25, 7.1)) * 0.2;
  float thick = 0.55;
  float id = floor(g / thick);
  float f = fract(g / thick);
  vec3 col = stratum(id);
  // A thin dark parting under every layer, and fine grain within it.
  col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.06 + fw * 2.0, f));
  col *= 0.9 + 0.1 * tnoise(vec2(along * 3.0, g * 22.0));
  // Deeper down the rock turns to dark basement.
  float deep = smoothstep(uBase + ${(THICKNESS * 0.55).toFixed(2)}, uBase + 1.0, vWorld.y);
  col = mix(col, srgb(vec3(0.24, 0.21, 0.20)) * (0.9 + 0.1 * tnoise(vec2(along * 1.5, g * 6.0))), deep * 0.85);

  // Topsoil: a ragged dark band right under the surface.
  float soil = ${SOIL.toFixed(2)} * (1.0 + 0.6 * tnoise(vec2(along * 1.7, 2.0)));
  col = mix(col, srgb(vec3(0.27, 0.19, 0.13)), 1.0 - smoothstep(soil, soil + 0.04 + fw, depth));

  // Where a Lago reaches the edge: its water, darker with depth, over silt.
  if (vLake > 0.01) {
    vec3 shallow = srgb(vec3(0.16, 0.36, 0.42));
    vec3 deepWater = srgb(vec3(0.04, 0.12, 0.18));
    vec3 water = mix(shallow, deepWater, smoothstep(0.0, ${WATER.toFixed(2)}, depth));
    vec3 silt = srgb(vec3(0.40, 0.38, 0.33)) * (0.9 + 0.1 * tnoise(vec2(along * 2.0, depth * 30.0)));
    float bed = smoothstep(${WATER.toFixed(2)}, ${WATER.toFixed(2)} + 0.05 + fw, depth);
    vec3 lakeCol = mix(water, silt, bed);
    float under = 1.0 - smoothstep(${(WATER + 0.3).toFixed(2)}, ${(WATER + 0.5).toFixed(2)}, depth);
    col = mix(col, lakeCol, smoothstep(0.3, 0.7, vLake) * max(under, 1.0 - bed));
  }

  vec3 lit = sunlight(col, N, 0.0);
  // Ambient light pools less near the foot, where the table hides the sky.
  lit *= mix(0.55, 1.0, smoothstep(uBase, uBase + 2.5, vWorld.y));
  // Bright lip where the cut meets the surface, catching the sun.
  lit += srgb(vec3(1.0, 0.88, 0.7)) * 0.25 * (1.0 - smoothstep(0.0, 0.02 + fw * 1.5, depth));

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const tableVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const tableFragment = /* glsl */ `
uniform vec3 uTable;
uniform vec3 uSunDir;
uniform sampler2D uField;
uniform vec2 uFieldMin;
uniform vec2 uFieldSize;
uniform vec2 uCentre;
uniform float uHeight;
varying vec3 vWorld;

// Distance to the Corte's outline (km), negative inside.
float outline(vec2 p) {
  return texture2D(uField, (p - uFieldMin) / uFieldSize).r * 127.5 - ${FIELD_OFFSET.toFixed(1)};
}

void main() {
  vec2 xz = vWorld.xz;
  // Contact shadow hugging the foot of the block, and the soft shadow it throws away from the sun.
  float contact = exp(-max(outline(xz), 0.0) / 2.5);
  vec2 away = -uSunDir.xz / uSunDir.y * uHeight;
  float shadow = 1.0 - smoothstep(-6.0, 14.0, outline(xz - away * 0.5));
  vec3 col = uTable * (1.0 - 0.45 * contact) * (1.0 - 0.25 * shadow);
  // Far out the table thins away into the sky behind it, so the two never meet in a line.
  float centre = length(xz - uCentre);
  gl_FragColor = vec4(col, 1.0 - smoothstep(350.0, 1100.0, centre));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/**
 * Walls down every stretch of coast, their top sampled at the grid step so they follow the Relieve
 * and meet the terrain mesh without a gap, and lit facing out to sea.
 */
function wallGeometry(hf: Heightfield, island: Island, base: number) {
  const pos: number[] = []
  const nor: number[] = []
  const top: number[] = []
  const lake: number[] = []
  const along: number[] = []
  const index: number[] = []
  const lakeAt = (x: number, z: number) => {
    const ix = Math.round((x - MAP.minX) / hf.step)
    const iz = Math.round((z - MAP.minZ) / hf.step)
    return hf.masks[(iz * hf.nx + ix) * 2 + 1]
  }
  let walked = 0
  for (const loop of island.loops) {
    const first = pos.length / 3
    let count = 0
    const put = (x: number, z: number) => {
      const h = meshHeight(hf, x, z) + 0.004
      const l = lakeAt(x, z)
      const [sx, sz] = seaward(island, x, z)
      pos.push(x, h, z, x, base, z)
      nor.push(sx, 0, sz, sx, 0, sz)
      top.push(h, h)
      lake.push(l, l)
      along.push(walked, walked)
      count++
    }
    loop.forEach(([ax, az], i) => {
      const [bx, bz] = loop[(i + 1) % loop.length]
      const length = Math.hypot(bx - ax, bz - az)
      const steps = Math.max(1, Math.ceil(length / hf.step))
      for (let k = 0; k < steps; k++) {
        put(ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps)
        walked += length / steps
      }
    })
    for (let k = 0; k < count; k++) {
      const a = first + k * 2
      const b = first + ((k + 1) % count) * 2
      index.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1))
  geo.setAttribute('aLake', new THREE.Float32BufferAttribute(lake, 1))
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
  geo.setIndex(index)
  geo.computeBoundingSphere()
  return geo
}

export function Corte() {
  const hf = useHeightfield()
  const { walls, table, base } = useMemo(() => {
    const base = hf.heights.reduce((lo, h) => Math.min(lo, h), 0) - THICKNESS
    const corte = corteOf(hf)
    const { maxX, maxZ } = corte
    const walls = new THREE.Mesh(
      wallGeometry(hf, corte, base),
      new THREE.ShaderMaterial({
        vertexShader: wallVertex,
        fragmentShader: wallFragment,
        side: THREE.DoubleSide,
        uniforms: { ...shared, uBase: { value: base } },
      }),
    )
    const field = distanceField(corte)
    const table = new THREE.ShaderMaterial({
      vertexShader: tableVertex,
      fragmentShader: tableFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTable: { value: new THREE.Color(TABLE).convertSRGBToLinear() },
        uSunDir: shared.uSunDir,
        uField: { value: field.tex },
        uFieldMin: { value: field.min },
        uFieldSize: { value: field.size },
        uCentre: { value: new THREE.Vector2((MAP.minX + maxX) / 2, (MAP.minZ + maxZ) / 2) },
        uHeight: { value: THICKNESS },
      },
    })
    return { walls, table, base }
  }, [hf])
  return (
    <>
      <primitive object={walls} />
      <mesh rotation-x={-Math.PI / 2} position-y={base} material={table}>
        <circleGeometry args={[1300, 64]} />
      </mesh>
    </>
  )
}
