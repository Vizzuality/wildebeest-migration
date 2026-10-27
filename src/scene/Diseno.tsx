import { useLoader } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { Lienzo } from './Lienzo'

/** The design's own map raster, to hold the Brochazos up against. */
export function Diseno() {
  const loaded = useLoader(THREE.TextureLoader, '/diseno/mapa.png')
  const raster = useMemo(() => {
    loaded.flipY = false
    loaded.colorSpace = THREE.NoColorSpace
    // Figma shows a zoomed-in image pixel by pixel; the warp then bends those pixels into the blobs.
    loaded.magFilter = THREE.NearestFilter
    loaded.needsUpdate = true
    return loaded
  }, [loaded])
  return <Lienzo raster={raster} />
}
