import { DoubleSide, ShaderMaterial } from 'three';

/**
 * Draws every cell on the slide as a quad with a capsule shape computed in the
 * fragment shader: crisp at any magnification, with a septum that pinches in
 * before division and an optional halo for phase contrast.
 *
 * Per-instance attributes (all in µm):
 *   aCenter (x, y)   aAxis (cos, sin of the long axis)
 *   aShape  (half-length of the straight part, radius, pinch 0–1)
 *   aColor  (r, g, b)   aOpacity
 */
export function createCellMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      /** Width of the bright ring drawn outside each cell (phase contrast), as a fraction of its radius. */
      uHalo: { value: 0 },
      /** How much darker the outline is than the interior (unstained cells are mostly outline). */
      uOutline: { value: 0.35 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCenter;
      attribute vec2 aAxis;
      attribute vec3 aShape;
      attribute vec3 aColor;
      attribute float aOpacity;
      uniform float uHalo;
      varying vec2 vLocal;
      varying vec3 vShape;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        // Room around the capsule for anti-aliasing and the halo.
        float pad = aShape.y * (0.35 + uHalo) + 0.15;
        vec2 extent = vec2(aShape.x + aShape.y + pad, aShape.y + pad);
        vLocal = position.xy * 2.0 * extent;
        vShape = aShape;
        vColor = aColor;
        vOpacity = aOpacity;
        vec2 world = aCenter + vLocal.x * aAxis + vLocal.y * vec2(-aAxis.y, aAxis.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uHalo;
      uniform float uOutline;
      varying vec2 vLocal;
      varying vec3 vShape;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        float halfLength = vShape.x;
        float radius = vShape.y;
        // The septum narrows the cell at its middle as division approaches.
        float waist = 1.0 - 0.55 * vShape.z * exp(-pow(vLocal.x / max(radius * 0.55, 1e-3), 2.0));
        float r = radius * waist;
        vec2 p = vec2(max(abs(vLocal.x) - halfLength, 0.0), vLocal.y);
        float d = length(p) - r; // signed distance to the cell wall, µm
        float aa = max(fwidth(d), 1e-4);
        float inside = 1.0 - smoothstep(-aa, aa, d);
        // Darker towards the wall, as stained cells look.
        float rim = smoothstep(-r * 0.55, 0.0, d);
        vec3 color = vColor * (1.0 - uOutline * rim);
        float alpha = inside * vOpacity;
        if (uHalo > 0.0) {
          float ring = (1.0 - smoothstep(0.0, radius * uHalo, d)) * (1.0 - inside);
          color = mix(color, vec3(0.93, 0.94, 0.88), ring);
          alpha = max(alpha, ring * 0.75);
        }
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

/** Thin wavy lines for flagella. Instance attributes: aRoot (x, y), aDir (cos, sin), aWave (length, phase). */
export function createFlagellumMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uColor: { value: [0.25, 0.2, 0.3] },
      uOpacity: { value: 0.5 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aRoot;
      attribute vec2 aDir;
      attribute vec2 aWave;
      varying vec2 vLocal;
      varying vec2 vWave;
      void main() {
        float amplitude = 0.3;
        // Quad spans the flagellum's length and a little more than its wave height.
        vLocal = vec2((position.x + 0.5) * aWave.x, position.y * 2.0 * (amplitude + 0.2));
        vWave = aWave;
        vec2 world = aRoot + vLocal.x * aDir + vLocal.y * vec2(-aDir.y, aDir.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vLocal;
      varying vec2 vWave;
      void main() {
        // A helix seen side-on is a sine wave; it grows from nothing at the cell surface.
        float envelope = smoothstep(0.0, 0.8, vLocal.x);
        float wave = 0.3 * envelope * sin(vLocal.x * 2.6 - uTime * 9.0 + vWave.y);
        float d = abs(vLocal.y - wave);
        float aa = max(fwidth(d), 1e-4);
        float line = 1.0 - smoothstep(0.03, 0.03 + aa * 1.5, d);
        float alpha = line * uOpacity * (1.0 - smoothstep(vWave.x * 0.85, vWave.x, vLocal.x));
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
}
