# Agar

An interactive 3D petri dish and microbiology lab simulator that runs entirely in the browser.
Streak plates, drop antibiotic discs, incubate, and watch colonies grow from a deterministic,
scientifically grounded model.

> Agar is an educational model, not a substitute for real laboratory work. Biological parameters
> are approximations; see [`docs/SCIENCE.md`](docs/SCIENCE.md).

**Status:** all eleven build phases (0–10) are implemented. See [Known gaps](#known-gaps) for what is simplified or missing. See [Roadmap](#roadmap).

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
- `#/science` — Science & Sources: every parameter, stain and rule with its provenance
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
  intro/        landing page with a live hero dish
  science/      Science & Sources page
  assistant/    Lab Assistant rules
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
docs/SCIENCE.md model equations, assumptions and simplifications
```

## Using the lab

1. Pick a **medium** and take a new plate (`N`). The **work bar** under the plate holds everything
   needed while working on it: the lid, the burner, the current tool's actions and Incubate.
2. Pick up the **Loop** (`O`), open the lid (`L`), light the burner (`B`), flame the loop (`F`),
   choose a culture and dip (`D`), then drag on the agar to streak. The loop thins out as you go.
   A line beside the pointer says what a click or drag will do, or which step is missing.
3. **Flame** between quadrants and drag out of the previous quadrant to get isolated colonies.
4. **Incubate** (`I`): the lid goes on and the plate goes into the incubator. Press **Play**
   (`Space`) and raise the speed (`]`).
5. Take up to four plates to compare media or conditions side by side; each can sit on the bench,
   in the incubator or in the fridge, and carries a label you write on its lid.

For a disc-diffusion (Kirby-Bauer) test: take a Mueller-Hinton plate, light the burner, open the
lid, choose **Swab** (`S`), dip it, **Swab the whole plate**, then choose **Disc** (`K`) and click
the agar to place discs 24 mm apart. Incubate 18 hours.

Leave the lid off without the burner lit and airborne contaminants will land on the plate.

**Mouse.** Right-click (without dragging) anything — a colony, a plate, the incubator, the burner,
the microscope — for a menu of what can be done with it. Middle-drag pans with any tool, the
wheel zooms towards the cursor, and right-drag orbits (with the Hand tool, left-drag orbits and
right-drag pans). Every control has a tooltip with its shortcut; `?` lists them all.

| Key             | Action                                          |
| --------------- | ----------------------------------------------- |
| `Space`         | Play / pause                                    |
| `[` `]`         | Halve / double simulation speed                 |
| `H O S P K R M` | Hand, Loop, Swab, Spread, Disc, Ruler, Count    |
| `L` `B` `F` `D` | Lid, burner, flame the loop, dip in the culture |
| `I`             | Incubate, or bring the plate back to the bench  |
| `N` · `1`–`4`   | New plate · select a plate                      |
| `C`             | Recentre the view                               |
| `Esc`           | Step back: menu, tool, macroscopy, plate view   |

## Looking closer

**Macroscopy.** Right-click a colony and choose _Examine this colony_: the camera moves in, and
the card describes the colony as a lab manual would — size, form, margin, elevation, surface,
opacity, colour, pigment, hemolysis and the reaction on indicator media, with pictograms. Names
are never shown. Pin up to three colonies to compare them; features that differ are highlighted,
which is how a contaminant gives itself away. The culture card shows the typical colony of the
culture you are using.

**Microscopy.** _Make a slide_ (from the right-click menu or the macroscopy card) opens the
microscope on a sample from that spot. Choose how to prepare it: a live wet mount (bright-field or
phase contrast), a simple stain, Gram, acid-fast (Ziehl–Neelsen), endospore (Schaeffer–Fulton),
capsule (negative stain) or lactophenol cotton blue, at 100×, 400× or 1000×. A legend under the
eyepiece says what the colours mean.

## Measuring and recording

- **Ruler**: drag on the agar to measure a length; click a disc to measure its zone of inhibition
  and see it read as susceptible, intermediate or resistant.
- **Spread**: pipette 0.1 mL of a 10⁻¹ to 10⁻⁸ dilution and spread it, for countable plates.
- **Count**: count colonies automatically or tick them off by hand; on a spread plate the count is
  turned into CFU/mL.
- **Notebook** (next to the play button): the automatic log of everything done plus your own notes,
  a growth chart per plate (log scale optional), a PNG screenshot and a printable **lab report**
  (use the browser's print dialog to save it as PDF).

## Challenges and the Lab Assistant

- **Challenges** (button under the session name) offers nine guided experiments: Pure Culture,
  Fleming's Accident, Kirby-Bauer, Temperature Matters, Differential Media, Blood Agar Detective,
  Count the CFUs, Aseptic Master and Mystery Microbe. Each shows a goal and a checklist that is
  ticked off from what is really on the plates, not from buttons pressed. Sandbox mode is the
  absence of a challenge.
- **Assistant on**: suggests the next step and outlines the control to use, warns before mistakes
  (unflamed loop, lid off without the flame, a medium the organism cannot grow on), explains what a
  grown plate is showing, and can set up the medium, culture, tool and incubator for a challenge.
- **Assistant off**: no hints or warnings, and the culture card shows the model's raw parameters
  (cardinal temperatures, μ, lag, expansion rate, MICs).

Challenge criteria live in `src/data/challenges.ts`; the assistant's rules in
`src/assistant/advice.ts`. Both are pure functions with tests.

## Timeline and sessions

- Drag the **timeline** above the play button to rewind or fast-forward the whole bench. Ticks mark
  new plates, inoculations, discs, moves and discards. Acting while in the past discards what came
  after and continues from there.
- Sessions **save automatically** in the browser and reopen on the next visit. The **Session**
  button opens the manager: new, rename, duplicate, delete, **export** to a `.agar.json` file and
  **import** one (validated; damaged or newer-version files are refused with a reason).
- A session file is only the seed and the list of actions, typically a few kilobytes.

## Architecture

- `src/sim` runs in a **Web Worker**. The UI sends commands (`createDish`, `advance`, `stroke`,
  `flameLoop`, `loadLoop`) and every command is answered with a frame: the simulation fields
  encoded as a texture, transferred without copying.
- The UI thread decides how far simulated time should have advanced; the worker steps towards it
  within a per-request CPU budget. A slow machine therefore runs the simulation slower instead of
  dropping frames, and the result is identical either way.
- The agar is a `MeshPhysicalMaterial` extended with shader code that reads that texture.
- `src/persistence/events.ts` defines the event log. The lab session turns each user action into an
  event, applies it to the bench state, and sends the corresponding commands to the worker, which
  records them and keeps keyframes for rewinding.
- `src/persistence/schema.ts` (zod schema, versions, migrations) and `storage.ts` (localStorage
  with quota handling) handle files and saved sessions.

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

## Themes, overlays and settings

**Settings** (top left) switches between three visual themes at any time: _Photoreal lab_,
_Stylized_ (flat tones and outlines) and _Bioluminescent_ (dark lab, colonies glowing in
species-coded colours with bloom). The simulation and scene are the same in all three. A **data
overlay** can replace the agar's natural look with nutrient level, antibiotic concentration or a
species map. Quality, room temperature, language and the assistant are set there too. `?` opens
the controls reference.

## Sharing

In the session manager, **Copy share link** packs the session (seed and event log, compressed) into
the URL. Opening the link recreates the experiment; nothing is uploaded anywhere. Long sessions
give long links, and the app says so when a link exceeds 8000 characters; export a file instead.

## Science & Sources

`#/science` lists every organism, medium, antibiotic, MIC and technique parameter with its sources,
notes and a reviewed / not reviewed badge, rendered directly from `src/data/`. The model itself is
documented in [`docs/SCIENCE.md`](docs/SCIENCE.md).

