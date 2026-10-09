import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { MONTHS_PER_SECOND, useStore } from '../store'
import { shared } from '../shaders/common'
import { Bruma } from './Bruma'
import { CameraRig } from './CameraRig'
import { Border, Labels } from './Overlays'
import { Rivers } from './Rivers'
import { Sharpen } from './Sharpen'
import { Sky } from './Sky'
import { Terrain } from './Terrain'
import { Groves } from './Groves'
import { Fauna } from './Fauna'

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
  // On high-density screens the extra pixels already smooth edges; MSAA there cost ~11 ms a frame.
  const dpr = useThree((s) => s.viewport.dpr)
  return (
    <>
      <Clock />
      <hemisphereLight args={['#b9c7d8', '#6b5a3f', 1.1]} />
      <directionalLight position={[-62, 55, 56]} intensity={2.4} color="#ffdcae" />
      <Sky />
      <Terrain />
      <Rivers />
      <Groves />
      <Fauna />
      <Border />
      <Labels />
      <CameraRig />
      <EffectComposer multisampling={dpr >= 1.5 ? 0 : 4}>
        <Sharpen />
        <Bruma />
        <Bloom intensity={0.55} luminanceThreshold={0.82} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Noise opacity={0.035} />
        <Vignette offset={0.28} darkness={0.62} />
      </EffectComposer>
    </>
  )
}
