import { Color, MeshPhysicalMaterial, Vector2, type Texture } from 'three';
import { MAX_RENDER_HEIGHT_MM } from '../../sim';
import { DISH, MENISCUS_MM } from './dimensions';

export interface AgarMaterialOptions {
  /** Simulation textures (see RenderBuffers in src/sim/render/compose.ts). */
  field: Texture;
  colony: Texture;
  agar: Texture;
  overlay: Texture;
  /** Greyscale mask of where the loop has touched the agar. */
  trace: Texture;
  gridSize: number;
}

export interface AgarMaterial extends MeshPhysicalMaterial {
  userData: { uniforms: AgarUniforms };
}

interface AgarUniforms {
  uField: { value: Texture };
  uTrace: { value: Texture };
  uFieldSize: { value: Vector2 };
  uTexelMm: { value: number };
  uRadius: { value: number };
  uMeniscus: { value: number };
  uColony: { value: Texture };
  uAgar: { value: Texture };
  uOverlay: { value: Texture };
  /** 0 photoreal, 1 stylized, 2 bioluminescent. */
  uStyle: { value: number };
  /** 0 none, 1 nutrient, 2 antibiotic, 3 species map. */
  uOverlayMode: { value: number };
  uColonyHeight: { value: number };
}

const VERTEX_PARS = /* glsl */ `
uniform sampler2D uField;
uniform float uColonyHeight;
uniform float uMeniscus;
uniform float uRadius;
varying vec2 vFieldUv;
varying float vRadial;
`;

const VERTEX_BEGIN = /* glsl */ `
vec3 transformed = vec3(position);
vFieldUv = uv;
vRadial = length(position.xz) / uRadius;
{
  vec4 field = texture2D(uField, uv);
  float rim = smoothstep(0.93, 1.0, vRadial);
  transformed.y += field.r * smoothstep(0.3, 0.7, field.b) * uColonyHeight + uMeniscus * rim * rim;
}
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uField;
uniform sampler2D uTrace;
uniform vec2 uFieldSize;
uniform float uTexelMm;
uniform float uMeniscus;
uniform sampler2D uColony;
uniform sampler2D uAgar;
uniform sampler2D uOverlay;
uniform float uStyle;
uniform float uOverlayMode;
uniform float uColonyHeight;
uniform mat3 normalMatrix;
varying vec2 vFieldUv;
varying float vRadial;

// Bicubic (B-spline) filtering with 4 bilinear taps: turns the blocky sim grid
// into smooth colony outlines.
vec4 agarCubic(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}

// Dark blue → teal → yellow, for the data overlays.
vec3 agarHeat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 low = vec3(0.07, 0.03, 0.25);
  vec3 mid = vec3(0.13, 0.57, 0.55);
  vec3 high = vec3(0.99, 0.91, 0.14);
  return t < 0.5 ? mix(low, mid, t * 2.0) : mix(mid, high, (t - 0.5) * 2.0);
}

// Cheap value noise for surface relief (wrinkles, fuzz).
float agarHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float agarNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(agarHash(i), agarHash(i + vec2(1.0, 0.0)), u.x),
    mix(agarHash(i + vec2(0.0, 1.0)), agarHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

vec4 agarField(vec2 uv) {
  vec2 inv = 1.0 / uFieldSize;
  vec2 tc = uv * uFieldSize - 0.5;
  vec2 f = fract(tc);
  tc -= f;
  vec4 xc = agarCubic(f.x);
  vec4 yc = agarCubic(f.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 offset = (c + vec4(xc.yw, yc.yw) / s) * inv.xxyy;
  vec4 s0 = texture2D(uField, offset.xz);
  vec4 s1 = texture2D(uField, offset.yz);
  vec4 s2 = texture2D(uField, offset.xw);
  vec4 s3 = texture2D(uField, offset.yw);
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
`;

