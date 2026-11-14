import type { Organism } from '../../data/organisms';
import { createRng, type Rng } from '../../sim';

/**
 * What you see down the microscope: a small, purely visual model of cells on
 * a slide. It knows each organism's cell shape, size and arrangement and lets
 * cells grow and divide (binary fission, budding, hyphal extension) so the
 * field looks alive. It has no effect on the plate simulation.
 *
 * Lengths are in µm; time is in "visual seconds" (a generation takes a few).
 */

export type SlideParticleKind = 'cell' | 'bud' | 'hypha' | 'conidium' | 'vesicle' | 'sporangium';

/** One drawn object: a capsule (circle when halfLength is 0) on the slide. */
export interface SlideParticle {
  kind: SlideParticleKind;
  /** Index into the composition passed to SlideSim. */
  species: number;
  x: number;
  y: number;
  /** Direction of the long axis, rad. */
  angle: number;
  /** Half the length of the straight part of the capsule (0 for a sphere). */
  halfLength: number;
  radius: number;
  /** 0–1: how far a septum has pinched in ahead of division. */
  pinch: number;
}

interface Cell extends SlideParticle {
  /** Division axis planned for the next split (cocci). */
  nextAxis: number;
  /** Resting half-length and radius this cell divides back to. */
  restHalf: number;
  restRadius: number;
  /** Growth speed multiplier (cells are not perfectly synchronous). */
  pace: number;
  /** Partner this cell stays attached to (chains, pairs), or −1. */
  link: number;
  /** Growing tip of a hypha. */
  tip: boolean;
  /** µm grown since the hypha last branched or formed a septum. */
  sinceSeptum: number;
  /** Frozen particles (spores, old hyphae) neither move nor grow. */
  frozen: boolean;
}

export interface SlideComposition {
  organism: Organism;
  /** Share of the cells on the slide, any positive scale. */
  share: number;
}

/** Visual seconds for one generation at pace 1. */
const GENERATION_S = 7;
const MAX_PARTICLES = 420;
const HYPHA_SEGMENT_UM = 28;
const HYPHA_SPEED_UM_PER_S = 9;

export class SlideSim {
  readonly particles: Cell[] = [];
  /** Radius of the populated part of the slide, µm; a sensible field of view. */
  readonly fieldRadiusUm: number;
  private readonly rng: Rng;
  private readonly organisms: Organism[];
  private elapsed = 0;

  constructor(composition: SlideComposition[], seed: number) {
    this.rng = createRng(seed);
    this.organisms = composition.map((c) => c.organism);
    const total = composition.reduce((sum, c) => sum + Math.max(0, c.share), 0);
    const hasMold = composition.some((c) => c.organism.form === 'mold');
    const largest = Math.max(1, ...composition.map((c) => c.organism.cell.widthUm));
    this.fieldRadiusUm = hasMold ? 260 : largest >= 3 ? 55 : 22;
    if (total <= 0) return;

    const founders = hasMold ? 4 : 9;
    composition.forEach((entry, species) => {
      if (entry.share <= 0) return;
      // Everything present in more than trace amounts is represented at least once.
      const count = Math.max(
        entry.share / total > 0.02 ? 1 : 0,
        Math.round((founders * entry.share) / total),
      );
      for (let k = 0; k < count; k++) this.seed(species);
    });
  }

  get time(): number {
    return this.elapsed;
  }

  /** True once the slide is full and nothing more will divide. */
  get crowded(): boolean {
    return this.particles.length >= MAX_PARTICLES;
  }

  private seed(species: number): void {
    const o = this.organisms[species];
    const spread = this.fieldRadiusUm * 0.55;
    const r = spread * Math.sqrt(this.rng.next());
    const a = 2 * Math.PI * this.rng.next();
    const radius = o.cell.widthUm / 2;
    const isRod = o.cell.shape === 'bacillus' || o.cell.shape === 'coccobacillus';
    const restHalf = o.form === 'mold' ? 4 : isRod ? Math.max(0, o.cell.lengthUm / 2 - radius) : o.form === 'yeast' ? Math.max(0, o.cell.lengthUm / 2 - radius) : 0; // prettier-ignore
    const angle = 2 * Math.PI * this.rng.next();
    this.particles.push({
      kind: o.form === 'mold' ? 'hypha' : 'cell',
      species,
      x: r * Math.cos(a),
      y: r * Math.sin(a),
      angle,
      halfLength: restHalf,
      radius,
      pinch: 0,
      nextAxis: angle,
      restHalf,
      restRadius: radius,
      pace: 0.75 + 0.5 * this.rng.next(),
      link: -1,
      tip: o.form === 'mold',
      sinceSeptum: 0,
      frozen: false,
    });
  }