## Known gaps

Compared with the original specification:

- **Not verified on a GPU.** Development ran on a machine with software WebGL only (1–3 fps), so
  the 60 fps target and the look of the photoreal theme on real hardware are unconfirmed.
- **Simulation backend** is a CPU Web Worker at 256² (128² on low quality). There is no GPU
  backend and no 512² option; nutrient diffusion is the cost that would need an implicit solver or
  GPGPU first.
- **Fungal hyphae** are not simulated as agents on the plate; molds use the same front model with
  an irregular edge, a fuzzy surface and age-dependent colour. Hyphae appear only in the
  microscope view.
- **Tools not built:** inoculating needle (stab), and separate pipette and spreader steps (spread
  plating is one action). The disc "dispenser" is a tool that places one disc per click.
- **Photoreal extras not built:** glass refraction, depth of field, condensation on the lid, HDRI.
- **Charts:** population per organism per plate; no zone-diameter-over-time chart.
- **Units setting** is not implemented (metric only).
- **Turkish** text was written without native review; biological notes and citations in the
  Science page are English only.
- **No expert review yet:** every data entry is flagged `reviewed: false`.
- **Staining** is chosen, not performed: reagent order, timing and staining mistakes (over- or
  under-decolourising) are not simulated. No organism in the library is acid-fast.

## Roadmap

All phases are implemented:

0. Setup
1. Sim core (headless): Monod + CTMI growth, lag, diffusion, tests, 2D debug view
2. Dish & inoculation: 3D dish, agar shader, loop streaking, lid, time controls
3. Biology breadth: organisms, media, pigments, hemolysis, fungi
4. Antibiotics & contamination: discs, MIC inhibition, swab, Bunsen burner, airborne fallout
5. Lab environment: bench, incubator, fridge, up to four plates, camera views, lid labels
6. Rewind & persistence: keyframes, scrubbable timeline, saved sessions, import/export
7. Zoom levels: colony close-up, microscope with Gram stain and dividing cells
8. Measurement & data: ruler, zones, colony counter, spread plates, charts, notebook, report
9. Challenges and Lab Assistant: nine guided experiments checked against the simulation
10. Themes, intro page & polish: three themes, data overlays, settings, share links, Science &
    Sources, intro page with a live hero

After user testing, an interaction pass: a right-click menu on everything in the scene (it
replaced the Inspect tool), middle-button panning and zoom to the cursor, a work bar under the
plate with keyboard shortcuts, hints beside the pointer and tooltips on every control, a
macroscopy view that describes colonies, and a choice of seven stains at the microscope.
