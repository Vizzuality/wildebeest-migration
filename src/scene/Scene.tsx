import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { MAP } from '../geo'
import { MONTHS_PER_SECOND, useStore } from '../store'
import { shared } from '../shaders/common'
import { Brochazos } from './Brochazos'
import { Diseno } from './Diseno'
import { Fauna } from './Fauna'
import { Border, Labels } from './Overlays'
import { Rivers } from './Rivers'

/** Screen kept clear on the left for the panel (px), as wide as .panel in index.css. */
const PANEL_PX = 553
/** How much taller than the screen the Mapa is drawn, so it always runs off the top and bottom. */
const OVERSCAN = 1.2
/** How far the Mapa's west edge tucks in under the panel (px). */
const TUCK_PX = 80

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
const MID_Z = (MAP.minZ + MAP.maxZ) / 2

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The Mapa straight from above with north up, tucked a little under the panel and a little taller than the
 * screen; whatever room is left on the right stays paper. The wheel zooms in about the cursor,
 * dragging pans, a double click puts it back.
 */
function Encuadre() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const gl = useThree((s) => s.gl)
  const { width, height } = useThree((s) => s.size)
  const fit = (height * OVERSCAN) / (MAP.maxZ - MAP.minZ)
  // The spot at the screen's centre, putting the Mapa's west edge a little under the panel.
  const home = useCallback(() => ({ zoom: 1, x: MAP.minX + (width / 2 - PANEL_PX + TUCK_PX) / fit, z: MID_Z }), [width, fit])
  const view = useRef(home())

  const frame = useCallback(() => {
    const v = view.current
    camera.zoom = fit * v.zoom
    // Some of the Mapa always stays on screen.
    const reachX = width / 2 / camera.zoom
    const reachZ = height / 2 / camera.zoom
    v.x = clamp(v.x, MAP.minX - reachX, MAP.maxX + reachX)
    v.z = clamp(v.z, MAP.minZ - reachZ, MAP.maxZ + reachZ)
    camera.up.set(0, 0, -1)
    camera.position.set(v.x, 100, v.z)
    camera.lookAt(v.x, 0, v.z)
    camera.updateProjectionMatrix()
  }, [camera, width, height, fit])
  useLayoutEffect(() => {
    view.current = home()
    frame()
  }, [home, frame])

  useEffect(() => {
    // The labels sit over the canvas in their own layer, so the wheel is read on the parent.
    const el = gl.domElement.parentElement ?? gl.domElement
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = view.current
      const before = v.zoom
      v.zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.0015), 1, ZOOM_MAX)
      // The spot under the cursor stays under it: the centre moves towards it by the share gained.
      const kmPerPx = 1 / (camera.zoom || 1)
      const gained = 1 - before / v.zoom
      v.x += (e.clientX - width / 2) * kmPerPx * gained
      v.z += (e.clientY - height / 2) * kmPerPx * gained
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
      view.current = home()
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
  }, [gl, camera, width, height, frame, home])
  return null
}

function Cuadro() {
  const fuente = useStore((s) => s.fuente)
  return fuente === 'diseno' ? <Diseno /> : <Brochazos />
}

export function Scene() {
  return (
    <>
      <Clock />
      <Encuadre />
      <Rivers />
      <Fauna />
      <Cuadro />
      <Border />
      <Labels />
    </>
  )
}
