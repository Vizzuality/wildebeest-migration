import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { BRUMA_GLSL, brumaTexture } from '../bruma'
import { MAP, project } from '../geo'
import { BROCHAZO_GLSL, CellPass } from '../shaders/brochazos'
import { GLSL_COMMON, shared } from '../shaders/common'
import { RIVER_GLSL, riverUniforms } from '../shaders/rivers'
import { mipmapped, useHeightfield, type Heightfield } from '../terrain'
import { ESPECIES, mancha } from './Fauna'

// The Mapa painted as a pointillist picture: every Brochazo takes one colour from what lies under
// its middle this month, in two passes, the ground and the vegetation over it. The colour of each
// is worked out once a frame per Brochazo; the picture itself only lays down their shapes.

/** sRGB hex as a GLSL vec3, still in sRGB: the passes store colours as they look. */
function rgb(hex: string) {
  const [r, g, b] = [1, 3, 5].map((k) => (parseInt(hex.slice(k, k + 2), 16) / 255).toFixed(3))
  return `vec3(${r}, ${g}, ${b})`
}

export const PAPER = '#f5f0e3'

/**
 * Brochazos whose rims come closer than about half of FUSE_KM run together through a rounded neck,
 * like two drops of wet paint touching; the larger, the further apart they still join.
 */
const FUSE_KM = 0.6
/** How far in from its rim (km) a Brochazo's paint reaches its full thickness. */
const BODY_KM = 0.2
/** How thick the paint stands (km) for a full measure of it: the deeper, the harder it is lit. */
const IMPASTO_KM = 0.25

// Real coordinates: centre of the crater floor, and Lake Magadi from OpenStreetMap.
const CRATER = project([35.575, -3.18])
const CRATER_LAKE = project([35.536, -3.193])

const PASS_HEAD = /* glsl */ `
${GLSL_COMMON}
${BROCHAZO_GLSL}
${BRUMA_GLSL}
uniform sampler2D uLake;
uniform sampler2D uCover;

const vec3 PAPER = ${rgb(PAPER)};

// Which spots turn first when the Verdor changes month: patches a few km across.
float orderAt(vec2 xz) {
  return clamp(0.5 + 0.6 * (tnoise(xz * 0.5 + 11.0) * 0.6 + tnoise(xz * 2.4 - 3.0) * 0.4), 0.0, 1.0);
}

// Towards the Bruma the paint thins: the colour pales into the paper as it goes.
vec3 thinned(vec3 col, float paint) { return mix(PAPER, col, 0.45 + 0.55 * paint); }
`

/**
 * The ground: rgb its colour, a whether it is painted (0 not; 0.25 land; 0.5–1 water, laid along
 * the river at (a − 0.5) × 2π).
 */
