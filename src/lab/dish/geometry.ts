import { BufferAttribute, LatheGeometry, RingGeometry, Vector2 } from 'three';
import { DISH } from './dimensions';

const SEGMENTS = 128;
const BEVEL = 0.35;

/** Lathe a closed profile; small bevels at the corners give glass its bright rim highlights. */
function lathe(profile: [number, number][]): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    SEGMENTS,
  );
}

/** Dish base: floor plus wall, with real thickness. Origin at the centre of the underside. */
export function createBaseGeometry(): LatheGeometry {
  const inner = DISH.agarRadius;
  const outer = inner + DISH.wallThickness;
  const h = DISH.baseHeight;
  const floor = DISH.floorThickness;
  return lathe([
    [0, 0],
    [outer - BEVEL, 0],
    [outer, BEVEL],
    [outer, h - BEVEL],
    [outer - BEVEL, h],
    [inner + BEVEL, h],
    [inner, h - BEVEL],
    [inner, floor],
    [0, floor],
  ]);
}

/** Lid: a slightly wider, shallower inverted dish. Origin at the centre of its top surface. */
export function createLidGeometry(): LatheGeometry {
  const inner = DISH.agarRadius + DISH.wallThickness + DISH.lidClearance;
  const outer = inner + DISH.lidThickness;
  const h = DISH.lidHeight;
  const top = DISH.lidThickness;
  return lathe([
    [0, 0],
    [outer - BEVEL, 0],
    [outer, -BEVEL],
    [outer, -h + BEVEL],
    [outer - BEVEL, -h],
    [inner + BEVEL, -h],
    [inner, -h + BEVEL],
    [inner, -top],
    [0, -top],
  ]);
}

/**
 * Flat disc in the XZ plane, finely tessellated so the vertex shader can
 * displace it. UVs map the disc's bounding square to [0, 1]², matching the
 * simulation grid (u ↔ sim x, v ↔ sim y ↔ world z).
 */
export function createAgarSurfaceGeometry(rings = 96, segments = 192): RingGeometry {
  const geometry = new RingGeometry(0, DISH.agarRadius, segments, rings);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  const size = DISH.agarRadius * 2;
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) / size + 0.5;
    uv[i * 2 + 1] = position.getZ(i) / size + 0.5;
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  return geometry;
}
