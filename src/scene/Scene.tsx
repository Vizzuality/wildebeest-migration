import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
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

/** How far in from the whole-Mapa framing the wheel can zoom. */
const ZOOM_MAX = 20
const MID_X = (MAP.minX + MAP.maxX) / 2
const MID_Z = (MAP.minZ + MAP.maxZ) / 2

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The Mapa straight from above with north up, fitted whole above the timeline; the wheel zooms in
 * about the cursor, dragging pans, a double click fits it whole again.
 */
function Encuadre() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const gl = useThree((s) => s.gl)
  const { width, height } = useThree((s) => s.size)
  const view = useRef({ zoom: 1, x: MID_X, z: MID_Z })

  const frame = useCallback(() => {
    const room = Math.max(1, height - TIMELINE_PX)
    const fit = Math.min(width / (MAP.maxX - MAP.minX), room / (MAP.maxZ - MAP.minZ))
    const v = view.current
    camera.zoom = fit * v.zoom
    // The Mapa never leaves the frame: its edge may come in as far as the frame's, no further.
    const slackX = Math.max(0, (MAP.maxX - MAP.minX) / 2 - width / 2 / camera.zoom)
    const slackZ = Math.max(0, (MAP.maxZ - MAP.minZ) / 2 - room / 2 / camera.zoom)
    v.x = clamp(v.x, MID_X - slackX, MID_X + slackX)
    v.z = clamp(v.z, MID_Z - slackZ, MID_Z + slackZ)
    const z = v.z + TIMELINE_PX / 2 / camera.zoom
    camera.up.set(0, 0, -1)
    camera.position.set(v.x, 100, z)
    camera.lookAt(v.x, 0, z)
    camera.updateProjectionMatrix()
  }, [camera, width, height])
  useLayoutEffect(frame, [frame])

  useEffect(() => {
    // The labels sit over the canvas in their own layer, so the wheel is read on the parent.
    const el = gl.domElement.parentElement ?? gl.domElement
    const room = Math.max(1, height - TIMELINE_PX)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view.current
      const before = v.zoom
      v.zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.0015), 1, ZOOM_MAX)
      // The spot under the cursor stays under it: the centre moves towards it by the share gained.
      const kmPerPx = 1 / (camera.zoom || 1)
      const gained = 1 - before / v.zoom
      v.x += (e.clientX - width / 2) * kmPerPx * gained
      v.z += (e.clientY - room / 2) * kmPerPx * gained
      frame()
    }
    let drag: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      drag = { x: e.clientX, y: e.clientY }
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const v = view.current
      v.x -= (e.clientX - drag.x) / camera.zoom
      v.z -= (e.clientY - drag.y) / camera.zoom
      drag = { x: e.clientX, y: e.clientY }
      frame()
    }
    const onUp = () => {
      drag = null
    }
    const onReset = () => {
      view.current = { zoom: 1, x: MID_X, z: MID_Z }
      frame()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('dblclick', onReset)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('dblclick', onReset)
    }
  }, [gl, camera, width, height, frame])
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