const sueloFragment = /* glsl */ `
${PASS_HEAD}
${RIVER_GLSL}
uniform sampler2D uCrops;
uniform vec2 uCrater;
uniform vec2 uCraterLake;

void main() {
  vec2 id = CELLS_MIN + floor(gl_FragCoord.xy);
  vec2 xz = brochazoAt(id);
  float paint = painted(xz);
  if (hash12(id + 9.1) >= paint) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float shade = hash12(id + 23.9);
  vec2 fine = detailUv(xz, textureSize(uCover, 0));
  vec4 cover = texture2D(uCover, fine);
  float shrub = cover.y;
  float wet = cover.z;
  // Under the trees this pass paints grass; the canopy is the vegetation's.
  float grass = max(0.0, 1.0 - cover.y - cover.z - cover.w);
  float crop = min(texture2D(uCrops, fine).r, grass);
  grass -= crop;
  float order = orderAt(xz);
  float g = greenOf(verdor(xz, order));

  // Hierba swings hardest with the rain: straw in the dry season, fresh green in the rains.
  vec3 straw = mix(${rgb('#f3e7b3')}, ${rgb('#ead99a')}, shade);
  vec3 fresh = mix(${rgb('#dbe69f')}, ${rgb('#bfd88c')}, shade);
  vec3 grassCol = mix(straw, fresh, g);

  // Each Brochazo is one land, drawn by the shares, so a mix reads in how many of each there are.
  float pick = hash12(id + 61.7);
  vec3 col = ${rgb('#ecdcc3')};
  bool burns = false;
  if (pick < grass) {
    col = grassCol;
    burns = true;
  } else if (pick < grass + shrub) {
    // Matorral only half follows the rain: grey-brown thorn at worst, dull olive at best.
    col = mix(${rgb('#e0d1a2')}, ${rgb('#b8cd8d')}, g * 0.7);
    burns = true;
  } else if (pick < grass + shrub + crop) {
    // Cultivo: a patchwork of plots, each tilled red soil, stubble or, as the rains come, green crop.
    vec2 plotUv = mat2(0.94, -0.34, 0.34, 0.94) * xz / 2.2;
    vec2 plotId = floor(vec2(plotUv.x, plotUv.y + hash12(vec2(floor(plotUv.x), 7.0))));
    // A plot greens up over a short spell rather than all at once.
    float plot = hash12(plotId + 13.0);
    float sown = g * 0.75;
    float tilled = sown + (1.0 - sown) * 0.55;
    col = mix(${rgb('#efdca9')}, ${rgb('#e3ad8b')}, smoothstep(tilled + 0.06, tilled - 0.06, plot));
    col = mix(col, ${rgb('#bcd98a')}, smoothstep(sown + 0.06, sown - 0.06, plot));
  } else if (pick < grass + shrub + crop + wet) {
    col = mix(${rgb('#c1d6a1')}, ${rgb('#93c08a')}, 0.4 + 0.6 * g);
  }

  // Quemas: black scar, greying to ash, then fresh shoots greener than the grass around. The 300 m
  // cells of the burn record are bent so scars get the ragged outline of a real fire.
  if (burns) {
    vec2 bent = xz + vec2(tnoise(xz * 0.9 + 3.0), tnoise(xz * 0.9 + 21.0)) * 0.6;
    float age = burnAge(bent, order);
    if (age >= 0.0 && age < 8.0) {
      float rag = tnoise(xz * 1.7 + 5.0) * 0.6 + tnoise(xz * 5.3) * 0.4;
      float scar = burnScar(bent, rag);
      vec3 burnt = mix(${rgb('#5f5751')}, ${rgb('#b8aea2')}, smoothstep(0.1, 1.2, age));
      float raw = 0.85 * (1.0 - smoothstep(0.6, 3.5, age)) * (1.0 - g);
      col = mix(col, burnt, scar * raw);
      col = mix(col, ${rgb('#a3d283')}, scar * g * 0.5 * (1.0 - smoothstep(4.0, 8.0, age)));
    }
  }

  // Ngorongoro crater floor and Lake Magadi, its soda lake.
  col = mix(col, fresh, smoothstep(9.0, 7.0, distance(xz, uCrater)) * 0.4);
  if (distance(xz, uCraterLake) < 1.8) col = ${rgb('#f3e8e3')};

  // Rivers: pale Lecho, water while it runs and greyer once it stands in Pozas, laid along the flow.
  float laid = 0.25;
  River river = riverAt(xz);
  if (river.water) {
    vec3 runs = mix(${rgb('#5b9bdb')}, ${rgb('#7fb3e6')}, shade);
    col = mix(${rgb('#86a9c4')}, runs, smoothstep(0.3, 0.6, river.stage));
    laid = 0.5 + 0.5 * fract(atan(river.flow.y, river.flow.x) / 6.28318530718);
  } else if (river.lecho) {
    col = mix(${rgb('#ecdcbd')}, ${rgb('#e2cfae')}, shade);
  }

  if (texture2D(uLake, gridUv(xz)).r > 0.5) col = mix(${rgb('#5f9bd6')}, ${rgb('#8cbbe7')}, shade);

  gl_FragColor = vec4(thinned(col, paint), laid);
}
`

