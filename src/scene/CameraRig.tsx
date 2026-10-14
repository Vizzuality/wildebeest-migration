import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { type ComponentRef, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { type FaunaBake, useFauna } from '../fauna'
import { MAP, RAIN_SOUTH } from '../geo'
import { useStore } from '../store'
import { type Heightfield, useHeightfield } from '../terrain'

/** How steeply the camera looks down. */
const PITCH = THREE.MathUtils.degToRad(40)
/** Room round the Recorrido for the Mancha's spread (km). */
const PAD_KM = 25
/** The part of the screen (NDC) the Recorrido must fit in; the bottom is kept clear for the timeline. */
const FRAME = { left: -0.92, right: 0.92, top: 0.9, bottom: -0.72 }

const params = new URLSearchParams(window.location.search)
/** ?mapa keeps the camera still on the whole Recorrido. */
const OVERVIEW = params.has('mapa')
/** ?cine brings back the camera that follows the Manada on its own. */
const CINE = params.has('cine')

/** Free camera: how close and how far it may get to what it looks at (km), how far past the
 * Mapa's edge that may be, and how low it may look (radians from straight down), so the Mapa
 * never turns edge-on, falls out of frame or gets flown through. */
const FREE_NEAR = 6
const FREE_FAR = 520
const FREE_EDGE_KM = -20
const FREE_TILT = THREE.MathUtils.degToRad(78)
/** Clearance kept between the camera and the ground below it (km). */
const FREE_CLEARANCE = 1.5
/** WASD speed, as a share of the distance to what the camera looks at, per second; Shift speeds it up. */
const FREE_SPEED = 0.3
const FREE_BOOST = 3

/** How long the camera takes to catch up with the Manada (months, as a blur over the year). */
const LAG_MONTHS = 0.7
/** How long a change of framing takes (months): the camera pulls out and pushes in slowly. */
const BREATHE_MONTHS = 1.4
/** Ground kept in frame round the Manada: its spread (in σ) plus a margin of land (km). */
const SPREAD_SIGMAS = 0.9
const MARGIN_KM = 40
/** How far the camera swings off due south (radians), and how often (cycles a year). */
const SWAY = THREE.MathUtils.degToRad(22)
const SWAYS_PER_YEAR = 2
/** In the dry season the camera also keeps where the Manada was this long ago in frame, so the
 * plains it left show how dry they've gone. */
const TRAIL_MONTHS = 2
/** Rain on the southern plains (mm a month) above which they count as green. */
const WET_RAIN_MM = 50

export function CameraRig() {
  return OVERVIEW ? <Overview /> : CINE ? <Follow /> : <Free />
}

/** A year's worth of samples blurred round the year, so the start and end meet. */
function blurAround<T extends number[]>(samples: T[], sigma: number): T[] {
  const n = samples.length
  const reach = Math.ceil(sigma * 3)
  const weights = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-0.5 * ((k - reach) / sigma) ** 2))
  const total = weights.reduce((a, b) => a + b, 0)
  return samples.map((_, i) => {
    const out = samples[i].map(() => 0) as T
    weights.forEach((w, k) => samples[(((i + k - reach) % n) + n) % n].forEach((v, j) => (out[j] += (v * w) / total)))
    return out
  })
}

/** Where the camera looks and how far back it stands through the year: the Manada's way and
 * spread, both blurred so the camera trails it loosely instead of tracking every turn. */
