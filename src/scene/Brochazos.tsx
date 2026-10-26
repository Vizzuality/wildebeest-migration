import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { BRUMA_GLSL, brumaTexture } from '../bruma'
import { MAP, project } from '../geo'
import { BROCHAZO_GLSL, CellPass } from '../shaders/brochazos'
import { GLSL_COMMON, shared } from '../shaders/common'
import { DESIGN_PAPER, DESIGN_RASTER } from '../shaders/figma'
import { RIVER_GLSL, riverUniforms } from '../shaders/rivers'
import { mipmapped, useHeightfield, type Heightfield } from '../terrain'
import { ESPECIES, mancha } from './Fauna'
import { Lienzo } from './Lienzo'

// The Mapa painted in Brochazos: every one a stroke of flat colour, taken from what lies under its
// middle this month and lit by the Relieve. The ground, the vegetation and each Brochazo's paint are
// worked out once a frame per Brochazo; the strokes are then laid on a raster the size of the
// design's, and the Lienzo works that raster as the design's Figma frame does.

/** sRGB hex as a GLSL vec3, still in sRGB: the passes store colours as they look. */
function rgb(hex: string) {
  const [r, g, b] = [1, 3, 5].map((k) => (parseInt(hex.slice(k, k + 2), 16) / 255).toFixed(3))
  return `vec3(${r}, ${g}, ${b})`
}

// Real coordinates: centre of the crater floor, and Lake Magadi from OpenStreetMap.
const CRATER = project([35.575, -3.18])
const CRATER_LAKE = project([35.536, -3.193])

const PASS_HEAD = /* glsl */ `
${GLSL_COMMON}
${BROCHAZO_GLSL}
uniform sampler2D uLake;
uniform sampler2D uCover;

// Which spots turn first when the Verdor changes month: patches a few km across.
float orderAt(vec2 xz) {
  return clamp(0.5 + 0.6 * (tnoise(xz * 0.5 + 11.0) * 0.6 + tnoise(xz * 2.4 - 3.0) * 0.4), 0.0, 1.0);
}
`

/** The ground: rgb its colour, with the Lecho bare; the water over it is the Agua's. */
const sueloFragment = /* glsl */ `
${PASS_HEAD}
${RIVER_GLSL}
uniform sampler2D uCrops;
uniform vec2 uCrater;
uniform vec2 uCraterLake;

void main() {
  vec2 id = CELLS_MIN + floor(gl_FragCoord.xy);
  vec2 xz = brochazoAt(id);
  // A slow swing of tone over a few km, so neighbouring Brochazos stay alike.
  float shade = 0.5 + 0.5 * tnoise(xz * 0.12 + 7.0);
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

  // The lands mixed by their shares: neighbours with the same cover take the same colour.
  // Matorral only half follows the rain: grey-brown thorn at worst, dull olive at best.
  vec3 shrubCol = mix(${rgb('#e0d1a2')}, ${rgb('#b8cd8d')}, g * 0.7);
  // Cultivo: a patchwork of plots, each tilled red soil, stubble or, as the rains come, green crop.
  vec2 plotUv = mat2(0.94, -0.34, 0.34, 0.94) * xz / 2.2;
  vec2 plotId = floor(vec2(plotUv.x, plotUv.y + hash12(vec2(floor(plotUv.x), 7.0))));
  // A plot greens up over a short spell rather than all at once.
  float plot = hash12(plotId + 13.0);
  float sown = g * 0.75;
  float tilled = sown + (1.0 - sown) * 0.55;
  vec3 cropCol = mix(${rgb('#efdca9')}, ${rgb('#e3ad8b')}, smoothstep(tilled + 0.15, tilled - 0.15, plot));
  cropCol = mix(cropCol, ${rgb('#bcd98a')}, smoothstep(sown + 0.15, sown - 0.15, plot));
  vec3 wetCol = mix(${rgb('#c1d6a1')}, ${rgb('#93c08a')}, 0.4 + 0.6 * g);
  float bare = max(0.0, 1.0 - grass - shrub - crop - wet);
  float lands = max(grass + shrub + crop + wet + bare, 1e-3);
  vec3 col = (grassCol * grass + shrubCol * shrub + cropCol * crop + wetCol * wet + ${rgb('#ecdcc3')} * bare) / lands;
  float burns = (grass + shrub) / lands;

  // Quemas: black scar, greying to ash, then fresh shoots greener than the grass around. The 300 m
  // cells of the burn record are bent so scars get the ragged outline of a real fire.
  if (burns > 0.0) {
    vec2 bent = xz + vec2(tnoise(xz * 0.9 + 3.0), tnoise(xz * 0.9 + 21.0)) * 0.6;
    float age = burnAge(bent, order);
    if (age >= 0.0 && age < 8.0) {
      float rag = tnoise(xz * 1.7 + 5.0) * 0.6 + tnoise(xz * 5.3) * 0.4;
      float scar = burnScar(bent, rag);
      vec3 burnt = mix(${rgb('#5f5751')}, ${rgb('#b8aea2')}, smoothstep(0.1, 1.2, age));
      // The fire takes a few days to burn across a spot, so the scar darkens in rather than appearing.
      float raw = 0.85 * smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.6, 3.5, age)) * (1.0 - g);
      col = mix(col, burnt, scar * raw * burns);
      col = mix(col, ${rgb('#a3d283')}, scar * g * 0.5 * (1.0 - smoothstep(4.0, 8.0, age)) * burns);
    }
  }

  // Ngorongoro crater floor and Lake Magadi, its soda lake.
  col = mix(col, fresh, smoothstep(9.0, 7.0, distance(xz, uCrater)) * 0.4);
  if (distance(xz, uCraterLake) < 1.8) col = ${rgb('#f3e8e3')};

  // Rivers: the pale Lecho, whatever water lies on it.
  if (riverAt(xz).lecho) col = mix(${rgb('#ecdcbd')}, ${rgb('#e2cfae')}, shade);

  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * The water: rgb its colour, a how much of the Brochazo it covers, so the paint turns from the
 * Lecho's to the water's as a river rises over it rather than at once.
 */
const aguaFragment = /* glsl */ `
${PASS_HEAD}
${RIVER_GLSL}