  /** Advance the slide by `dt` visual seconds. */
  step(dt: number): void {
    if (!(dt > 0)) return;
    this.elapsed += dt;
    const count = this.particles.length;
    for (let i = 0; i < count; i++) {
      const cell = this.particles[i];
      if (cell.frozen) continue;
      const o = this.organisms[cell.species];
      if (o.form === 'mold') this.growHypha(i, dt);
      else if (o.form === 'yeast') this.growYeast(i, dt);
      else this.growBacterium(i, dt);
    }
    this.relax();
    this.jiggle(dt);
  }

  // ---- Bacteria: binary fission --------------------------------------------------------

  private growBacterium(index: number, dt: number): void {
    const cell = this.particles[index];
    const o = this.organisms[cell.species];
    if (this.crowded) {
      cell.pinch = 0;
      return;
    }
    // A cell doubles its length, then splits. For a coccus that means growing from a
    // sphere (half-length 0) to two touching spheres (half-length = radius).
    const fullHalf = cell.restHalf * 2 + cell.restRadius;
    const span = fullHalf - cell.restHalf;
    cell.halfLength += (span / GENERATION_S) * cell.pace * dt;
    const progress = (cell.halfLength - cell.restHalf) / span;
    cell.pinch = progress < 0.6 ? 0 : Math.min(1, (progress - 0.6) / 0.4);
    if (progress < 1) return;

    const arrangement = o.cell.arrangement;
    const offset = cell.restHalf + cell.restRadius;
    const dx = Math.cos(cell.angle) * offset;
    const dy = Math.sin(cell.angle) * offset;
    const isCoccus = cell.restHalf === 0;
    // Plane of the next division decides the arrangement.
    let axis = cell.angle;
    if (isCoccus) {
      if (arrangement === 'clusters') axis = 2 * Math.PI * this.rng.next();
      else if (arrangement === 'tetrads') axis = cell.angle + Math.PI / 2;
      else axis = cell.angle + (this.rng.next() - 0.5) * 0.25;
    } else if (arrangement !== 'chains') {
      // Free rods drift out of line after separating.
      axis = cell.angle + (this.rng.next() - 0.5) * 0.9;
    }
    const linked = arrangement === 'chains' || arrangement === 'pairs' || arrangement === 'tetrads';
    const daughterIndex = this.particles.length;
    // The daughter appears on the +axis side. Work out who the mother was attached to there,
    // so the daughter can be spliced into the chain instead of being pulled across it.
    let daughterLink = linked ? index : -1;
    let motherLink = cell.link;
    if (arrangement === 'pairs') {
      // A dividing diplococcus lets go of its old partner: each half founds a new pair.
      for (const other of this.particles) if (other.link === index) other.link = -1;
      motherLink = daughterIndex;
    } else if (arrangement === 'chains') {
      const ahead = (other: Cell) => (other.x - cell.x) * dx + (other.y - cell.y) * dy > 0;
      const partner = cell.link >= 0 ? this.particles[cell.link] : undefined;
      if (partner && ahead(partner)) {
        // mother → partner becomes mother → daughter → partner
        daughterLink = cell.link;
        motherLink = daughterIndex;
      } else {
        // anything that hung on to the mother from the far side now hangs on to the daughter
        for (const other of this.particles) {
          if (other.link === index && ahead(other)) other.link = daughterIndex;
        }
      }
    }
    const daughter: Cell = {
      ...cell,
      x: cell.x + dx,
      y: cell.y + dy,
      angle: isCoccus ? axis : arrangement === 'chains' ? cell.angle : axis,
      halfLength: cell.restHalf,
      pinch: 0,
      nextAxis: axis,
      pace: 0.75 + 0.5 * this.rng.next(),
      link: daughterLink,
    };
    cell.x -= dx;
    cell.y -= dy;
    cell.halfLength = cell.restHalf;
    cell.pinch = 0;
    if (isCoccus) cell.angle = axis;
    else if (arrangement !== 'chains') cell.angle += (this.rng.next() - 0.5) * 0.9;
    cell.link = motherLink;
    this.particles.push(daughter);
  }

  // ---- Yeast: budding ------------------------------------------------------------------

