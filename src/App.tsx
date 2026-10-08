import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { useFauna } from './fauna'
import { Scene } from './scene/Scene'
import { useStore } from './store'
import { useHeightfield } from './terrain'
import { Curtain, TerrainErrorBoundary } from './ui/Curtain'

function World() {
  useHeightfield()
  useFauna()
  return (
    <>
      <Canvas
        className="canvas"
        dpr={[1, 2]}
        camera={{ fov: 38, near: 0.5, far: 3000 }}
        gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      >
        <Scene />
      </Canvas>
      <Curtain leaving />
    </>
  )
}

export default function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
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
