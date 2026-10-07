import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MAP } from '../geo'
import { GLSL_COMMON, shared } from '../shaders/common'
import { mulberry32, useHeightfield, type Heightfield } from '../terrain'

// Bosquetes: small clumps of trees or bushes drawn with volume over the Cobertura.
// Real crowns are ~10 m, under a pixel from the usual viewing distance, so each one is
// drawn roughly six times larger and a clump stands in for the trees around it.

type Kind = 'acacia' | 'round' | 'shrub'

/** Where Bosquetes stop drawing (km from the camera); they shrink away over the last stretch. */
const FADE_START = 120
const FADE_END = 170
/** Bosquetes are bucketed into square chunks so whole chunks can be culled. */
const CHUNK = 50

/** Per-vertex `aCrown`: 1 for foliage (tinted by season), 0 for trunk. `aShade` darkens undersides. */
function part(g: THREE.BufferGeometry, crown: number, shadeBelow: number) {
  g.deleteAttribute('uv')
  const n = g.attributes.position.count
  const pos = g.attributes.position
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, pos.getY(i))
    hi = Math.max(hi, pos.getY(i))
  }
  const crownAttr = new Float32Array(n).fill(crown)
  const shade = new Float32Array(n)
  for (let i = 0; i < n; i++) shade[i] = 1 - shadeBelow * (1 - (pos.getY(i) - lo) / Math.max(hi - lo, 1e-6))
  g.setAttribute('aCrown', new THREE.BufferAttribute(crownAttr, 1))
  g.setAttribute('aShade', new THREE.BufferAttribute(shade, 1))
  return g.index ? g.toNonIndexed() : g
}

/** Low-poly ball with smooth normals, so crowns read as soft foliage rather than facets. */
function ball(radius: number) {
  const g = new THREE.IcosahedronGeometry(radius, 0)
  const pos = g.attributes.position
  const normal = g.attributes.normal
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    normal.setXYZ(i, v.x, v.y, v.z)
  }
  return g
}

/** One plant, about 1 unit across. */
function plant(kind: Kind, rnd: () => number) {
  if (kind === 'acacia') {
    // Thin trunk, flat umbrella crown.
    const h = 0.55 + rnd() * 0.25
    const trunk = new THREE.CylinderGeometry(0.03, 0.05, h, 3, 1, true)
    trunk.translate(0, h / 2, 0)
    const crown = new THREE.CylinderGeometry(0.5, 0.36, 0.16, 7)
    crown.translate(0, h + 0.05, 0)
    return [part(trunk, 0, 0), part(crown, 1, 0.45)]
  }
  if (kind === 'round') {
    // Dense rounded crown down to a short trunk, as in the galería and the highland forest.
    const h = 0.25
    const trunk = new THREE.CylinderGeometry(0.04, 0.06, h, 3, 1, true)
    trunk.translate(0, h / 2, 0)
    const crown = ball(0.42)
    crown.scale(1, 0.95 + rnd() * 0.3, 1)
    crown.translate(0, h + 0.33, 0)
    return [part(trunk, 0, 0), part(crown, 1, 0.5)]
  }
  // Low, wide bush sitting on the ground.
  const bush = ball(0.4)
  bush.scale(1, 0.55, 1)
  bush.translate(0, 0.16, 0)
  return [part(bush, 1, 0.5)]
}

/** A clump of plants scattered within ~0.15 km. */
function clump(kind: Kind) {
  const rnd = mulberry32(kind.length * 31)
  const count = kind === 'round' ? 6 : kind === 'acacia' ? 4 : 5
  const size = kind === 'shrub' ? 0.035 : 0.06
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2
    const r = (i === 0 ? 0 : 0.4 + rnd() * 0.6) * 0.13
    const s = size * (0.7 + rnd() * 0.5)
    for (const g of plant(kind, rnd)) {
      g.scale(s, s, s)
      g.rotateY(rnd() * Math.PI * 2)
      g.translate(Math.cos(a) * r, 0, Math.sin(a) * r)
      parts.push(g)
    }
  }
  return mergeGeometries(parts)!
}

const vertex = /* glsl */ `
${GLSL_COMMON}
attribute float aCrown;
attribute float aShade;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vCrown;
varying float vShade;
varying float vTone;
#include <fog_pars_vertex>
void main() {
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float fade = 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, distance(cameraPosition, origin));
  vec4 world = modelMatrix * instanceMatrix * vec4(position * fade, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vCrown = aCrown;
  vShade = aShade;
  vTone = hash12(origin.xz);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const fragment = /* glsl */ `