void main() {
  vec2 id = CELLS_MIN + floor(gl_FragCoord.xy);
  vec2 xz = brochazoAt(id);
  float shade = 0.5 + 0.5 * tnoise(xz * 0.12 + 7.0);
  if (texture2D(uLake, gridUv(xz)).r > 0.5) {
    gl_FragColor = vec4(mix(${rgb('#5f9bd6')}, ${rgb('#8cbbe7')}, shade), 1.0);
    return;
  }
  // Water while it runs, greyer once it stands in Pozas.
  River river = riverAt(xz);
  vec3 runs = mix(${rgb('#5b9bdb')}, ${rgb('#7fb3e6')}, shade);
  gl_FragColor = vec4(mix(${rgb('#86a9c4')}, runs, smoothstep(0.3, 0.6, river.stage)), river.water);
}
`

/** The vegetation: rgb its colour, a how much of the ground trees cover. */
const vegetacionFragment = /* glsl */ `
${PASS_HEAD}

void main() {
  vec2 id = CELLS_MIN + floor(gl_FragCoord.xy);
  vec2 xz = brochazoAt(id);
  vec4 cover = texture2D(uCover, detailUv(xz, textureSize(uCover, 0)));
  float tree = cover.x;
  float woody = tree + 0.45 * cover.y + 0.3 * cover.z;
  float lake = texture2D(uLake, gridUv(xz)).r;
  float keep = smoothstep(0.06, 0.55, woody) * step(lake, 0.5);
  float g = greenOf(verdor(xz, orderAt(xz)));
  float shade = 0.5 + 0.5 * tnoise(xz * 0.12 + 19.0);
  // Dense canopy (galería, highland forest) stays evergreen; open acacia and bush yellow when dry.
  float dense = smoothstep(0.35, 0.8, tree);
  float bushy = cover.y / max(tree + cover.y, 1e-3);
  vec3 acacia = mix(${rgb('#c6d09a')}, ${rgb('#8dbe7c')}, 0.3 + 0.7 * g);
  vec3 bush = mix(${rgb('#d3d1a0')}, ${rgb('#a6c588')}, 0.8 * g);
  vec3 forest = mix(${rgb('#4b945e')}, ${rgb('#77ab5c')}, shade);
  vec3 col = mix(mix(acacia, bush, bushy), forest, dense);
  gl_FragColor = vec4(col, keep);
}
`

/** A run of the design's dots: where our colour falls along an axis, the design's colour and radius (km). */
type Stop = [axis: number, color: string, km: number]

// Measured against the design's raster with the Mapa in August, the month it shows: each kind of
// Brochazo was ranked along an axis of its colour, and every rank takes the colour and the paint
// coverage the design has at the same rank among its own dots of that kind. The ground runs from
// green to straw on red minus green (the Cultivo's red soil lands on straw, as in the design); trees
// and water run on lightness.
const RAMPS: Record<'ground' | 'tree' | 'water', Stop[]> = {
  ground: [
    [-15.0, '#74af63', 0.73],
    [1.0, '#b8d170', 0.65],
    [8.0, '#dce082', 0.58],
    [12.0, '#e8e389', 0.53],
    [14.0, '#f5e79d', 0.47],
    [16.0, '#f7e7a3', 0.46],
    [19.0, '#f7e5a1', 0.52],
    [39.0, '#f7e49d', 0.51],
    [54.0, '#f6e194', 0.45],
  ],
  tree: [
    [131.9, '#31703c', 0.62],
    [145.8, '#428b4d', 0.63],
    [159.5, '#57994c', 0.66],
    [171.6, '#6ea651', 0.67],
    [183.7, '#93bb62', 0.62],
    [193.4, '#c4d276', 0.62],
    [200.5, '#d9db80', 0.6],
    [208.6, '#eae18b', 0.58],
    [219.7, '#f6e8a0', 0.51],
  ],
  water: [
    [148.4, '#327ac2', 0.68],
    [151.8, '#327ac3', 0.69],
    [154.9, '#377ec5', 0.66],
    [158.2, '#3f91e8', 0.68],
    [163.5, '#4293e9', 0.64],
    [168.7, '#4294e9', 0.67],
    [171.8, '#4394e9', 0.68],
    [175.2, '#4c97e8', 0.69],
    [178.3, '#76b5ed', 0.66],
  ],
}

/** GLSL taking a colour along a ramp, piece by piece. */
function rampGlsl(name: string, axis: string, stops: Stop[]) {
  const steps = stops
    .slice(1)
    .map(([at, color, km], i) => {
      const [from] = stops[i]
      const t = `clamp((v - ${from.toFixed(1)}) / ${(at - from).toFixed(1)}, 0.0, 1.0)`
      return `  t = ${t};\n  col = mix(col, ${rgb(color)}, t);\n  r = mix(r, ${km.toFixed(3)}, t);`
    })
    .join('\n')
  return `void ${name}(vec3 c, out vec3 col, out float r) {
  float v = ${axis};
  float t;
  col = ${rgb(stops[0][1])};
  r = ${stops[0][2].toFixed(3)};
${steps}
}`
}

/** How much steeper than the DEM the light reads the slopes, and how far it moves the colour. */
const RELIEF_GAIN = 5
const RELIEF_DEPTH = 0.6
/**
 * The margin of bare paper inside the Mapa's edge (km): none of it painted for EDGE_BARE_KM, thinning
 * in over EDGE_FADE_KM, its line bitten in and out by up to EDGE_RAG_KM.
 */
const EDGE_BARE_KM = 6
const EDGE_FADE_KM = 14
const EDGE_RAG_KM = 9
/** Half the length of a Brochazo (km): longer than half the spacing, so a row of them joins up. */
const STROKE_KM = 1.05

const CELL_GLSL = /* glsl */ `
vec4 cellOf(sampler2D cells, vec2 id) {
  vec2 texel = id - CELLS_MIN;
  if (any(lessThan(texel, vec2(0.0))) || any(greaterThanEqual(texel, CELLS_SIZE))) return vec4(0.0);
  return texelFetch(cells, ivec2(texel), 0);
}
`

/** The light and the Bruma a Brochazo's paint is laid in, whoever's paint it is. */
const LUZ_GLSL = /* glsl */ `
${GLSL_COMMON}
${BROCHAZO_GLSL}
${BRUMA_GLSL}
${CELL_GLSL}