/** The vegetation: rgb its colour, a whether it is painted. */
const vegetacionFragment = /* glsl */ `
${PASS_HEAD}

void main() {
  vec2 id = CELLS_MIN + floor(gl_FragCoord.xy);
  vec2 xz = vegetacionAt(id);
  float paint = painted(xz);
  vec4 cover = texture2D(uCover, detailUv(xz, textureSize(uCover, 0)));
  float tree = cover.x;
  float woody = tree + 0.45 * cover.y + 0.3 * cover.z;
  float lake = texture2D(uLake, gridUv(xz)).r;
  float keep = smoothstep(0.06, 0.55, woody) * paint * step(lake, 0.5);
  if (hash12(id + 3.3) >= keep) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float g = greenOf(verdor(xz, orderAt(xz)));
  float shade = hash12(id + 41.3);
  // Dense canopy (galería, highland forest) stays evergreen; open acacia and bush yellow when dry.
  float dense = smoothstep(0.35, 0.8, tree);
  float bushy = cover.y / max(tree + cover.y, 1e-3);
  vec3 acacia = mix(${rgb('#c6d09a')}, ${rgb('#8dbe7c')}, 0.3 + 0.7 * g);
  vec3 bush = mix(${rgb('#d3d1a0')}, ${rgb('#a6c588')}, 0.8 * g);
  vec3 forest = mix(${rgb('#4b945e')}, ${rgb('#77ab5c')}, shade);
  vec3 col = mix(mix(acacia, bush, bushy), forest, dense);
  col *= 0.88 + 0.24 * hash12(id + 87.1);
  gl_FragColor = vec4(thinned(col, paint), 1.0);
}
`

