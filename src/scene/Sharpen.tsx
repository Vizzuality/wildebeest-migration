import { Effect, EffectAttribute } from 'postprocessing'
import { useMemo } from 'react'
import * as THREE from 'three'

// AMD's Contrast Adaptive Sharpening, cross-shaped: it pushes flat detail hardest and holds back
// on edges that already have contrast, so it sharpens without ringing. It reads its neighbours
// straight from the scene, so it has to run first: whatever comes after (Bruma, grain) stays soft.
const fragment = /* glsl */ `
uniform float uSharpness;

// Weighs in rough gamma space: in linear light it would bite far harder in the shadows.
vec3 tap(vec2 uv) { return sqrt(max(texture2D(inputBuffer, uv).rgb, 0.0)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = sqrt(max(inputColor.rgb, 0.0));
  vec3 n = tap(uv + vec2(0.0, texelSize.y));
  vec3 s = tap(uv - vec2(0.0, texelSize.y));
  vec3 e = tap(uv + vec2(texelSize.x, 0.0));
  vec3 w = tap(uv - vec2(texelSize.x, 0.0));
  vec3 lo = min(c, min(min(n, s), min(e, w)));
  vec3 hi = max(c, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, 1e-4), 0.0, 1.0));
  vec3 k = -amp / mix(8.0, 5.0, uSharpness);
  vec3 sharp = (c + (n + s + e + w) * k) / (1.0 + 4.0 * k);
  outputColor = vec4(sharp * sharp, inputColor.a);
}
`

class SharpenEffect extends Effect {
  constructor(sharpness: number) {
    super('Sharpen', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['uSharpness', new THREE.Uniform(sharpness)]]),
    })
  }
}

export function Sharpen({ sharpness = 0.5 }: { sharpness?: number }) {
  const effect = useMemo(() => new SharpenEffect(sharpness), [sharpness])
  return <primitive object={effect} dispose={null} />
}