const vec3 PAPER = ${rgb(DESIGN_PAPER)};
const vec2 MAP_MIN = vec2(${MAP.minX.toFixed(1)}, ${MAP.minZ.toFixed(1)});
const vec2 MAP_MAX = vec2(${MAP.maxX.toFixed(1)}, ${MAP.maxZ.toFixed(1)});
const float RELIEF_GAIN = ${RELIEF_GAIN.toFixed(1)};
const float RELIEF_DEPTH = ${RELIEF_DEPTH.toFixed(2)};

// Hillshade from the Relieve, lit from the north-west: 1 on the flat, more on slopes facing the
// light, less on those turned from it.
float lit(vec2 xz) {
  // Slopes taken over about a km, so the light changes from hill to hill, not from Brochazo to Brochazo.
  const float E = 0.9;
  vec2 slope = vec2(heightAt(xz + vec2(E, 0.0)) - heightAt(xz - vec2(E, 0.0)), heightAt(xz + vec2(0.0, E)) - heightAt(xz - vec2(0.0, E))) / (2.0 * E);
  vec3 n = normalize(vec3(-slope.x * RELIEF_GAIN, 1.0, -slope.y * RELIEF_GAIN));
  const vec3 SUN = normalize(vec3(-0.55, 0.65, -0.55));
  return clamp(dot(n, SUN) / SUN.y, 0.6, 1.2);
}

