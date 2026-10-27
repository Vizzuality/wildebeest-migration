import * as THREE from 'three'
import { MAP, PLACES, project } from './geo'

// Bruma: the edge where the painting is left unfinished. Towards it the Brochazos thin out and pale
// until bare paper shows, along an oval bent sideways and bitten by tongues reaching in, pulled
// back from every named place so each one stays painted.

/** How far in from the shoreline (km) the painting thins out before it is whole. */
export const EDGE_REACH = 40
/** Superellipse exponent: 2 is a true ellipse, higher squares it off towards the Mapa's corners. */
const OVAL = 4
/** Tongues of bare paper reach this far (km) inwards; the shoreline never retreats past the edge. */
const TONGUES = 58
/** Sideways wobble (km) that bends the straight sides of the Mapa. */
const WARP = 16
/** Every named place keeps a painted clearing this wide (km), thinning out over the next stretch. */
const CLEARING = 16
const CLEARING_FADE = 18
const PLACE_XZ = PLACES.map((p) => project(p.at))

const FIELD_MARGIN = 40
const FIELD_MIN = new THREE.Vector2(MAP.minX - FIELD_MARGIN, MAP.minZ - FIELD_MARGIN)
const FIELD_SIZE = new THREE.Vector2(MAP.maxX - MAP.minX + FIELD_MARGIN * 2, MAP.maxZ - MAP.minZ + FIELD_MARGIN * 2)
/** Texels store distance + FIELD_OFFSET in km, so the shoreline spans −64…191 km at 1 km precision. */
const FIELD_OFFSET = 64

function smooth(t: number) {
  return t * t * (3 - 2 * t)
}

function smoothstep(a: number, b: number, x: number) {
  return smooth(Math.min(1, Math.max(0, (x - a) / (b - a))))
}

function valueNoise(seed: number) {
  const lattice = (ix: number, iz: number) => {
    const h = Math.sin(ix * 127.1 + iz * 311.7 + seed * 74.7) * 43758.5453
    return h - Math.floor(h)
  }
  return (x: number, z: number) => {
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const fx = smooth(x - ix)
    const fz = smooth(z - iz)
    const a = lattice(ix, iz) + (lattice(ix + 1, iz) - lattice(ix, iz)) * fx
    const b = lattice(ix, iz + 1) + (lattice(ix + 1, iz + 1) - lattice(ix, iz + 1)) * fx
    return a + (b - a) * fz
  }
}

const SHORE_NOISE = [1, 2, 3, 4, 5, 6].map(valueNoise)

/** Distance inside an oval (a superellipse filling the Mapa), in km, negative outside. */
function ovalInside(x: number, z: number) {
  const rx = (MAP.maxX - MAP.minX) / 2
  const rz = (MAP.maxZ - MAP.minZ) / 2
  const ux = Math.abs(x - (MAP.minX + MAP.maxX) / 2) / rx
  const uz = Math.abs(z - (MAP.minZ + MAP.maxZ) / 2) / rz
  return (1 - (ux ** OVAL + uz ** OVAL) ** (1 / OVAL)) * Math.min(rx, rz)
}

/** How far inside the painted part of the Mapa a point is (km), negative on bare paper. */
export function shoreline(x: number, z: number) {
  const [n1, n2, n3, n4, n5, n6] = SHORE_NOISE
  const qx = x * 0.022
  const qz = z * 0.022
  const wx = n1(qx * 0.7, qz * 0.7) - 0.5
  const wz = n2(qx * 0.7, qz * 0.7) - 0.5
  let d = ovalInside(x + wx * WARP * 2, z + wz * WARP * 2)
  const tongue = n3(qx, qz) * 0.62 + n4(qx * 2.7, qz * 2.7) * 0.26 + n5(qx * 7.3, qz * 7.3) * 0.12
  d += 8 - smoothstep(0.3, 0.75, tongue) * TONGUES
  let near = Infinity
  for (const [px, pz] of PLACE_XZ) near = Math.min(near, Math.hypot(x - px, z - pz))
  near += (n6(qx * 4.3, qz * 4.3) - 0.5) * 12
  const clearing = 1 - smoothstep(CLEARING, CLEARING + CLEARING_FADE, near)
  return Math.max(d, clearing * EDGE_REACH)
}

/** The shoreline baked once, 1 km a texel. */
export function brumaTexture() {
  const w = Math.round(FIELD_SIZE.x)
  const h = Math.round(FIELD_SIZE.y)
  const data = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const d = shoreline(FIELD_MIN.x + ((i + 0.5) / w) * FIELD_SIZE.x, FIELD_MIN.y + ((j + 0.5) / h) * FIELD_SIZE.y)
      data[j * w + i] = Math.max(0, Math.min(255, Math.round(d + FIELD_OFFSET)))
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat)
  tex.unpackAlignment = 1
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

export const BRUMA_GLSL = /* glsl */ `
uniform sampler2D uShore;

float shoreAt(vec2 xz) {
  vec2 uv = (xz - vec2(${FIELD_MIN.x.toFixed(1)}, ${FIELD_MIN.y.toFixed(1)})) / vec2(${FIELD_SIZE.x.toFixed(1)}, ${FIELD_SIZE.y.toFixed(1)});
  return texture2D(uShore, uv).r * 255.0 - ${FIELD_OFFSET.toFixed(1)};
}

// How painted a point is: 0 on bare paper past the shoreline, 1 once EDGE_REACH inside it.
float painted(vec2 xz) { return smoothstep(-6.0, ${EDGE_REACH.toFixed(1)}, shoreAt(xz)); }
`
