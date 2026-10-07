import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import { MAP } from '../geo'
import { useHeightfield } from '../terrain'

// Where the fly-in settles: ~110 km from the middle of the Mapa, looking north-east.
const OFFSET = new THREE.Vector3(-55, 85, 125).setLength(110)
const CENTRE_XZ = [(MAP.minX + MAP.maxX) / 2, (MAP.minZ + MAP.maxZ) / 2] as const
const INTRO_SECONDS = 5
// High above the middle of the Mapa, where the opening fly-in starts.
export const INTRO_FROM = new THREE.Vector3((MAP.minX + MAP.maxX) / 2, 440, (MAP.minZ + MAP.maxZ) / 2 + 270)

export function CameraRig() {
  const { heightAt } = useHeightfield()
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((s) => s.camera)
  const elapsed = useRef(0)

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    if (elapsed.current >= INTRO_SECONDS) return
    elapsed.current += dt

    // Opening fly-in from high above the whole ecosystem, down through the Bruma.
    const [x, z] = CENTRE_XZ
    c.target.set(x, heightAt(x, z), z)
    const t = THREE.MathUtils.smootherstep(Math.min(1, elapsed.current / INTRO_SECONDS), 0, 1)
    camera.position.lerpVectors(INTRO_FROM, c.target.clone().add(OFFSET), t)
    c.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={6}
      maxDistance={520}
      maxPolarAngle={Math.PI * 0.46}
      zoomSpeed={0.8}
    />
  )
}
