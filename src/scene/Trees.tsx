import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MAP } from '../geo'
import { HF, heightAt, mulberry32, woodland } from '../terrain'

// Flat-topped acacia: thin trunk, wide umbrella canopy.
function acacia() {
  const trunk = new THREE.CylinderGeometry(0.06, 0.1, 1.1, 5)
  trunk.translate(0, 0.55, 0)
  const canopy = new THREE.CylinderGeometry(0.9, 0.55, 0.32, 9)
  canopy.translate(0, 1.2, 0)
  const tint = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex)
    const arr = new Float32Array(g.attributes.position.count * 3)
    for (let i = 0; i < g.attributes.position.count; i++) c.toArray(arr, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    g.deleteAttribute('uv')
    return g
  }
  return mergeGeometries([tint(trunk, '#4b3a2a'), tint(canopy, '#6e7a35')])!
}

function riverDistAt(x: number, z: number) {
  const ix = Math.round((x - MAP.minX) / HF.step)
  const iz = Math.round((z - MAP.minZ) / HF.step)
  const i = iz * HF.nx + ix
  return { river: HF.masks[i * 3 + 1], lake: HF.masks[i * 3 + 2] }
}

export function Trees({ count = 14000 }: { count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => acacia(), [])

  const transforms = useMemo(() => {
    const rnd = mulberry32(99)
    const out: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    let tries = 0
    while (out.length < count && tries < count * 40) {
      tries++
      const x = MAP.minX + rnd() * (MAP.maxX - MAP.minX)
      const z = MAP.minZ + rnd() * (MAP.maxZ - MAP.minZ)
      const { river, lake } = riverDistAt(x, z)
      if (lake > 0.1 || river < 0.9) continue
      const p = Math.max(woodland(x, z) * 0.55, river < 3.2 ? 0.9 : 0)
      if (rnd() > p) continue
      const s = 0.22 + rnd() * 0.28
      e.set((rnd() - 0.5) * 0.1, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.1)
      q.setFromEuler(e)
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, heightAt(x, z) - 0.05, z),
        q,
        new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s),
      )
      out.push(m)
    }
    return out
  }, [count])

  useLayoutEffect(() => {
    const mesh = ref.current!
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [transforms])

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, transforms.length]}>
      <meshLambertMaterial vertexColors />
    </instancedMesh>
  )
}
