# Agar

An interactive 3D petri dish and microbiology lab simulator that runs entirely in the browser.
Streak plates, drop antibiotic discs, incubate, and watch colonies grow from a deterministic,
scientifically grounded model.

> Agar is an educational model, not a substitute for real laboratory work. Biological parameters
> are approximations; see [`docs/SCIENCE.md`](docs/SCIENCE.md).

**Status:** Phase 4 (antibiotic discs, contamination, aseptic technique). See [Roadmap](#roadmap).

## Stack

Vite · React 18 · TypeScript (strict) · three.js / React Three Fiber / drei / postprocessing ·
Zustand · Tailwind CSS · i18next (English + Turkish) · Recharts · Leva · zod · Vitest

## Getting started

Requires Node 20+ (developed on Node 22).

```bash
npm install
```

```bash
npm run dev
```

The dev server prints a URL that includes the base path, e.g. `http://localhost:5173/petriDish/`.

| Script                 | What it does                       |
| ---------------------- | ---------------------------------- |
| `npm run dev`          | Start the dev server               |
| `npm run build`        | Type-check and build to `dist/`    |
| `npm run preview`      | Serve the production build locally |
| `npm test`             | Run unit tests (Vitest)            |
| `npm run lint`         | ESLint                             |
| `npm run format`       | Prettier (write)                   |
| `npm run format:check` | Prettier (check only)              |

## Routes

Hash routing is used so deep links survive static hosting.

- `#/` — intro page
- `#/lab` — the lab (lazy-loaded; three.js is not in the intro bundle)
- `#/debug/sim` — developer view of the simulation fields (biomass, nutrient, lag state)

## Deployment

The public base path comes from the `BASE_PATH` environment variable at build time and defaults
to `/petriDish/`. All asset URLs go through `import.meta.env.BASE_URL`.

### GitHub Pages (primary)

`.github/workflows/deploy.yml` lints, tests, builds and deploys `dist/` on every push to `main`.
It sets `BASE_PATH` to `/<repository name>/` automatically.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

### Vercel (or any host serving from the root)

Import the repo, keep the Vite preset, and add an environment variable `BASE_PATH=/`.
No `vercel.json` is needed: hash routing means there are no rewrites to configure.

```bash
BASE_PATH=/ npm run build
```

## Project structure

```
src/
  app/          routes, providers, shared layout
  intro/        landing page
  debug/        developer views (2D sim debug canvas)
  lab/          3D lab: scene, dish, tools, zoom, themes, ui
  sim/          pure simulation core (no React / Three imports — enforced by ESLint)
    engine/     grid, growth, diffusion, rng
    worker/     web worker wrapper
    keyframes/  snapshot / rewind
    __tests__/
  data/         organisms, media, antibiotics, susceptibility, challenges
  state/        zustand stores
  persistence/  localStorage, import/export, share links
  i18n/         en.json, tr.json
  assistant/    lab assistant rules
docs/SCIENCE.md model equations, assumptions and simplifications
```

## Using the lab (current build)

1. Pick a **medium** and take a new plate. **Open lid**, select the **Loop** tool (the camera
   moves to a top-down view).
2. Pick a **culture** (pure, mixed sample or unknown), **dip the loop**, then drag on the agar to streak. The loop thins out as you go.
3. **Flame loop** between quadrants and drag out of the previous quadrant to get isolated colonies.
4. **Close lid**, choose **Incubator**, press **Play** and raise the speed.

For a disc-diffusion (Kirby-Bauer) test: take a Mueller-Hinton plate, light the burner, open the
lid, choose **Swab**, dip it, **Swab the whole plate**, then choose **Disc** and click the agar to
place up to a handful of discs 24 mm apart. Incubate 18 hours.

Leave the lid off without the burner lit and airborne contaminants will land on the plate.

| Key     | Action                                      |
| ------- | ------------------------------------------- |
| `Space` | Play / pause                                |
| `[` `]` | Halve / double simulation speed             |
| `T`     | Cycle tool                                  |
| `L`     | Open / close lid                            |
| `Esc`   | Put the tool down, then leave top-down view |

With the Hand tool, drag orbits, scroll zooms and right-drag pans. With the Loop tool, left-drag
draws and right-drag orbits.

## Architecture

- `src/sim` runs in a **Web Worker**. The UI sends commands (`createDish`, `advance`, `stroke`,
  `flameLoop`, `loadLoop`) and every command is answered with a frame: the simulation fields
  encoded as a texture, transferred without copying.
- The UI thread decides how far simulated time should have advanced; the worker steps towards it
  within a per-request CPU budget. A slow machine therefore runs the simulation slower instead of
  dropping frames, and the result is identical either way.
- The agar is a `MeshPhysicalMaterial` extended with shader code that reads that texture.

## Editing the biology

Everything a microbiologist might want to tune is in `src/data/`:

| File           | Contents                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `organisms.ts` | 17 organisms: Gram, cell shape, cardinal temperatures, kinetics, colony morphology, pigments, hemolysis, traits |
| `media.ts`     | 7 media: nutrient level, colour, selectivity rules, indicators, blood                                           |
| `samples.ts`   | Mixed samples and unknowns                                                                                      |
| `tools.ts`     | Inoculation loop behaviour                                                                                      |
| `resolve.ts`   | How described traits map onto model parameters, and reaction strengths                                          |

Each entry carries `sources`, `notes` and `reviewed: false`. Fact-card text is in
`src/i18n/en.json` and `tr.json` under `organisms`, `media` and `samples`. `npm test` checks the
library for consistency and that plates render as expected (e.g. _E. coli_ pink on MacConkey,
_Serratia_ red at 25 °C but not 37 °C).

## Conventions

- Every user-facing string goes through i18n. A test fails if `tr.json` and `en.json` keys diverge.
- No biology in components; it lives in `src/data/`.
- The simulation is deterministic given seed + inputs. Never call `Math.random()` in `src/sim`;
  use `createRng` / `deriveSeed` from `src/sim/engine/rng.ts`.

## Roadmap

0. Setup ✓
1. Sim core (headless): Monod + CTMI growth, lag, diffusion, tests, 2D debug view ✓
2. Dish & inoculation: 3D dish, agar shader, loop streaking, lid, time controls ✓
3. Biology breadth: organisms, media, pigments, hemolysis, fungi ✓
4. **Antibiotics & contamination**: discs, MIC inhibition, swab, Bunsen burner, airborne fallout ← current
5. Lab environment
6. Rewind & persistence
7. Zoom levels: colony and cell view
8. Measurement & data
9. Challenges and Lab Assistant
10. Themes, intro page, polish
