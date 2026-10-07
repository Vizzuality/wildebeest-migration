import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useCallback, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { HOTSPOTS, LOOP_SAMPLES, MAP, MONTHS_SHORT, PLACES, borderLat, herdPos, project } from '../geo'
import { useStore } from '../store'
import { snapToRiver, useHeightfield } from '../terrain'

function useLift() {
  const { heightAt } = useHeightfield()
  return useCallback((x: number, z: number, h = 0.6) => new THREE.Vector3(x, heightAt(x, z) + h, z), [heightAt])
}

export function Route() {
  const show = useStore((s) => s.showRoute)
  const lift = useLift()
  const points = useMemo(() => LOOP_SAMPLES.filter((_, i) => i % 4 === 0).map(([x, z]) => lift(x, z, 1.2)), [lift])
  const ticks = useMemo(
    () =>
      MONTHS_SHORT.map((label, i) => {
        const [x, z] = herdPos(i + 0.5)
        return { label, pos: lift(x, z, 1.2) }
      }),
    [lift],
  )
  if (!show) return null
  return (
    <group>
      <Line points={points} color="#ffe6b8" lineWidth={1.6} dashed dashSize={2.2} gapSize={1.6} transparent opacity={0.75} />
      {ticks.map((t) => (
        <group key={t.label} position={t.pos}>
          <mesh>
            <sphereGeometry args={[0.7, 12, 12]} />
            <meshBasicMaterial color="#fff1d6" toneMapped={false} />
          </mesh>
          <Html center position={[0, 2.4, 0]} className="tick" zIndexRange={[10, 0]}>
            {t.label}
          </Html>
        </group>
      ))}
    </group>
  )
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

function Hotspot({ name, at, river, months }: (typeof HOTSPOTS)[number]) {
  const { rivers } = useHeightfield()
  const lift = useLift()
  const [x, z] = useMemo(() => snapToRiver(rivers, river, ...project(at)), [rivers, river, at])
  const pos = useMemo(() => lift(x, z, 1.5), [lift, x, z])
  const rings = useRef<THREE.Group>(null)
  const label = useRef<HTMLDivElement>(null)

  useFrame(({ clock }) => {
    const m = useStore.getState().month
    const [hx, hz] = herdPos(m)
    const near = THREE.MathUtils.smoothstep(40, 12, Math.hypot(hx - x, hz - z))
    const inSeason = m > months[0] && m < months[1] ? 1 : 0
    const k = near * inSeason
    rings.current!.children.forEach((child, i) => {
      const t = (clock.elapsedTime * 0.5 + i / 3) % 1
      child.scale.setScalar(1 + t * 9)
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      mat.opacity = (1 - t) * 0.9 * k
    })
    if (label.current) label.current.style.opacity = String(k)
  })

  return (
    <group position={pos}>
      <group ref={rings} rotation-x={-Math.PI / 2} renderOrder={3}>
        {[0, 1, 2].map((i) => (
          <mesh key={i}>
            <ringGeometry args={[0.8, 1, 48]} />
            <meshBasicMaterial color="#ff7a45" transparent depthWrite={false} depthTest={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <Html center position={[0, 1, 0]} zIndexRange={[20, 0]}>
        <div ref={label} className="hotspot" style={{ opacity: 0 }}>
          {name}
        </div>
      </Html>
    </group>
  )
}

export function Hotspots() {
  return (
    <>
      {HOTSPOTS.map((h) => (
        <Hotspot key={h.name} {...h} />
      ))}
    </>
  )
}

/** A soft beacon floating over the herd's centre of mass. */
export function HerdMarker() {
  const { heightAt } = useHeightfield()
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    const [x, z] = herdPos(useStore.getState().month)
    ref.current!.position.set(x, heightAt(x, z) + 9, z)
  })
  return (
    <group ref={ref}>
      <Html center zIndexRange={[30, 0]}>
        <div className="herd-tag">
          <span />
          Manada
        </div>
      </Html>
    </group>
  )
}