// Colony colour over agar. agarCover: 0 on bare agar, 1 on established growth.
const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
vec4 agarFieldHere = agarField(vFieldUv);
// Coverage channel is ~binary with fractional edge cells; thresholding the
// filtered value gives smooth, anti-aliased colony outlines.
float agarCover = smoothstep(0.3, 0.7, agarFieldHere.b);
vec4 agarColonyTex = texture2D(uColony, vFieldUv);
vec4 agarAgarTex = texture2D(uAgar, vFieldUv);
// Surface relief of the colony (wrinkled, velvety, cottony), two octaves.
float agarRelief = agarAgarTex.a * agarCover;
vec2 agarNoiseUv = vFieldUv * uFieldSize;
float agarBumps = agarNoise(agarNoiseUv * 2.3) * 0.65 + agarNoise(agarNoiseUv * 6.1) * 0.35;
// Height (fraction of the maximum encodable height) falls to zero at the colony edge.
float agarFillHere = agarFieldHere.r * agarCover * (1.0 + agarRelief * (agarBumps - 0.5) * 0.9);
float agarTrace = texture2D(uTrace, vFieldUv).r * (1.0 - agarCover);
{
  vec3 agar = agarAgarTex.rgb * (1.0 - 0.05 * agarTrace);
  vec3 colony = agarColonyTex.rgb * (1.0 - 0.22 * agarRelief * (1.0 - agarBumps));
  diffuseColor.rgb = mix(agar, colony, agarCover * agarFieldHere.a);
}
vec4 agarOverlayTex = texture2D(uOverlay, vFieldUv);
vec3 agarGlow = vec3(0.0);
if (uStyle > 0.5 && uStyle < 1.5) {
  // Stylized: a few flat tones and a dark outline round every colony.
  diffuseColor.rgb = floor(diffuseColor.rgb * 6.0 + 0.5) / 6.0;
  float edge = smoothstep(0.3, 0.5, agarFieldHere.b) * (1.0 - smoothstep(0.5, 0.78, agarFieldHere.b));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.09, 0.14), edge * 0.85);
} else if (uStyle > 1.5) {
  // Bioluminescent: dark agar, colonies glowing in their species colour.
  diffuseColor.rgb *= 0.12;
  agarGlow = agarOverlayTex.rgb * agarCover * (0.55 + 4.0 * agarFieldHere.r);
}
if (uOverlayMode > 0.5) {
  vec3 data = uOverlayMode < 1.5
    ? agarHeat(agarFieldHere.g)
    : uOverlayMode < 2.5
      ? agarHeat(agarOverlayTex.a)
      : mix(vec3(0.04, 0.05, 0.07), agarOverlayTex.rgb, agarCover);
  diffuseColor.rgb = mix(diffuseColor.rgb, data, 0.9);
  // Partly self-lit so the data reads the same under any lighting.
  agarGlow = data * (uStyle > 1.5 ? 0.9 : 0.35);
}
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor + 0.12 * agarTrace, max(agarColonyTex.a, 0.28), agarCover);
if (uStyle > 0.5 && uStyle < 1.5) roughnessFactor = max(roughnessFactor, 0.9);
`;

// Matt colonies lose the wet clearcoat of the agar.
const FRAGMENT_LIGHTS = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= 1.0 - agarCover * smoothstep(0.35, 0.8, agarColonyTex.a);
  if (uStyle > 0.5 && uStyle < 1.5) material.clearcoat = 0.0;
#endif
`;

// Shade colonies from the slope of the height field rather than mesh normals,
// so detail is per-pixel regardless of tessellation. The slope comes from
// screen-space derivatives of the already-filtered fill value (no extra taps).
const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  // Solve for d(fill)/d(uv) from the screen-space derivatives of fill and uv.
  vec2 uvDx = dFdx(vFieldUv);
  vec2 uvDy = dFdy(vFieldUv);
  float fDx = dFdx(agarFillHere);
  float fDy = dFdy(agarFillHere);
  float det = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
  vec2 gradUv = abs(det) > 1e-12
    ? vec2(fDx * uvDy.y - fDy * uvDx.y, fDy * uvDx.x - fDx * uvDy.x) / det
    : vec2(0.0);
  // uv spans the agar diameter, so d/dmm = d/duv / diameter.
  vec2 slope = gradUv * uColonyHeight / (uFieldSize.x * uTexelMm);
  // Limit the slope: steep single-pixel gradients would otherwise sparkle.
  slope = clamp(slope, vec2(-0.6), vec2(0.6));
  // Meniscus: height = m * rim², rim = smoothstep(0.93, 1, r).
  float rim = smoothstep(0.93, 1.0, vRadial);
  float t = clamp((vRadial - 0.93) / 0.07, 0.0, 1.0);
  float dRim = 6.0 * t * (1.0 - t) / 0.07;
  vec2 radial = normalize(vFieldUv - 0.5 + 1e-6);
  float meniscusSlope = uMeniscus * 2.0 * rim * dRim / ${DISH.agarRadius.toFixed(1)};
  vec3 objectNormal = normalize(vec3(
    -slope.x - radial.x * meniscusSlope,
    1.0,
    -slope.y - radial.y * meniscusSlope
  ));
  normal = normalize(normalMatrix * objectNormal);
}
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += agarGlow;
`;

const FRAGMENT_CLEARCOAT_NORMAL = /* glsl */ `
#include <clearcoat_normal_fragment_maps>
#ifdef USE_CLEARCOAT
  clearcoatNormal = normal;
#endif
`;

/**
 * PBR agar surface whose colour, roughness, normals and displacement are driven
 * by the simulation texture. Built on MeshPhysicalMaterial so it takes part in
 * the scene's lighting, shadows and environment reflections.
 */
export function createAgarMaterial(options: AgarMaterialOptions): AgarMaterial {
  const uniforms: AgarUniforms = {
    uField: { value: options.field },
    uTrace: { value: options.trace },
    uFieldSize: { value: new Vector2(options.gridSize, options.gridSize) },
    uTexelMm: { value: (DISH.agarRadius * 2) / options.gridSize },
    uRadius: { value: DISH.agarRadius },
    uMeniscus: { value: MENISCUS_MM },
    uColony: { value: options.colony },
    uAgar: { value: options.agar },
    uOverlay: { value: options.overlay },
    uStyle: { value: 0 },
    uOverlayMode: { value: 0 },
    uColonyHeight: { value: MAX_RENDER_HEIGHT_MM },
  };

  const material = new MeshPhysicalMaterial({
    // Colour comes entirely from the agar and colony textures.
    color: '#ffffff',
    roughness: 0.2,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
    // A little sheen-like forward scatter stands in for agar translucency.
    sheen: 0.25,
    sheenRoughness: 0.6,
    sheenColor: new Color('#fff4d6'),
  }) as AgarMaterial;

  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE)
      .replace('#include <lights_physical_fragment>', FRAGMENT_LIGHTS)
      .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL)
      .replace('#include <clearcoat_normal_fragment_maps>', FRAGMENT_CLEARCOAT_NORMAL);
  };
  material.customProgramCacheKey = () => 'agar-surface-v7';
  return material;
}