// How much paint the Bruma lets a Brochazo here have. Towards the Bruma fewer Brochazos are laid,
// and those thin into the paper. Whatever the Bruma keeps painted, nothing reaches the Mapa's own
// edge: a ragged margin of paper hides its square.
float brumaAt(vec2 xz) {
  float inset = min(min(xz.x - MAP_MIN.x, MAP_MAX.x - xz.x), min(xz.y - MAP_MIN.y, MAP_MAX.y - xz.y));
  inset += (tnoise(xz * 0.09 + 31.0) * 0.7 + tnoise(xz * 0.31 - 8.0) * 0.3) * ${EDGE_RAG_KM.toFixed(1)};
  return painted(xz) * smoothstep(${EDGE_BARE_KM.toFixed(1)}, ${(EDGE_BARE_KM + EDGE_FADE_KM).toFixed(1)}, inset);
}

// A colour as it lies on the Lienzo: lit by the Relieve and thinned into the paper by the Bruma.
vec3 laid(vec3 paint, vec2 xz, float bruma) {
  paint = clamp(paint * mix(1.0, lit(xz), RELIEF_DEPTH), 0.0, 1.0);
  return mix(PAPER, paint, 0.45 + 0.55 * bruma);
}
`

/**
 * Each Brochazo as the design would paint it, worked out once a frame: rgb its colour, lit by the
 * Relieve, a how wide its paint lies (km).
 */
const pintaFragment = /* glsl */ `
${LUZ_GLSL}
uniform sampler2D uSuelo;
uniform sampler2D uVegetacion;
uniform sampler2D uAgua;
uniform sampler2D uMancha;

${rampGlsl('groundDot', '(c.r - c.g) * 255.0', RAMPS.ground)}
${rampGlsl('treeDot', 'dot(c, vec3(0.2126, 0.7152, 0.0722)) * 255.0', RAMPS.tree)}
${rampGlsl('waterDot', 'dot(c, vec3(0.2126, 0.7152, 0.0722)) * 255.0', RAMPS.water)}

void main() {
  vec2 id = CELLS_MIN + floor(gl_FragCoord.xy);
  vec2 xz = brochazoAt(id);
  float bruma = brumaAt(xz);
  if (hash12(id + 9.1) >= bruma) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec4 s = cellOf(uSuelo, id);
  vec4 v = cellOf(uVegetacion, id);
  vec4 w = cellOf(uAgua, id);
  vec3 ground;
  float rg;
  groundDot(s.rgb, ground, rg);
  vec3 tree;
  float rt;
  treeDot(v.rgb, tree, rt);
  vec3 water;
  float rw;
  waterDot(w.rgb, water, rw);
  vec3 paint = mix(mix(ground, tree, v.a), water, w.a);
  float r = mix(mix(rg, rt, v.a), rw, w.a);
  float full = mix(v.a, 1.0, w.a);
  // As far as the Mancha's brush has swept along it, the paint lies as thick as a tree's.
  vec4 m = cellOf(uMancha, id);
  float taken = clamp(m.g - m.r, 0.0, 1.0);
  r = mix(r, max(r, ${RAMPS.tree[4][2].toFixed(3)}), taken);
  full = mix(full, 1.0, taken);
  // Narrower than the design's dots on open ground, wider where the paint must cover it whole.
  r *= mix(0.7, 1.15, full);
  gl_FragColor = vec4(laid(paint, xz, bruma), r);
}
`

/** The Mancha's colour on each Brochazo it has, laid as the Brochazo's own paint is. */
const especieFragment = /* glsl */ `
${LUZ_GLSL}
uniform sampler2D uMancha;
uniform vec3 uEspecies[${ESPECIES.length}];

