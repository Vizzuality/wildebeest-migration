import { MAP } from '../geo'

// The design's map is a raster laid over the whole Mapa in a Figma frame, worked by three things
// Figma does to it: the image filters on its fill, the TEXTURE effect on its layer and nothing
// else that reaches the map (the frame's NOISE sits on a paper vignette and only shows where that
// is opaque, at the edges). Lengths here are the design's pixels, so zooming the Mapa in reads
// the same as zooming the frame in Figma.

/** The raster's size in the frame, in design pixels: it spans the Mapa exactly. */
export const DESIGN_PX = { width: 751.785, height: 834.203 }
export const KM_PER_DESIGN_PX = (MAP.maxX - MAP.minX) / DESIGN_PX.width
/** The raster's own pixels: the halftone is drawn at this size and only then scaled to the frame. */
export const DESIGN_RASTER = { width: 923, height: 1024 }

/**
 * Figma's TEXTURE effect pulls every pixel from a spot nearby given by a smooth noise; the layer
 * has radius 8.2 and noiseSize 3.3. Measured on a line grid run through the effect in Figma, that
 * is three octaves of gradient noise starting at cells of 3.6 px, shifting pixels up to 9.5 px.
 */
const WARP_PX = 9.5
const CELL_PX = 3.6

/** The paper wherever no paint lies: the page's own background, --paper in index.css. */
export const DESIGN_PAPER = '#f6f1e6'

/**
 * Needs `uFiltros`, a 289×17 atlas of the image filters (exposure 0.1, contrast 0.33, saturation
 * 0.42, highlights 0.3, shadows 0.35): x = r + 17·b, y = g, 17 levels each. Figma's own exports
 * apply those filters differently from its canvas, so the atlas holds per-channel curves matched
 * from the raster to a capture of the canvas at the same spot (design px 245, 221).
 */
export const FIGMA_GLSL = /* glsl */ `
const vec2 DESIGN_PX = vec2(${DESIGN_PX.width.toFixed(3)}, ${DESIGN_PX.height.toFixed(3)});
const vec2 MAP_MIN = vec2(${MAP.minX.toFixed(1)}, ${MAP.minZ.toFixed(1)});
const float KM_PER_DESIGN_PX = ${KM_PER_DESIGN_PX.toFixed(6)};
const float WARP_PX = ${WARP_PX.toFixed(2)};
const float CELL_PX = ${CELL_PX.toFixed(2)};

// A design pixel at xz, measured from the Mapa's north-west corner.
vec2 designPx(vec2 xz) { return (xz - MAP_MIN) / KM_PER_DESIGN_PX; }

float figmaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float gradientNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a0 = figmaHash(i) * 6.2831853;
  float a1 = figmaHash(i + vec2(1.0, 0.0)) * 6.2831853;
  float a2 = figmaHash(i + vec2(0.0, 1.0)) * 6.2831853;
  float a3 = figmaHash(i + vec2(1.0, 1.0)) * 6.2831853;
  float n0 = dot(vec2(cos(a0), sin(a0)), f);
  float n1 = dot(vec2(cos(a1), sin(a1)), f - vec2(1.0, 0.0));
  float n2 = dot(vec2(cos(a2), sin(a2)), f - vec2(0.0, 1.0));
  float n3 = dot(vec2(cos(a3), sin(a3)), f - vec2(1.0, 1.0));
  return mix(mix(n0, n1, u.x), mix(n2, n3, u.x), u.y) * 1.4;
}

float textureNoise(vec2 p) {
  float sum = 0.0;
  float weight = 1.0;
  float total = 0.0;
  for (int o = 0; o < 3; o++) {
    sum += weight * gradientNoise(p);
    total += weight;
    weight *= 0.6;
    p = p * 2.0 + vec2(17.3, 9.1);
  }
  return sum / total;
}

// Where the TEXTURE effect takes the pixel at px from.
vec2 textured(vec2 px) {
  vec2 q = px / CELL_PX;
  return px + WARP_PX * vec2(textureNoise(q), textureNoise(q + vec2(31.4, 17.9)));
}

// The image filters, a trilinear lookup in the cube Figma gave back.
vec3 filtered(vec3 c) {
  vec3 s = clamp(c, 0.0, 1.0) * 16.0;
  float b0 = min(floor(s.b), 15.0);
  vec2 rg = vec2(s.r + 0.5, s.g + 0.5);
  vec3 lo = texture2D(uFiltros, vec2((rg.x + 17.0 * b0) / 289.0, rg.y / 17.0)).rgb;
  vec3 hi = texture2D(uFiltros, vec2((rg.x + 17.0 * (b0 + 1.0)) / 289.0, rg.y / 17.0)).rgb;
  return mix(lo, hi, s.b - b0);
}
`
