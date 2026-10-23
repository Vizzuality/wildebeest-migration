import * as THREE from 'three'
import { MAP } from '../geo'

/**
 * Brochazos sit one per cell of a grid BROCHAZO_KM apart, nudged off its middle by up to JITTER of
 * the spacing so the rows don't read. At the usual framing a cell is about three pixels, the size
 * of the dabs in the design.
 */
export const BROCHAZO_KM = 1.1
const JITTER = 0.4

/** The first cell of the Mapa and how many cells it spans, for anything kept per Brochazo. */
export const CELLS = {
  minX: Math.floor(MAP.minX / BROCHAZO_KM),
  minZ: Math.floor(MAP.minZ / BROCHAZO_KM),
  nx: Math.ceil(MAP.maxX / BROCHAZO_KM) - Math.floor(MAP.minX / BROCHAZO_KM) + 1,
  nz: Math.ceil(MAP.maxZ / BROCHAZO_KM) - Math.floor(MAP.minZ / BROCHAZO_KM) + 1,
}

/** Needs GLSL_COMMON's hash12 before it. */
export const BROCHAZO_GLSL = /* glsl */ `
const float BROCHAZO_KM = ${BROCHAZO_KM.toFixed(3)};
const vec2 CELLS_MIN = vec2(${CELLS.minX.toFixed(1)}, ${CELLS.minZ.toFixed(1)});
const vec2 CELLS_SIZE = vec2(${CELLS.nx.toFixed(1)}, ${CELLS.nz.toFixed(1)});

// Where a Brochazo of the ground sits.
vec2 brochazoAt(vec2 id) {
  vec2 nudge = (vec2(hash12(id), hash12(id + 71.3)) - 0.5) * ${(2 * JITTER).toFixed(2)};
  return (id + 0.5 + nudge) * BROCHAZO_KM;
}

// Where a Brochazo of the vegetation sits: a grid of its own, half a cell off the ground's.
vec2 vegetacionAt(vec2 id) {
  vec2 nudge = (vec2(hash12(id + 13.7), hash12(id + 29.9)) - 0.5) * ${(2 * JITTER).toFixed(2)};
  return (id + 1.0 + nudge) * BROCHAZO_KM;
}
`

/**
 * Texels of a cell pass leave early (an unpainted Brochazo, a spot off the Manada), so their
 * neighbours' screen-space derivatives are undefined and a mipmapped lookup lands on a different
 * level from frame to frame: Brochazos at the Bruma and the lakeshore flickered between colours.
 * One texel is one point, so every lookup is taken at the top level instead.
 */
const NO_DERIVATIVES = /* glsl */ `
#undef texture2D
#define texture2D(t, uv) textureLod(t, uv, 0.0)
`

const cellVertex = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * One texel per Brochazo of the Mapa, worked out afresh every frame from the moment of the year
 * alone. The fragment shader finds its Brochazo as `CELLS_MIN + floor(gl_FragCoord.xy)`.
 */
export class CellPass {
  private readonly target = new THREE.WebGLRenderTarget(CELLS.nx, CELLS.nz, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  })
  private readonly material: THREE.ShaderMaterial
  private readonly quad: THREE.Mesh
  private readonly camera = new THREE.OrthographicCamera()

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({ vertexShader: cellVertex, fragmentShader: NO_DERIVATIVES + fragmentShader, uniforms })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
  }

  get texture() {
    return this.target.texture
  }

  draw(gl: THREE.WebGLRenderer) {
    const previous = gl.getRenderTarget()
    gl.setRenderTarget(this.target)
    gl.render(this.quad, this.camera)
    gl.setRenderTarget(previous)
  }

  dispose() {
    this.target.dispose()
    this.material.dispose()
    this.quad.geometry.dispose()
  }
}
