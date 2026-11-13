import {
  CustomBlending,
  DoubleSide,
  MeshPhysicalMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
} from 'three';

export interface GlassOptions {
  /** Opacity looking straight through a wall. */
  faceOpacity: number;
  /** Opacity at grazing angles (rims and curved walls). */
  edgeOpacity: number;
  roughness: number;
  envMapIntensity: number;
}

/**
 * Cheap, layer-safe glass.
 *
 * Real transmission would need an extra render pass and hides other glass
 * behind it (lid over base). Instead the surface is rendered as reflections
 * only (near-black diffuse), added on top of the background, with a Fresnel
 * term that slightly dims and tints what is behind it at grazing angles. That
 * reproduces what the eye reads as clear glass: invisible faces, bright rims.
 */
export function createGlassMaterial(options: GlassOptions): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: '#05070a',
    roughness: options.roughness,
    metalness: 0,
    ior: 1.5,
    specularIntensity: 0.6,
    envMapIntensity: options.envMapIntensity,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // out = reflections + background · (1 − alpha): highlights are never dimmed by alpha.
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });

  const face = options.faceOpacity.toFixed(3);
  const edge = options.edgeOpacity.toFixed(3);
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
      {
        float facing = abs(dot(normalize(vViewPosition), normal));
        float fresnel = pow(1.0 - facing, 3.0);
        float glassAlpha = mix(${face}, ${edge}, fresnel);
        gl_FragColor = vec4(outgoingLight, glassAlpha);
      }
      `,
    );
  };
  material.customProgramCacheKey = () => `glass-${face}-${edge}`;
  return material;
}
