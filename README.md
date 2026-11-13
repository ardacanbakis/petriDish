# Agar

An interactive 3D petri dish and microbiology lab simulator that runs entirely in the browser.
Streak plates, drop antibiotic discs, incubate, and watch colonies grow from a deterministic,
scientifically grounded model.

> Agar is an educational model, not a substitute for real laboratory work. Biological parameters
> are approximations; see [`docs/SCIENCE.md`](docs/SCIENCE.md).

**Status:** Phase 1 (headless simulation core with a 2D debug view). See [Roadmap](#roadmap).

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

## Conventions

- Every user-facing string goes through i18n. A test fails if `tr.json` and `en.json` keys diverge.
- No biology in components; it lives in `src/data/`.
- The simulation is deterministic given seed + inputs. Never call `Math.random()` in `src/sim`;
  use `createRng` / `deriveSeed` from `src/sim/engine/rng.ts`.

## Roadmap

0. Setup ✓
1. **Sim core (headless)**: Monod + CTMI growth, lag, diffusion, tests, 2D debug view ← current
2. Dish & inoculation
3. Biology breadth: organisms, media, pigments, hemolysis, fungi
4. Antibiotics & contamination
5. Lab environment
6. Rewind & persistence
7. Zoom levels: colony and cell view
8. Measurement & data
9. Challenges and Lab Assistant
10. Themes, intro page, polish
