import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import * as THREE from 'three'
import { MAP } from '../geo'
import { MONTHS_PER_SECOND, useStore } from '../store'
import { shared } from '../shaders/common'
import { Brochazos } from './Brochazos'
import { Fauna } from './Fauna'
import { Border, Labels } from './Overlays'
import { Rivers } from './Rivers'

/** Screen kept clear at the bottom for the timeline (px). */
const TIMELINE_PX = 88

function Clock() {
  useFrame((_, dt) => {
    const step = Math.min(dt, 0.1)
    const s = useStore.getState()
    shared.uClock.value += step
    if (s.playing) {
      const month = (s.month + step * MONTHS_PER_SECOND * s.speed) % 12
      s.set({ month })
    }
    shared.uMonth.value = useStore.getState().month
  })
  return null
}

/** The whole Mapa, straight from above with north up, fitted above the timeline. */
function Encuadre() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const { width, height } = useThree((s) => s.size)
  useLayoutEffect(() => {
    const room = Math.max(1, height - TIMELINE_PX)
    camera.zoom = Math.min(width / (MAP.maxX - MAP.minX), room / (MAP.maxZ - MAP.minZ))
    const x = (MAP.minX + MAP.maxX) / 2
    const z = (MAP.minZ + MAP.maxZ) / 2 + TIMELINE_PX / 2 / camera.zoom
    camera.up.set(0, 0, -1)
    camera.position.set(x, 100, z)
    camera.lookAt(x, 0, z)
    camera.updateProjectionMatrix()
  }, [camera, width, height])
  return null
}

export function Scene() {
  return (
    <>
      <Clock />
      <Encuadre />
      <Rivers />
      <Fauna />
      <Brochazos />
      <Border />
      <Labels />
    </>
  )
}
