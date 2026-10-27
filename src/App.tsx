import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import { useFauna } from './fauna'
import { useLluvia } from './lluvia'
import { Scene } from './scene/Scene'
import { useStore } from './store'
import { useHeightfield } from './terrain'
import { Curtain, TerrainErrorBoundary } from './ui/Curtain'
import { Compass, Logo } from './ui/Chrome'
import { Panel } from './ui/Panel'
import { Tweaks } from './ui/Tweaks'

function World() {
  useHeightfield()
  useFauna()
  useLluvia()
  return (
    <>
      <Canvas className="canvas" dpr={[1, 2]} orthographic flat camera={{ near: 1, far: 200 }} gl={{ antialias: false }}>
        <Scene />
      </Canvas>
      <Panel />
      <Logo />
      <Compass />
      <Tweaks />
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
