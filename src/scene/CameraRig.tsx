import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { type FaunaBake, useFauna } from '../fauna'
import { RAIN_SOUTH } from '../geo'
import { useStore } from '../store'
import { type Heightfield, useHeightfield } from '../terrain'

/** How steeply the camera looks down. */
const PITCH = THREE.MathUtils.degToRad(40)
/** Room round the Recorrido for the Mancha's spread (km). */
const PAD_KM = 25
/** The part of the screen (NDC) the Recorrido must fit in; the bottom is kept clear for the timeline. */
const FRAME = { left: -0.92, right: 0.92, top: 0.9, bottom: -0.72 }

/** ?mapa keeps the camera still on the whole Recorrido instead of following the Manada. */
const OVERVIEW = new URLSearchParams(window.location.search).has('mapa')

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
  return OVERVIEW ? <Overview /> : <Follow />
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

/** Fixed, straight from the south, as close as it can be with the whole Recorrido in frame. */
function Overview() {
  const { recorrido } = useFauna()
  const { heightAt } = useHeightfield()
  const camera = useThree((s) => s.camera as THREE.PerspectiveCamera)
  const aspect = useThree((s) => s.size.width / s.size.height)

  useLayoutEffect(() => {
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
    camera.lookAt(target.add(slide))
  }, [recorrido, heightAt, camera, aspect])

  return null
}
