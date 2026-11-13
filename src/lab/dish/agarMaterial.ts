import { Color, MeshPhysicalMaterial, Vector2, type Texture } from 'three';
import { DISH, MENISCUS_MM } from './dimensions';

export interface AgarMaterialOptions {
  /** Simulation render frame (see DishSim.encodeRenderFrame). */
  field: Texture;
  /** Greyscale mask of where the loop has touched the agar. */
  trace: Texture;
  gridSize: number;
  agarColor: string;
  colonyColor: string;
  colonyRoughness: number;
  colonyHeightMm: number;
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
  uColonyColor: { value: Color };
  uColonyRoughness: { value: number };
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
uniform vec3 uColonyColor;
uniform float uColonyRoughness;
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
// Height falls to zero at the colony edge.
float agarFillHere = agarFieldHere.r * agarCover;
float agarTrace = texture2D(uTrace, vFieldUv).r * (1.0 - agarCover);
{
  // Thin growth is slightly translucent; thick growth is opaque.
  vec3 colony = uColonyColor * mix(0.88, 1.0, agarFieldHere.r);
  vec3 agar = diffuseColor.rgb * (1.0 - 0.07 * agarTrace);
  diffuseColor.rgb = mix(agar, colony, agarCover * mix(0.8, 1.0, agarFieldHere.r));
}
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor + 0.22 * agarTrace, uColonyRoughness, agarCover);
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
  slope = clamp(slope, vec2(-0.9), vec2(0.9));
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
    uColonyColor: { value: new Color(options.colonyColor) },
    uColonyRoughness: { value: options.colonyRoughness },
    uColonyHeight: { value: options.colonyHeightMm },
  };

  const material = new MeshPhysicalMaterial({
    color: options.agarColor,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
    // A little sheen-like forward scatter stands in for agar translucency.
    sheen: 0.4,
    sheenRoughness: 0.6,
    sheenColor: new Color(options.agarColor).multiplyScalar(1.2),
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
      .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL)
      .replace('#include <clearcoat_normal_fragment_maps>', FRAGMENT_CLEARCOAT_NORMAL);
  };
  material.customProgramCacheKey = () => 'agar-surface-v4';
  return material;
}