function shots(bake: FaunaBake, hf: Heightfield, halfFov: number) {
  const spm = bake.samplesPerMonth
  const n = bake.recorrido.length
  const raw = bake.recorrido.map(([x, z], i) => {
    const t = i / spm - 0.5
    const a = ((Math.floor(t) % 12) + 12) % 12
    const w = t - Math.floor(t)
    const [xx, xz, zz] = bake.forma[a].map((v, k) => v * (1 - w) + bake.forma[(a + 1) % 12][k] * w)
    // The long axis of the Presencia, whichever way it points.
    const sigma = Math.sqrt((xx + zz) / 2 + Math.sqrt(((xx - zz) / 2) ** 2 + xz ** 2))
    const herd = (SPREAD_SIGMAS * sigma + MARGIN_KM) / Math.tan(halfFov)
    const rain = RAIN_SOUTH[a] * (1 - w) + RAIN_SOUTH[(a + 1) % 12] * w
    const dry = THREE.MathUtils.clamp(1 - rain / WET_RAIN_MM, 0, 1)
    const [tx, tz] = bake.recorrido[(((i - Math.round(TRAIL_MONTHS * spm)) % n) + n) % n]
    const ax = x + (tx - x) * 0.5 * dry
    const az = z + (tz - z) * 0.5 * dry
    const trail = (Math.hypot(tx - x, tz - z) / 2 + MARGIN_KM) / Math.tan(halfFov)
    return [ax, hf.heightAt(ax, az), az, Math.max(herd, dry * trail)]
  })
  const aim = blurAround(raw, LAG_MONTHS * spm)
  const distance = blurAround(
    raw.map((r) => [r[3]]),
    BREATHE_MONTHS * spm,
  )
  return aim.map(([x, y, z], i) => ({ x, y, z, distance: distance[i][0] }))
}

/** Hangs back from the Manada, from the south and far off, drifting after it. */
function Follow() {
  const bake = useFauna()
  const hf = useHeightfield()
  const fov = useThree((s) => (s.camera as THREE.PerspectiveCamera).fov)
  const way = useMemo(() => shots(bake, hf, THREE.MathUtils.degToRad(fov / 2)), [bake, hf, fov])
  const target = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera }) => {
    const month = useStore.getState().month
    const n = way.length
    const f = (((month * bake.samplesPerMonth) % n) + n) % n
    const i = Math.floor(f)
    const w = f - i
    const a = way[i]
    const b = way[(i + 1) % n]
    target.set(a.x + (b.x - a.x) * w, a.y + (b.y - a.y) * w, a.z + (b.z - a.z) * w)
    const distance = a.distance + (b.distance - a.distance) * w
    const yaw = SWAY * Math.sin((month / 12) * SWAYS_PER_YEAR * Math.PI * 2)
    const ground = distance * Math.cos(PITCH)
    camera.position.set(target.x + ground * Math.sin(yaw), target.y + distance * Math.sin(PITCH), target.z + ground * Math.cos(yaw))
    camera.lookAt(target)
  })

  return null
}

/**
 * Places the camera straight from the south, as close as it can be with the whole Recorrido in
 * frame, and returns the point it looks at.
 */
function frameRecorrido(camera: THREE.PerspectiveCamera, recorrido: [number, number][], heightAt: Heightfield['heightAt']) {
  const xs = recorrido.map(([x]) => x)
  const zs = recorrido.map(([, z]) => z)
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs) - PAD_KM, Math.max(...xs) + PAD_KM, Math.min(...zs) - PAD_KM, Math.max(...zs) + PAD_KM]
  const target = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  target.y = heightAt(target.x, target.z)
  const corners = [
    [minX, minZ],
    [maxX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
  ].map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z))

  const place = (distance: number) => {
    camera.position.set(target.x, target.y + distance * Math.sin(PITCH), target.z + distance * Math.cos(PITCH))
    camera.lookAt(target)
    camera.updateMatrixWorld()
    camera.updateProjectionMatrix()
  }
  // Both edges move as the camera backs off, so search for the distance that just fits the
  // span, then slide the target so the span sits in the frame.
  const fits = (distance: number) => {
    place(distance)
    const ndc = corners.map((c) => c.clone().project(camera))
    const spanX = Math.max(...ndc.map((p) => p.x)) - Math.min(...ndc.map((p) => p.x))
    const spanY = Math.max(...ndc.map((p) => p.y)) - Math.min(...ndc.map((p) => p.y))
    return spanX <= FRAME.right - FRAME.left && spanY <= FRAME.top - FRAME.bottom
  }
  let near = 10
  let far = 2000
  for (let i = 0; i < 40; i++) {
    const mid = (near + far) / 2
    if (fits(mid)) far = mid
    else near = mid
  }
  place(far)
  const ndc = corners.map((c) => c.clone().project(camera))
  const shiftY = (FRAME.top + FRAME.bottom) / 2 - (Math.max(...ndc.map((p) => p.y)) + Math.min(...ndc.map((p) => p.y))) / 2
  // Screen height at the target, so the NDC shift becomes a slide of the camera along its up axis.
  const height = 2 * far * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  const slide = up.multiplyScalar((-shiftY * height) / 2)
  camera.position.add(slide)
  target.add(slide)
  camera.lookAt(target)
  return target
}