void main() {
  vec2 id = CELLS_MIN + floor(gl_FragCoord.xy);
  vec2 xz = brochazoAt(id);
  vec4 m = cellOf(uMancha, id);
  if (m.g <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 kinds = vec3(m.ba, max(1.0 - m.b - m.a, 0.0));
  vec3 species = (uEspecies[0] * kinds.x + uEspecies[1] * kinds.y + uEspecies[2] * kinds.z) / max(kinds.x + kinds.y + kinds.z, 1e-3);
  gl_FragColor = vec4(laid(species, xz, brumaAt(xz)), 1.0);
}
`

const lienzoFragment = /* glsl */ `
${GLSL_COMMON}
${BROCHAZO_GLSL}
${CELL_GLSL}
uniform sampler2D uPinta;
uniform sampler2D uEspecie;
uniform sampler2D uMancha;

const vec3 PAPER = ${rgb(DESIGN_PAPER)};
const vec2 MAP_MIN = vec2(${MAP.minX.toFixed(1)}, ${MAP.minZ.toFixed(1)});
const vec2 MAP_SPAN = vec2(${(MAP.maxX - MAP.minX).toFixed(1)}, ${(MAP.maxZ - MAP.minZ).toFixed(1)});
const float STROKE_KM = ${STROKE_KM.toFixed(3)};
const vec2 RASTER = vec2(${DESIGN_RASTER.width.toFixed(1)}, ${DESIGN_RASTER.height.toFixed(1)});

// Which way the brush runs at xz: one slow field over the whole picture, so strokes that lie side
// by side run the same way and those in a row join end to end.
float flow(vec2 xz) {
  return (tnoise(xz * 0.04 + 40.0) * 0.7 + tnoise(xz * 0.13 - 17.0) * 0.3) * 3.14159;
}

// Each Brochazo an elongated stroke along the flow, longer than the spacing so a row of them runs
// together.
vec4 trazos(vec2 xz, float texel) {
  vec2 cell = floor(xz / BROCHAZO_KM);
  vec3 col = PAPER;
  float paint = 0.0;
  // A stroke reaches past its neighbour's cell, so two rings of them can touch xz.
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 id = cell + vec2(float(i), float(j));
      vec4 p = cellOf(uPinta, id);
      if (p.a <= 0.0) continue;
      vec2 at = brochazoAt(id);
      float a = flow(at);
      vec2 d = xz - at;
      vec2 q = vec2(cos(a) * d.x + sin(a) * d.y, cos(a) * d.y - sin(a) * d.x) / vec2(STROKE_KM, p.a);
      float cover = clamp((1.0 - length(q)) * p.a / texel + 0.5, 0.0, 1.0);
      // The Mancha's colour runs along the stroke from its start, as far as its brush has swept.
      vec4 m = cellOf(uMancha, id);
      vec3 stroke = p.rgb;
      if (m.g > m.r) {
        float along = q.x * 0.5 + 0.5;
        float edge = texel / (2.0 * STROKE_KM);
        float swept = smoothstep(m.r - edge, m.r + edge, along) * (1.0 - smoothstep(m.g - edge, m.g + edge, along));
        stroke = mix(stroke, cellOf(uEspecie, id).rgb, swept);
      }
      col = mix(col, stroke, cover);
      paint = mix(paint, 1.0, cover);
    }
  }
  return vec4(col, paint);
}

void main() {
  vec2 xz = MAP_MIN + gl_FragCoord.xy / RASTER * MAP_SPAN;
  // a is how much paint covers the texel: the Lienzo filters the paint and leaves the paper as it is.
  gl_FragColor = trazos(xz, MAP_SPAN.x / RASTER.x);
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


const srgb = (hex: string) => new THREE.Vector3(...[1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255))

export function Brochazos() {
  const hf = useHeightfield()
  const passes = useMemo(() => {
    const data = {
      ...shared,
      uLake: { value: lakeTexture(hf) },
      uCover: { value: coverTexture(hf) },
    }
    const suelo = new CellPass(sueloFragment, {
      ...data,
      ...riverUniforms,
      uCrops: { value: cropsTexture(hf) },
      uCrater: { value: new THREE.Vector2(...CRATER) },
      uCraterLake: { value: new THREE.Vector2(...CRATER_LAKE) },
    })
    const vegetacion = new CellPass(vegetacionFragment, data)
    const agua = new CellPass(aguaFragment, { ...data, ...riverUniforms })
    const uShore = { value: brumaTexture() }
    const pinta = new CellPass(pintaFragment, {
      ...shared,
      ...mancha,
      uShore,
      uSuelo: { value: suelo.texture },
      uVegetacion: { value: vegetacion.texture },
      uAgua: { value: agua.texture },
    })
    const especie = new CellPass(especieFragment, {
      ...shared,
      ...mancha,
      uShore,
      uEspecies: { value: ESPECIES.map((e) => srgb(e.color)) },
    })
    const raster = new CellPass(lienzoFragment, { ...shared, ...mancha, uPinta: { value: pinta.texture }, uEspecie: { value: especie.texture } }, DESIGN_RASTER)
    return [suelo, vegetacion, agua, pinta, especie, raster]
  }, [hf])
  useEffect(() => () => passes.forEach((p) => p.dispose()), [passes])

  useFrame(({ gl }) => passes.forEach((p) => p.draw(gl)))

  return <Lienzo raster={passes[passes.length - 1].texture} />
}
