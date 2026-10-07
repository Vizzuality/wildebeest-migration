import * as THREE from 'three'
import { MAP } from '../geo'
import type { RiverLine } from '../terrain'

/** How far (km) either side of a channel the river field reaches. */
const REACH = 1.5
const FIELD_W = 2048
const FIELD_H = Math.round((FIELD_W * (MAP.maxZ - MAP.minZ)) / (MAP.maxX - MAP.minX))
/** Room in the uniform arrays; the bake has nine rivers. */
const MAX_RIVERS = 16

/** Real half-width of the Lecho (km), and the narrowest it may get on screen (pixels across). */
const LECHO: Record<RiverLine['kind'], { half: number; minPx: number }> = {
  main: { half: 0.05, minPx: 1.5 },
  tributary: { half: 0.02, minPx: 1.0 },
}

export const riverUniforms = {
  uRiverField: { value: null as THREE.Texture | null },
  uRiverFieldSize: { value: new THREE.Vector2(FIELD_W, FIELD_H) },
  uRiverStage: { value: new Array<number>(MAX_RIVERS).fill(0) },
  uRiverHalf: { value: new Array<number>(MAX_RIVERS).fill(0) },
  uRiverMinPx: { value: new Array<number>(MAX_RIVERS).fill(1) },
  uRiverMain: { value: new Array<number>(MAX_RIVERS).fill(0) },
}

const bakeVertex = /* glsl */ `
attribute float aAcross;
attribute float aAngle;
attribute float aId;
varying float vAcross;
varying float vAngle;
varying float vId;
void main() {
  vAcross = aAcross;
  vAngle = aAngle;
  vId = aId;
  vec2 ndc = (position.xz - vec2(${MAP.minX.toFixed(1)}, ${MAP.minZ.toFixed(1)})) /
    vec2(${(MAP.maxX - MAP.minX).toFixed(1)}, ${(MAP.maxZ - MAP.minZ).toFixed(1)}) * 2.0 - 1.0;
  // Depth is the distance to the channel, so where ribbons overlap the nearest river wins.
  gl_Position = vec4(ndc, abs(aAcross) * 2.0 - 1.0, 1.0);
}
`
const bakeFragment = /* glsl */ `
varying float vAcross;
varying float vAngle;
varying float vId;
void main() {
  gl_FragColor = vec4(vAcross * 0.5 + 0.5, 1.0, (vId + 0.5) / ${MAX_RIVERS.toFixed(1)}, vAngle);
}
`

/**
 * A ribbon of left edge, channel and right edge per river line, carrying the signed distance
 * across the channel (in REACH units), the downstream heading and the river's index.
 */
function ribbon(line: [number, number][], id: number) {
  const pos: number[] = []
  const across: number[] = []
  const angle: number[] = []
  const ids: number[] = []
  const idx: number[] = []
  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)]
    const next = line[Math.min(line.length - 1, i + 1)]
    const dx = next[0] - prev[0]
    const dz = next[1] - prev[1]
    const len = Math.hypot(dx, dz) || 1
    const nx = -dz / len
    const nz = dx / len
    const [x, z] = line[i]
    const heading = Math.atan2(dz, dx) / (2 * Math.PI) + 0.5
    for (const side of [-1, 0, 1]) {
      pos.push(x + nx * REACH * side, 0, z + nz * REACH * side)
      across.push(side)
      angle.push(heading)
      ids.push(id)
    }
    if (i < line.length - 1) {
      const a = i * 3
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1))
  g.setAttribute('aAngle', new THREE.Float32BufferAttribute(angle, 1))
  g.setAttribute('aId', new THREE.Float32BufferAttribute(ids, 1))
  g.setIndex(idx)
  return g
}

/** River names in a stable order: index i in the field is names[i]. */
export function riverNames(rivers: RiverLine[]) {
  return [...new Set(rivers.map((r) => r.name))]
}

/**
 * Rasterise every river into a top-down texture of the Mapa, once. The signed distance across
 * is linear, so bilinear filtering resolves channels much thinner than a texel.
 */
