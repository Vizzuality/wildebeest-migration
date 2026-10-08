import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import * as THREE from 'three'
import { useFauna } from '../fauna'
import { useHeightfield } from '../terrain'

/** How steeply the camera looks down. */
const PITCH = THREE.MathUtils.degToRad(40)
/** Room round the Recorrido for the Mancha's spread (km). */
const PAD_KM = 25
/** The part of the screen (NDC) the Recorrido must fit in; the bottom is kept clear for the timeline. */
const FRAME = { left: -0.92, right: 0.92, top: 0.9, bottom: -0.72 }

/** Fixed, straight from the south, as close as it can be with the whole Recorrido in frame. */
export function CameraRig() {
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
