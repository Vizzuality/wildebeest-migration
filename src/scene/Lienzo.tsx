import { useLoader } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { MAP } from '../geo'
import { DESIGN_PAPER, FIGMA_GLSL } from '../shaders/figma'

// The picture as the Figma frame shows it: a halftone raster spanning the Mapa, worked by the
// frame's image filters and its TEXTURE effect.

const vertex = /* glsl */ `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragment = /* glsl */ `
uniform sampler2D uRaster;
uniform sampler2D uFiltros;
uniform vec3 uPaper;
varying vec2 vWorld;

${FIGMA_GLSL}

vec3 at(vec2 uv, vec2 dx, vec2 dy) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return uPaper;
  // The warp tears the lookup apart from pixel to pixel, so the level is the unwarped one's.
  vec4 c = textureGrad(uRaster, uv, dx, dy);
  return mix(uPaper, filtered(c.rgb), c.a);
}

void main() {
  vec2 px = designPx(vWorld);
  vec2 dx = dFdx(px) / DESIGN_PX;
  vec2 dy = dFdy(px) / DESIGN_PX;
  // The warp barely moves within a screen pixel, so it is taken once and the four looks a quarter
  // of a pixel apart only shift from it: Figma smooths the warped edges, the canvas doesn't.
  vec2 uv = textured(px) / DESIGN_PX;
  vec3 col = at(uv + (dx + dy) * 0.25, dx, dy) + at(uv + (dx - dy) * 0.25, dx, dy)
    + at(uv - (dx - dy) * 0.25, dx, dy) + at(uv - (dx + dy) * 0.25, dx, dy);
  // Written as it is: the raster, the filters and the paper are all already in sRGB.
  gl_FragColor = vec4(col * 0.25, 1.0);
}
`

/** Paper round the Mapa, wide enough to fill any screen whatever the framing. */
const SHEET = 4 * Math.max(MAP.maxX - MAP.minX, MAP.maxZ - MAP.minZ)

/** `raster` holds sRGB values with its first row at the Mapa's north edge. */
export function Lienzo({ raster }: { raster: THREE.Texture }) {
  const filtros = useLoader(THREE.TextureLoader, '/diseno/filtros.png')
  const material = useMemo(() => {
    filtros.flipY = false
    filtros.colorSpace = THREE.NoColorSpace
    filtros.generateMipmaps = false
    filtros.minFilter = THREE.LinearFilter
    filtros.needsUpdate = true
    const paper = [1, 3, 5].map((k) => parseInt(DESIGN_PAPER.slice(k, k + 2), 16) / 255)
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uRaster: { value: raster },
        uFiltros: { value: filtros },
        uPaper: { value: new THREE.Vector3(...paper) },
      },
    })
  }, [raster, filtros])
  useEffect(() => () => material.dispose(), [material])

  return (
    <mesh material={material} position={[(MAP.minX + MAP.maxX) / 2, 0, (MAP.minZ + MAP.maxZ) / 2]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[SHEET, SHEET]} />
    </mesh>
  )
}
