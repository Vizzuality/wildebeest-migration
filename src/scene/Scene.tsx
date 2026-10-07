import { useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { MONTHS_PER_SECOND, DENSITY, useStore } from '../store'
import { shared } from '../shaders/common'
import { CameraRig } from './CameraRig'
import { Dust } from './Dust'
import { Herd } from './Herd'
import { Border, HerdMarker, Hotspots, Labels, Route } from './Overlays'
import { Rivers } from './Rivers'
import { HORIZON, Sky } from './Sky'
import { Terrain } from './Terrain'
import { Trees } from './Trees'

function Clock() {
  useFrame((_, dt) => {
    const step = Math.min(dt, 0.1)
    const s = useStore.getState()
    shared.uClock.value += step
    // Ease the gait in and out when playback pauses.
    shared.uMoving.value += ((s.playing ? 1 : 0) - shared.uMoving.value) * Math.min(1, step * 3)
    if (s.playing) {
      const month = (s.month + step * MONTHS_PER_SECOND * s.speed) % 12
      s.set({ month })
    }
    shared.uMonth.value = useStore.getState().month
  })
  return null
}

export function Scene() {
  const density = useStore((s) => s.density)
  const { adults, calves } = DENSITY[density]
  return (
    <>
      <Clock />
      <fog attach="fog" args={[HORIZON, 260, 820]} />
      <hemisphereLight args={['#b9c7d8', '#6b5a3f', 1.1]} />
      <directionalLight position={[-62, 55, 56]} intensity={2.4} color="#ffdcae" />
      <Sky />
      <Terrain />
      <Rivers />
      <Trees />
      <Herd key={density} adults={adults} calves={calves} />
      <Dust />
      <Border />
      <Route />
      <Labels />
      <Hotspots />
      <HerdMarker />
      <CameraRig />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.55} luminanceThreshold={0.82} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Noise opacity={0.035} />
        <Vignette offset={0.28} darkness={0.62} />
      </EffectComposer>
    </>
  )
}
