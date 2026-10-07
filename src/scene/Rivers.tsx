import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { CAUDAL } from '../geo'
import { shared } from '../shaders/common'
import { bakeRiverField, riverUniforms, stageAt } from '../shaders/rivers'
import { useHeightfield } from '../terrain'

/** Rivers are painted by the Terrain; this bakes their field and moves each one's Caudal. */
export function Rivers() {
  const { rivers, heightAt } = useHeightfield()
  const gl = useThree((s) => s.gl)
  const curves = useRef<number[][]>([])

  useLayoutEffect(() => {
    const { target, names } = bakeRiverField(gl, rivers, heightAt)
    curves.current = names.map((n) => {
      const curve = CAUDAL[n]
      if (!curve) throw new Error(`river ${n}: no Caudal curve in geo.ts`)
      return curve
    })
    return () => {
      riverUniforms.uRiverField.value = null
      target.dispose()
    }
  }, [gl, rivers, heightAt])

  useFrame(() => {
    curves.current.forEach((curve, i) => {
      riverUniforms.uRiverStage.value[i] = stageAt(curve, shared.uMonth.value)
    })
  })

  return null
}