  private growYeast(index: number, dt: number): void {
    const cell = this.particles[index];
    if (cell.kind === 'bud') {
      const mother = this.particles[cell.link];
      const target = cell.restRadius * 0.85;
      cell.radius = Math.min(target, cell.radius + (target / GENERATION_S) * cell.pace * dt);
      if (mother) {
        // The bud sits on the mother's surface.
        const reach = mother.radius + mother.halfLength + cell.radius * 0.8;
        cell.x = mother.x + Math.cos(cell.angle) * reach;
        cell.y = mother.y + Math.sin(cell.angle) * reach;
      }
      if (cell.radius >= target) {
        cell.kind = 'cell';
        cell.link = -1;
        cell.sinceSeptum = 0;
      }
      return;
    }
    // A freshly released daughter is still small: it grows to full size before budding itself.
    if (cell.radius < cell.restRadius) {
      const rate = (cell.restRadius / GENERATION_S) * cell.pace * dt;
      cell.radius = Math.min(cell.restRadius, cell.radius + rate);
      return;
    }
    if (this.crowded) return;
    // A mother makes one bud at a time.
    cell.sinceSeptum += dt * cell.pace;
    const budding = this.particles.some((p) => p.kind === 'bud' && p.link === index);
    if (budding || cell.sinceSeptum < GENERATION_S * 0.35) return;
    const angle = 2 * Math.PI * this.rng.next();
    this.particles.push({
      ...cell,
      kind: 'bud',
      angle,
      radius: cell.restRadius * 0.15,
      halfLength: cell.halfLength * 0.6,
      link: index,
      pace: 0.75 + 0.5 * this.rng.next(),
      sinceSeptum: 0,
    });
    cell.sinceSeptum = 0;
  }

  // ---- Molds: hyphal extension, branching and spore heads --------------------------------

  private growHypha(index: number, dt: number): void {
    const cell = this.particles[index];
    if (!cell.tip) return;
    if (this.crowded) {
      cell.tip = false;
      return;
    }
    const o = this.organisms[cell.species];
    const grow = HYPHA_SPEED_UM_PER_S * cell.pace * dt;
    // The segment lengthens at its far end.
    cell.halfLength += grow / 2;
    cell.x += (Math.cos(cell.angle) * grow) / 2;
    cell.y += (Math.sin(cell.angle) * grow) / 2;
    cell.sinceSeptum += grow;
    if (cell.sinceSeptum < HYPHA_SEGMENT_UM) return;

    // Lay down a septum: this segment stops, a new one continues from its end.
    cell.tip = false;
    cell.frozen = true;
    const endX = cell.x + Math.cos(cell.angle) * cell.halfLength;
    const endY = cell.y + Math.sin(cell.angle) * cell.halfLength;
    const far = Math.hypot(endX, endY) > this.fieldRadiusUm * 0.9;
    const sporulate = far || this.rng.next() < 0.16;
    if (sporulate) {
      this.addSporeHead(cell.species, endX, endY, cell.angle);
      return;
    }
    const continueFrom = (angle: number) => {
      this.particles.push({
        ...cell,
        x: endX + Math.cos(angle) * 0.5,
        y: endY + Math.sin(angle) * 0.5,
        angle,
        halfLength: 0.5,
        tip: true,
        frozen: false,
        sinceSeptum: 0,
        pace: 0.75 + 0.5 * this.rng.next(),
      });
    };
    continueFrom(cell.angle + (this.rng.next() - 0.5) * 0.5);
    // Rhizopus is sparsely septate and branches less; the others branch freely.
    const branchChance = o.cell.sporeStructure === 'sporangium' ? 0.25 : 0.45;
    if (this.rng.next() < branchChance) {
      const side = this.rng.next() < 0.5 ? -1 : 1;
      continueFrom(cell.angle + side * (0.6 + 0.5 * this.rng.next()));
    }
  }

  /** The spore-bearing structure at the end of a hypha. */
  private addSporeHead(species: number, x: number, y: number, angle: number): void {
    const o = this.organisms[species];
    const base = {
      species,
      angle,
      pinch: 0,
      nextAxis: angle,
      restHalf: 0,
      restRadius: 1,
      pace: 1,
      link: -1,
      tip: false,
      sinceSeptum: 0,
      frozen: true,
    };
    const add = (
      kind: SlideParticleKind,
      px: number,
      py: number,
      radius: number,
      halfLength = 0,
      a = angle,
    ) => this.particles.push({ ...base, kind, x: px, y: py, radius, halfLength, angle: a });
    const sporeRadius = Math.max(1.2, o.cell.widthUm * 0.45);

    if (o.cell.sporeStructure === 'sporangium') {
      // Rhizopus: one large round sporangium full of spores.
      add('sporangium', x + Math.cos(angle) * 22, y + Math.sin(angle) * 22, 22);
      return;
    }
    if (o.cell.sporeStructure === 'aspergillum') {
      // Aspergillus: a swollen vesicle with chains of conidia radiating all round.
      const vesicle = 9;
      const cx = x + Math.cos(angle) * vesicle;
      const cy = y + Math.sin(angle) * vesicle;
      add('vesicle', cx, cy, vesicle);
      for (let k = 0; k < 14; k++) {
        const a = (2 * Math.PI * k) / 14 + this.rng.next() * 0.2;
        for (let j = 0; j < 4; j++) {
          const d = vesicle + sporeRadius * (1.2 + 2 * j);
          add('conidium', cx + Math.cos(a) * d, cy + Math.sin(a) * d, sporeRadius);
        }
      }
      return;
    }
    // Penicillium: a brush of phialides, each bearing a chain of conidia.
    for (let k = -2; k <= 2; k++) {
      const a = angle + k * 0.22;
      const stalk = 7;
      add(
        'hypha',
        x + (Math.cos(a) * stalk) / 2,
        y + (Math.sin(a) * stalk) / 2,
        o.cell.widthUm * 0.4,
        stalk / 2,
        a,
      );
      for (let j = 0; j < 6; j++) {
        const d = stalk + sporeRadius * (1.1 + 2 * j);
        add('conidium', x + Math.cos(a) * d, y + Math.sin(a) * d, sporeRadius);
      }
    }
  }

