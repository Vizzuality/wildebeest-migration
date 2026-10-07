import { useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { MONTHS_PER_SECOND, useStore } from '../store'
import { shared } from '../shaders/common'
import { Bruma } from './Bruma'
import { CameraRig } from './CameraRig'
import { Border, Labels } from './Overlays'
import { Rivers } from './Rivers'
import { Sky } from './Sky'
import { Terrain } from './Terrain'
import { Groves } from './Groves'

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

export function Scene() {
  return (
    <>
      <Clock />
      <hemisphereLight args={['#b9c7d8', '#6b5a3f', 1.1]} />
      <directionalLight position={[-62, 55, 56]} intensity={2.4} color="#ffdcae" />
      <Sky />
      <Terrain />
      <Rivers />
      <Groves />
      <Border />
      <Labels />
      <CameraRig />
      <EffectComposer multisampling={4}>
        <Bruma />
        <Bloom intensity={0.55} luminanceThreshold={0.82} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Noise opacity={0.035} />
        <Vignette offset={0.28} darkness={0.62} />
      </EffectComposer>
    </>
  )
}
