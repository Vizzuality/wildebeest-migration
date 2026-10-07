import { Html, Line } from '@react-three/drei'
import { useCallback, useMemo } from 'react'
import * as THREE from 'three'
import { MAP, PLACES, borderLat, project } from '../geo'
import { snapToRiver, useHeightfield } from '../terrain'

function useLift() {
  const { heightAt } = useHeightfield()
  return useCallback((x: number, z: number, h = 0.6) => new THREE.Vector3(x, heightAt(x, z) + h, z), [heightAt])
}

export function Border() {
  const lift = useLift()
  const points = useMemo(() => {
    const out: THREE.Vector3[] = []
    for (let lon = 33.4; lon <= 35.8; lon += 0.01) {
      const [x, z] = project([lon, borderLat(lon)])
      if (x < MAP.minX || x > MAP.maxX || z < MAP.minZ || z > MAP.maxZ) continue
      out.push(lift(x, z, 0.5))
    }
    return out
  }, [lift])
  return <Line points={points} color="#ffffff" lineWidth={1} dashed dashSize={1.2} gapSize={1.2} transparent opacity={0.55} />
}

export function Labels() {
  const { rivers } = useHeightfield()
  const lift = useLift()
  return (
    <group>
      {PLACES.map((p) => {
        const [x, z] = p.river ? snapToRiver(rivers, p.river, ...project(p.at)) : project(p.at)
        return (
          <Html key={p.name} center position={lift(x, z, p.kind === 'country' ? 3 : 1.5)} className={`label ${p.kind ?? 'place'}`} zIndexRange={[5, 0]}>
            {p.kind ? null : <i />}
            {p.name}
          </Html>
        )
      })}
    </group>
  )
}