  // ---- Crowding ------------------------------------------------------------------------

  /** Push overlapping cells apart and keep linked cells together. */
  private relax(): void {
    const cells = this.particles;
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      if (a.frozen || a.kind === 'bud' || a.kind === 'hypha') continue;
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        if (b.frozen || b.kind === 'bud' || b.kind === 'hypha') continue;
        // Capsules are approximated by their bounding circles along the shorter direction:
        // good enough to keep a field of cells from piling up.
        const reachA = a.radius + a.halfLength * 0.6;
        const reachB = b.radius + b.halfLength * 0.6;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const linked = a.link === j || b.link === i;
        // Cheap rejection before anything else: most pairs are nowhere near each other.
        const farthest = (a.radius + a.halfLength + b.radius + b.halfLength) * 2.2;
        if (!linked && dx * dx + dy * dy > farthest * farthest) continue;
        let distance = Math.hypot(dx, dy);
        // Only cells that are actually attached sit in contact. Clustering cocci stick to
        // whatever they touch; everything else keeps a little clear water around it, and
        // separate pairs of diplococci drift well apart.
        const habit =
          a.species === b.species ? this.organisms[a.species].cell.arrangement : 'single';
        const apart = linked || habit === 'clusters' ? 1 : habit === 'pairs' ? 2.2 : 1.25;
        const rest = linked
          ? a.radius + a.halfLength + b.radius + b.halfLength
          : (reachA + reachB) * apart;
        if (!linked && distance >= rest) continue;
        if (distance < 1e-6) {
          // Coincident: separate along a direction derived from the indices (no randomness needed).
          dx = Math.cos(i * 2.4 + j);
          dy = Math.sin(i * 2.4 + j);
          distance = 1;
        }
        // Linked cells are pulled to exactly touching; others only pushed apart.
        const correction = ((rest - distance) / distance) * (linked ? 0.35 : 0.5) * 0.5;
        a.x -= dx * correction;
        a.y -= dy * correction;
        b.x += dx * correction;
        b.y += dy * correction;
        if (linked && a.restHalf > 0) {
          // Rods in a chain line up end to end.
          const along = Math.atan2(dy, dx);
          a.angle += shortestTurn(a.angle, along) * 0.08;
          b.angle += shortestTurn(b.angle, along) * 0.08;
        }
      }
    }
  }

  /** Motile cells tumble and swim a little; everything shows faint Brownian motion. */
  private jiggle(dt: number): void {
    for (const cell of this.particles) {
      if (cell.frozen || cell.kind === 'hypha' || cell.kind === 'bud') continue;
      const motile = this.organisms[cell.species].cell.motile && cell.link < 0;
      const amplitude = (motile ? 1.6 : 0.12) * Math.sqrt(dt);
      cell.x += (this.rng.next() - 0.5) * amplitude;
      cell.y += (this.rng.next() - 0.5) * amplitude;
      if (motile) {
        cell.angle += (this.rng.next() - 0.5) * 0.5 * Math.sqrt(dt);
        cell.x += Math.cos(cell.angle) * 1.2 * dt;
        cell.y += Math.sin(cell.angle) * 1.2 * dt;
      }
    }
  }
}

/** Smallest signed rotation taking a rod's axis (which has no head or tail) onto `target`. */
function shortestTurn(angle: number, target: number): number {
  let delta = (target - angle) % Math.PI;
  if (delta > Math.PI / 2) delta -= Math.PI;
  if (delta < -Math.PI / 2) delta += Math.PI;
  return delta;
}
