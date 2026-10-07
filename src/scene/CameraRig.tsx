import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import { herdPos } from '../geo'
import { useStore } from '../store'
import { heightAt } from '../terrain'

const OFFSET = new THREE.Vector3(-55, 85, 125)
const INTRO_SECONDS = 5

export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const camera = useThree((s) => s.camera)
  const target = useRef(new THREE.Vector3())
  const delta = useRef(new THREE.Vector3())
  const elapsed = useRef(0)

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    elapsed.current += dt
    const { month, follow } = useStore.getState()
    const [x, z] = herdPos(month)
    target.current.set(x, heightAt(x, z), z)

    if (follow) {
      const k = 1 - Math.exp(-dt * 1.8)
      delta.current.subVectors(target.current, c.target).multiplyScalar(k)
      c.target.add(delta.current)
      camera.position.add(delta.current)
    }

    // Opening fly-in from high above the whole ecosystem.
    if (elapsed.current < INTRO_SECONDS) {
      const t = THREE.MathUtils.smootherstep(elapsed.current / INTRO_SECONDS, 0, 1)
      const from = new THREE.Vector3(0, 420, 260)
      const to = c.target.clone().add(OFFSET)
      camera.position.lerpVectors(from, to, t)
    }
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
