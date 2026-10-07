import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { INTRO_FROM } from './scene/CameraRig'
import { Scene } from './scene/Scene'
import { useStore } from './store'
import { useHeightfield } from './terrain'
import { Curtain, TerrainErrorBoundary } from './ui/Curtain'
import { Overlay } from './ui/Overlay'

function World() {
  useHeightfield()
  return (
    <>
      <Canvas
        className="canvas"
        dpr={[1, 2]}
        camera={{ position: INTRO_FROM.toArray(), fov: 38, near: 0.5, far: 3000 }}
        gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      >
        <Scene />
      </Canvas>
      <Overlay />
      <Curtain leaving />
    </>
  )
}

export default function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('button, select')) return
      e.preventDefault()
      const { playing, set } = useStore.getState()
      set({ playing: !playing })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <TerrainErrorBoundary>
      <Suspense fallback={<Curtain />}>
        <World />
      </Suspense>
    </TerrainErrorBoundary>
  )
}