/** Fixed on the whole Recorrido. */
function Overview() {
  const { recorrido } = useFauna()
  const { heightAt } = useHeightfield()
  const camera = useThree((s) => s.camera as THREE.PerspectiveCamera)
  const aspect = useThree((s) => s.size.width / s.size.height)

  useLayoutEffect(() => {
    frameRecorrido(camera, recorrido, heightAt)
  }, [recorrido, heightAt, camera, aspect])

  return null
}

/** Keys held down, by KeyboardEvent.code. */
function useHeldKeys() {
  const held = useRef(new Set<string>())
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      held.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => held.current.delete(e.code)
    const clear = () => held.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])
  return held
}

/**
 * Starts on the whole Recorrido and is the viewer's from there: drag to orbit, right-drag to pan,
 * wheel to zoom, WASD to fly over the ground. Kept over the Mapa and above the Relieve.
 */
function Free() {
  const { recorrido } = useFauna()
  const { heightAt } = useHeightfield()
  const get = useThree((s) => s.get)
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const started = useRef(false)
  const held = useHeldKeys()
  const move = useMemo(() => new THREE.Vector3(), [])
  const forward = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])

  // Only where it starts: after that the camera is the viewer's.
  useLayoutEffect(() => {
    if (started.current || !controls.current) return
    started.current = true
    const target = frameRecorrido(get().camera as THREE.PerspectiveCamera, recorrido, heightAt)
    controls.current.target.copy(target)
    controls.current.update()
  }, [get, recorrido, heightAt])

  useFrame(({ camera }, dt) => {
    const c = controls.current
    if (!c) return
    const keys = held.current
    camera.getWorldDirection(forward)
    forward.setY(0)
    forward.normalize()
    right.crossVectors(forward, camera.up).normalize()
    move.set(0, 0, 0)
    if (keys.has('KeyW')) move.add(forward)
    if (keys.has('KeyS')) move.sub(forward)
    if (keys.has('KeyD')) move.add(right)
    if (keys.has('KeyA')) move.sub(right)
    if (move.lengthSq() > 0) {
      const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? FREE_BOOST : 1
      move.normalize().multiplyScalar(camera.position.distanceTo(c.target) * FREE_SPEED * boost * Math.min(dt, 0.1))
      camera.position.add(move)
      c.target.add(move)
    }
    // Keep what it looks at over the Mapa and on the ground, carrying the camera with it.
    const x = THREE.MathUtils.clamp(c.target.x, MAP.minX - FREE_EDGE_KM, MAP.maxX + FREE_EDGE_KM)
    const z = THREE.MathUtils.clamp(c.target.z, MAP.minZ - FREE_EDGE_KM, MAP.maxZ + FREE_EDGE_KM)
    move.set(x - c.target.x, heightAt(x, z) - c.target.y, z - c.target.z)
    camera.position.add(move)
    c.target.add(move)
    const floor = heightAt(camera.position.x, camera.position.z) + FREE_CLEARANCE
    if (camera.position.y < floor) camera.position.y = floor
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={FREE_NEAR}
      maxDistance={FREE_FAR}
      maxPolarAngle={FREE_TILT}
      zoomSpeed={0.8}
      screenSpacePanning={false}
    />
  )
}