const vertex = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragment = /* glsl */ `
${GLSL_COMMON}
${BROCHAZO_GLSL}
uniform sampler2D uSuelo;
uniform sampler2D uVegetacion;
uniform sampler2D uMancha;
uniform vec3 uPaper;
uniform vec3 uEspecies[${ESPECIES.length}];
varying vec2 vWorld;

const float PI = 3.14159265359;

// Which way the brush runs at xz: a painter works a patch at a time, so neighbouring Brochazos
// lie roughly the same way and only drift from it a little.
float brushAngle(vec2 xz, vec2 id) {
  return (tnoise(xz * 0.12 + 40.0) * 0.8 + tnoise(xz * 0.4 - 17.0) * 0.2) * 1.6 * PI + (hash12(id + 13.1) - 0.5) * 0.5;
}

vec4 cellOf(sampler2D cells, vec2 id) {
  vec2 texel = id - CELLS_MIN;
  if (any(lessThan(texel, vec2(0.0))) || any(greaterThanEqual(texel, CELLS_SIZE))) return vec4(0.0);
  return texelFetch(cells, ivec2(texel), 0);
}

// How far p is (km) outside a Brochazo's ragged rim, negative inside it: a dab long along its
// angle. along is how far p is along it, 0 at its start and 1 at its end; bristles is how thick the
// paint stands there, furrowed along the stroke by the brush's hairs.
float dab(vec2 p, vec2 c, float angle, vec2 size, vec2 id, out float along, out float bristles) {
  vec2 d = p - c;
  float ca = cos(angle);
  float sa = sin(angle);
  vec2 q = vec2(ca * d.x + sa * d.y, ca * d.y - sa * d.x) / size;
  along = q.x * 0.5 + 0.5;
  bristles = 0.75 + 0.25 * sin(q.y * 10.0 + hash12(id + 5.9) * 6.28 + tnoise(vec2(q.x * 1.5, id.x)) * 2.0);
  float r = length(q);
  float rag = tnoise(p * 2.5 + id * 3.1) * 0.12 + tnoise(p * 6.0 - id) * 0.06;
  return (r + rag - 1.0) * size.y;
}

const float FUSE_KM = ${FUSE_KM.toFixed(3)};

// One pass of paint at p, built up a Brochazo at a time: rim is how far p is outside the fused paint,
// nearest how far outside the nearest Brochazo, whose colour and bristles it takes, so fused
// Brochazos share an outline but each keeps a crisp colour of its own.
struct Pass {
  float rim;
  float nearest;
  vec3 col;
  float bristles;
};

Pass none() { return Pass(1e3, 1e3, vec3(0.0), 0.0); }

void add(inout Pass pass, float d, vec3 col, float bristles) {
  float h = max(FUSE_KM - abs(pass.rim - d), 0.0) / FUSE_KM;
  pass.rim = min(pass.rim, d) - h * h * FUSE_KM * 0.25;
  if (d < pass.nearest) {
    pass.nearest = d;
    pass.col = col;
    pass.bristles = bristles;
  }
}

// Lays the pass over col; shown is how much of it shows at p, and its paint how thick it stands.
vec3 laid(vec3 col, Pass pass, float fw, out float shown, out float paint) {
  float edge = 0.7 * fw;
  shown = 1.0 - smoothstep(-edge, edge, pass.rim);
  paint = shown * smoothstep(0.0, ${BODY_KM.toFixed(3)}, -pass.rim) * pass.bristles;
  return mix(col, pass.col, shown);
}

// Impasto: the paint stands off the paper as thick as it was laid, so it catches the light from the
// top left of the picture on one side of every stroke and falls into shadow on the other.
const vec3 LIGHT = vec3(-0.55, 0.55, 0.63);
vec3 lit(vec3 col, float height, float fw) {
  vec2 slope = vec2(dFdx(height), dFdy(height)) / max(fw, 1e-6) * ${IMPASTO_KM.toFixed(3)};
  vec3 n = normalize(vec3(-slope, 1.0));
  float light = dot(n, LIGHT) / LIGHT.z;
  return col * clamp(mix(1.0, light, 0.6), 0.6, 1.35);
}

// Broken colour, as Seurat laid it: each Brochazo takes a purer, warmer, cooler or lighter take on
// the colour under it, and they only mix back into that colour in the eye of whoever looks.
vec3 broken(vec3 col, vec2 id) {
  float pick = hash12(id + 91.7);
  vec3 tint = pick < 0.25 ? vec3(1.25, 1.1, 0.6) : pick < 0.5 ? vec3(0.8, 0.9, 1.45) : pick < 0.75 ? vec3(1.18) : vec3(0.82);
  vec3 pure = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.15);
  return max(pure * tint, 0.0);
}

// The Mancha does not change a Brochazo, it repaints it in the colour of its species, over as
// much of its length as the brush has swept. The brush's front is ragged across the stroke.
vec3 manchaOver(vec3 col, vec2 cell, float along, vec2 p) {
  vec4 m = cellOf(uMancha, cell);
  if (m.g <= 0.0) return col;
  vec3 kinds = vec3(m.ba, max(1.0 - m.b - m.a, 0.0));
  vec3 species = (uEspecies[0] * kinds.x + uEspecies[1] * kinds.y + uEspecies[2] * kinds.z) / max(kinds.x + kinds.y + kinds.z, 1e-3);
  float s = along + tnoise(p * 9.0 + cell) * 0.12;
  float swept = smoothstep(m.r - 0.08, m.r + 0.08, s) * (1.0 - smoothstep(m.g - 0.08, m.g + 0.08, s));
  return mix(col, species, swept);
}

void main() {
  vec2 xz = vWorld;
  float fw = length(fwidth(xz));
  vec3 col = uPaper * (0.99 + 0.02 * tnoise(xz * 1.3));

  vec2 cell = floor(xz / BROCHAZO_KM);
  Pass pass = none();
  float bristles;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = cell + vec2(float(i), float(j));
      vec4 s = cellOf(uSuelo, id);
      if (s.a < 0.1) continue;
      bool water = s.a > 0.4;
      vec2 at = brochazoAt(id);
      float angle = water ? (s.a - 0.5) * 4.0 * PI : brushAngle(at, id);
      float len = BROCHAZO_KM * mix(0.55, 0.7, hash12(id + 2.9));
      float wide = len * mix(0.38, 0.55, hash12(id + 8.3));
      float along;
      float d = dab(xz, at, angle, vec2(len, wide), id, along, bristles);
      if (d > FUSE_KM) continue;
      add(pass, d, broken(manchaOver(srgb(s.rgb), id, along, xz), id), bristles);
    }
  }
  float shown;
  float paint;
  col = laid(col, pass, fw, shown, paint);
  float height = paint;
  cell = floor(xz / BROCHAZO_KM - 0.5);
  pass = none();
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = cell + vec2(float(i), float(j));
      vec4 s = cellOf(uVegetacion, id);
      if (s.a < 0.5) continue;
      vec2 at = vegetacionAt(id);
      float len = BROCHAZO_KM * mix(0.46, 0.6, hash12(id + 4.7));
      float along;
      float d = dab(xz, at, brushAngle(at, id + 0.5), vec2(len, len * mix(0.45, 0.65, hash12(id + 6.1))), id + 0.5, along, bristles);
      if (d > FUSE_KM) continue;
      add(pass, d, broken(manchaOver(srgb(s.rgb), floor(at / BROCHAZO_KM), along, xz), id + 0.5), bristles);
    }
  }
  col = laid(col, pass, fw, shown, paint);
  col = lit(col, height + paint, fw);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

function lakeTexture({ nx, nz, masks }: Heightfield) {
  const data = new Uint8Array(nx * nz)
  for (let i = 0; i < nx * nz; i++) data[i] = Math.round(masks[i * 2 + 1] * 255)
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RedFormat)
  tex.unpackAlignment = 1
  return mipmapped(tex)
}

/** Cobertura at the detail's resolution: a 300 m cell would smear every thicket into its neighbours. */
function coverTexture({ nx, nz, detail, coverDetail }: Heightfield) {
  return mipmapped(new THREE.DataTexture(coverDetail, (nx - 1) * detail + 1, (nz - 1) * detail + 1, THREE.RGBAFormat))
}

function cropsTexture({ nx, nz, detail, cropsDetail }: Heightfield) {
  const tex = new THREE.DataTexture(cropsDetail, (nx - 1) * detail + 1, (nz - 1) * detail + 1, THREE.RedFormat)
  tex.unpackAlignment = 1
  return mipmapped(tex)
}

const linear = (hex: string) => new THREE.Color(hex)

/** Paper round the Mapa, wide enough to fill any screen whatever the framing. */
const SHEET = 4 * Math.max(MAP.maxX - MAP.minX, MAP.maxZ - MAP.minZ)

export function Brochazos() {
  const hf = useHeightfield()
  const [suelo, vegetacion, uniforms] = useMemo(() => {
    const data = {
      ...shared,
      uLake: { value: lakeTexture(hf) },
      uCover: { value: coverTexture(hf) },
      uShore: { value: brumaTexture() },
    }
    const suelo = new CellPass(sueloFragment, {
      ...data,
      ...riverUniforms,
      uCrops: { value: cropsTexture(hf) },
      uCrater: { value: new THREE.Vector2(...CRATER) },
      uCraterLake: { value: new THREE.Vector2(...CRATER_LAKE) },
    })
    const vegetacion = new CellPass(vegetacionFragment, data)
    const uniforms = {
      ...shared,
      ...mancha,
      uSuelo: { value: suelo.texture },
      uVegetacion: { value: vegetacion.texture },
      uPaper: { value: linear(PAPER) },
      uEspecies: { value: ESPECIES.map((e) => linear(e.color)) },
    }
    return [suelo, vegetacion, uniforms]
  }, [hf])
  const material = useMemo(() => new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms }), [uniforms])

  useEffect(
    () => () => {
      suelo.dispose()
      vegetacion.dispose()
      material.dispose()
    },
    [suelo, vegetacion, material],
  )

  useFrame(({ gl }) => {
    suelo.draw(gl)
    vegetacion.draw(gl)
  })

  return (
    <mesh material={material} position={[(MAP.minX + MAP.maxX) / 2, 0, (MAP.minZ + MAP.maxZ) / 2]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[SHEET, SHEET]} />
    </mesh>
  )
}