export function bakeRiverField(gl: THREE.WebGLRenderer, rivers: RiverLine[], heightAt: (x: number, z: number) => number) {
  const names = riverNames(rivers)
  const material = new THREE.ShaderMaterial({ vertexShader: bakeVertex, fragmentShader: bakeFragment, depthFunc: THREE.LessEqualDepth })
  const scene = new THREE.Scene()
  for (const r of rivers) {
    // OSM lines are chained in no particular order; run each one downhill.
    const first = r.points[0]
    const last = r.points[r.points.length - 1]
    const line = heightAt(...first) < heightAt(...last) ? [...r.points].reverse() : r.points
    const mesh = new THREE.Mesh(ribbon(line, names.indexOf(r.name)), material)
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  const target = new THREE.WebGLRenderTarget(FIELD_W, FIELD_H, { depthBuffer: true })
  target.texture.minFilter = THREE.LinearFilter
  target.texture.magFilter = THREE.LinearFilter
  const clear = gl.getClearColor(new THREE.Color())
  const clearAlpha = gl.getClearAlpha()
  const previous = gl.getRenderTarget()
  gl.setRenderTarget(target)
  gl.setClearColor(0x000000, 0)
  gl.clear()
  gl.render(scene, new THREE.Camera())
  gl.setRenderTarget(previous)
  gl.setClearColor(clear, clearAlpha)

  for (const mesh of scene.children) (mesh as THREE.Mesh).geometry.dispose()
  material.dispose()

  const kinds = names.map((n) => rivers.find((r) => r.name === n)!.kind)
  kinds.forEach((kind, i) => {
    riverUniforms.uRiverHalf.value[i] = LECHO[kind].half
    riverUniforms.uRiverMinPx.value[i] = LECHO[kind].minPx
    riverUniforms.uRiverMain.value[i] = kind === 'main' ? 1 : 0
  })
  riverUniforms.uRiverField.value = target.texture
  return { target, names }
}

/** Caudal stage (0–1) at a month, eased between one mid-month and the next. */
export function stageAt(curve: number[], month: number) {
  const t = month - 0.5
  const i = Math.floor(t)
  const a = curve[((i % 12) + 12) % 12]
  const b = curve[(((i + 1) % 12) + 12) % 12]
  return a + (b - a) * (t - i)
}

export const RIVER_GLSL = /* glsl */ `
uniform sampler2D uRiverField;
uniform vec2 uRiverFieldSize;
uniform float uRiverStage[${MAX_RIVERS}];
uniform float uRiverHalf[${MAX_RIVERS}];
uniform float uRiverMinPx[${MAX_RIVERS}];
uniform float uRiverMain[${MAX_RIVERS}];

struct River { float lecho; float water; float stage; float main; vec2 flow; };

// Lecho and water cover (0–1) at a point, and where the water runs. fw is the pixel size in km.
River riverAt(vec2 xz, float fw) {
  River r = River(0.0, 0.0, 0.0, 0.0, vec2(0.0));
  vec2 uv = (xz - vec2(${MAP.minX.toFixed(1)}, ${MAP.minZ.toFixed(1)})) /
    vec2(${(MAP.maxX - MAP.minX).toFixed(1)}, ${(MAP.maxZ - MAP.minZ).toFixed(1)});
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return r;
  vec4 f = texture2D(uRiverField, uv);
  // Bilinear blends with the empty texels past a ribbon's edge; only trust fully covered spots.
  if (f.g < 0.99) return r;
  float d = abs(f.r * 2.0 - 1.0) * ${REACH.toFixed(2)};
  if (d > 1.0) return r;

  int id = int(texelFetch(uRiverField, ivec2(min(uv * uRiverFieldSize, uRiverFieldSize - 1.0)), 0).b * ${MAX_RIVERS.toFixed(1)});
  float s = uRiverStage[id];
  // fw is the length of the footprint's diagonal, about 1.4 pixels.
  float px = fw * 0.7;
  float bed = max(uRiverHalf[id], uRiverMinPx[id] * px * 0.5);
  float aa = px * 0.5;
  r.lecho = 1.0 - smoothstep(bed - aa, bed + aa, d);
  if (r.lecho <= 0.0) return r;

  // From bajo up the water runs unbroken and widens to fill the Lecho in crecida.
  float runs = smoothstep(0.42, 0.6, s);
  float wide = mix(0.35, 1.0, smoothstep(0.55, 1.0, s));
  // Below that it only stands in Pozas, always in the same reaches, fewer as it dries.
  float pool = tnoise(xz * 1.4 + 17.0) * 0.6 + tnoise(xz * 4.1 - 9.0) * 0.4;
  float pools = smoothstep(0.0, 0.08, pool - mix(0.9, 0.0, smoothstep(0.02, 0.35, s)));
  float waterHalf = bed * max(wide * runs, 0.6 * pools);
  r.water = (1.0 - smoothstep(waterHalf - aa, waterHalf + aa, d)) * step(0.001, waterHalf);

  float a = (f.a - 0.5) * 6.28318530718;
  r.flow = vec2(cos(a), sin(a));
  r.stage = s;
  r.main = uRiverMain[id];
  return r;
}
`