${GLSL_COMMON}
uniform vec3 uDry;
uniform vec3 uGreen;
uniform float uSeasonal;
uniform vec2 uMapMax;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vCrown;
varying float vShade;
varying float vTone;
#include <fog_pars_fragment>
void main() {
  float g = greenness(vWorld.z, uMonth) * uSeasonal + (1.0 - uSeasonal);
  vec3 leaf = mix(uDry, uGreen, g) * (0.85 + 0.3 * vTone);
  vec3 col = mix(srgb(vec3(0.30, 0.23, 0.16)), leaf, vCrown) * vShade;
  vec3 N = normalize(vNormal);
  // Foliage scatters light: wrap the diffuse so the shaded side is not flat black.
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.35 * vCrown));
  vec3 lit = sunlight(col, N, cloudShadow(vWorld.xz));

  vec2 edge = min(vWorld.xz - uMapMin, uMapMax - vWorld.xz);
  lit = mix(lit, fogColor, 1.0 - smoothstep(0.0, 22.0, min(edge.x, edge.y)));

  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

const srgb = (r: number, g: number, b: number) => new THREE.Vector3(r ** 2.2, g ** 2.2, b ** 2.2)

const LOOK: Record<Kind, { dry: THREE.Vector3; green: THREE.Vector3; seasonal: number }> = {
  acacia: { dry: srgb(0.47, 0.44, 0.24), green: srgb(0.29, 0.37, 0.15), seasonal: 0.6 },
  round: { dry: srgb(0.15, 0.27, 0.11), green: srgb(0.15, 0.27, 0.11), seasonal: 0 },
  shrub: { dry: srgb(0.46, 0.40, 0.31), green: srgb(0.33, 0.39, 0.19), seasonal: 0.8 },
}

/** Expected Bosquetes per cell where the Cobertura is entirely that kind. */
const PER_CELL = { tree: 0.35, shrub: 0.12 }

type Placed = Record<Kind, Map<string, THREE.Matrix4[]>>

function place(hf: Heightfield): Placed {
  const rnd = mulberry32(99)
  const out: Placed = { acacia: new Map(), round: new Map(), shrub: new Map() }
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const put = (kind: Kind, x: number, z: number) => {
    const s = 0.8 + rnd() * 0.5
    q.setFromAxisAngle(up, rnd() * Math.PI * 2)
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, hf.heightAt(x, z) - 0.004, z), q, new THREE.Vector3(s, s, s))
    const key = `${Math.floor((x - MAP.minX) / CHUNK)},${Math.floor((z - MAP.minZ) / CHUNK)}`
    const bucket = out[kind].get(key) ?? []
    bucket.push(m)
    out[kind].set(key, bucket)
  }
  for (let iz = 0; iz < hf.nz; iz++) {
    for (let ix = 0; ix < hf.nx; ix++) {
      const i = iz * hf.nx + ix
      if (hf.masks[i * 2 + 1] > 0.1 || hf.masks[i * 2] < 0.08) continue
      const tree = hf.cover[i * 4]
      const shrub = hf.cover[i * 4 + 1]
      const jitter = () => [MAP.minX + (ix + rnd() - 0.5) * hf.step, MAP.minZ + (iz + rnd() - 0.5) * hf.step] as const
      if (rnd() < tree * PER_CELL.tree) {
        const dense = THREE.MathUtils.smoothstep(tree, 0.3, 0.7)
        put(rnd() < dense ? 'round' : 'acacia', ...jitter())
      }
      if (rnd() < shrub * PER_CELL.shrub) put('shrub', ...jitter())
    }
  }
  return out
}

function Chunk({ geometry, material, matrices }: { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current!
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [matrices])
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} />
}

export function Groves() {
  const hf = useHeightfield()
  const placed = useMemo(() => place(hf), [hf])
  const group = useRef<THREE.Group>(null)
  const kinds = useMemo(
    () =>
      (Object.keys(LOOK) as Kind[]).map((kind) => ({
        kind,
        geometry: clump(kind),
        material: new THREE.ShaderMaterial({
          vertexShader: vertex,
          fragmentShader: fragment,
          uniforms: {
            ...shared,
            ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
            uDry: { value: LOOK[kind].dry },
            uGreen: { value: LOOK[kind].green },
            uSeasonal: { value: LOOK[kind].seasonal },
            uMapMax: { value: new THREE.Vector2(MAP.maxX, MAP.maxZ) },
          },
          fog: true,
        }),
      })),
    [],
  )

  // Skip whole chunks once they are past the fade.
  const centre = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    for (const child of group.current!.children) {
      const sphere = (child as THREE.InstancedMesh).boundingSphere
      if (!sphere) continue
      centre.copy(sphere.center)
      child.visible = camera.position.distanceTo(centre) - sphere.radius < FADE_END
    }
  })

  return (
    <group ref={group}>
      {kinds.flatMap(({ kind, geometry, material }) =>
        [...placed[kind]].map(([key, matrices]) => <Chunk key={`${kind}-${key}`} geometry={geometry} material={material} matrices={matrices} />),
      )}
    </group>
  )
}
