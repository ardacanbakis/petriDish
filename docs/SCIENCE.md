# Science notes

This document describes every model equation used by the simulation, with its assumptions and
simplifications, so that a microbiologist can audit it. It grows with each build phase.

All values are **educational approximations**. Parameters live in `src/data/`, each with
`sources`, `notes` and a `reviewed` flag; nothing here has been expert-reviewed yet.

## Determinism

The simulation is a pure function of `seed + inputs + event log`. All randomness comes from a
seeded mulberry32 generator (`src/sim/engine/rng.ts`). Independent subsystems derive their own
sub-seeds with `deriveSeed(seed, label)`, so adding random draws in one subsystem does not change
the stream seen by another.

## Units

| Quantity    | Unit                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| Length      | mm                                                                                     |
| Time        | hours                                                                                  |
| Temperature | °C                                                                                     |
| Nutrient    | dimensionless; 1.0 = the nutrient content of plain nutrient agar                       |
| Biomass     | dimensionless areal density; 1.0 ≈ a mature dense colony, taken as 2 × 10⁸ cells / mm² |

Nutrient and biomass are **normalised simulator units**, not measured concentrations. `Ks`, yield
and maximum density are therefore tuning parameters expressed in those units.

## Grid and time

The agar surface (86 mm across for a 90 mm dish) is covered by an N × N square grid (default
256 × 256, about 0.34 mm per cell), masked to a circle. The agar is treated as a 2D sheet: depth is
not resolved, so nutrient "per cell" stands for the whole agar column under that cell.

Time advances in fixed steps of `dtHours` (default 0.05 h = 3 min). The state is a function of the
step count only, never of frame rate or wall-clock time.

## Growth

Implemented in `src/sim/engine/growth.ts`, `temperature.ts` and `dish.ts`.

### Specific growth rate

    μ = μopt · γ(T) · S / (Ks + S) · α

- **Monod limitation** `S / (Ks + S)` on a single generic nutrient `S`.
- **Temperature**, Rosso's cardinal temperature model with inflection (CTMI):

      γ(T) = (T − Tmax)(T − Tmin)² / { (Topt − Tmin) · [ (Topt − Tmin)(T − Topt) − (Topt − Tmax)(Topt + Tmin − 2T) ] }

  for Tmin < T < Tmax, and 0 otherwise. γ(Topt) = 1.

- **Lag**, after Baranyi & Roberts (1994). Each cell of the grid carries an adaptation value
  α ∈ [0, 1] for the biomass in it. With physiological state q, α = q / (1 + q) and
  dq/dt = μopt · γ(T) · q, which makes α follow a logistic curve. A fully lagged inoculum starts at
  α₀ = exp(−μopt · λ), where λ is the organism's lag time at Topt. Consequences:
  - the lag lasts about λ hours at Topt and stretches as temperature falls;
  - below Tmin (refrigerator) adaptation does not progress, but is not lost either;
  - biomass added to a cell mixes its α with what is already there, weighted by biomass.

### Local density

Within a colonised cell, biomass `B` follows logistic growth towards the organism's maximum
density `Bmax`:

    dB/dt = μ · B · (1 − B / Bmax)

integrated with the exact logistic solution over each step (not forward Euler), treating `S` as
constant during the step. With several species in one cell the cap applies to their combined
density.

### Nutrient uptake

Every unit of new biomass consumes `1 / Y` units of nutrient from the same cell (`Y` = yield).
Growth in a step is limited to what the nutrient in the cell can pay for, so nutrient never goes
negative.

### Death

    dB/dt = −[ k_starve · (1 − S / (Ks + S)) + k_heat · max(0, T − Tmax) ] · B

A slow first-order decline when starved, and faster killing above Tmax. Dead biomass is simply
removed; it is not tracked separately and returns nothing to the medium.

## Colony expansion

A real colony edge is a growing rim tens of micrometres wide, far below the grid resolution. A
reaction–diffusion (Fisher–KPP) front on this grid would be under-resolved and its speed would
depend on the grid size. Instead the edge is treated as a sharp front moving outward at a
prescribed speed, i.e. a first-order upwind solution of the eikonal equation |∇T| = 1 / v for the
arrival time T.

- A cell is **colonised** once its density reaches `frontDensityFraction · Bmax`.
- An uncolonised cell next to a colonised one is a **front cell**. It fills at

      dB/dt = B_front · (v / Δx) · g

  where g = 1 if it has colonised neighbours along one axis and √2 if along both (the Godunov
  upwind norm), so the front crosses one cell in Δx / v along the axes and moves at the same speed
  diagonally.

- Local front speed:

      v = v_opt · γ(T) · S / (Ks + S) · α_colony · noise

  `v_opt` is the organism's radial expansion speed (mm/h). `noise` is a static, seeded per-cell
  factor (mean 1) that produces naturally irregular edges.

- Front cells do not also grow exponentially; otherwise the edge would run ahead of `v` by an
  amount that depends on the grid.

A single inoculated cell therefore grows exponentially (after its lag) until it reaches
colonisation density, and from then on the colony radius grows linearly in time, slowing as
nutrient under the rim is used up. Unit tests check that the measured radial speed matches
`v_opt · γ(T)`, that colonies stay round, and that colony size agrees between grid resolutions.

## Nutrient diffusion

Fick's second law, ∂S/∂t = D ∇²S, solved with an explicit 5-point scheme (FTCS). The dish wall is
a no-flux boundary, so the total amount of nutrient changes only through uptake.

The scheme is stable for D·Δt/Δx² ≤ 0.25. Each simulation step is split into as many equal
sub-steps as needed to keep that number at or below 0.2, so it remains stable for any diffusion
coefficient, grid size or timestep. Tests check boundedness (maximum principle), conservation and
that a point source spreads with variance 2·D·t.

## Inoculation with a loop

Implemented in `src/sim/engine/inoculation.ts`; parameters in `src/data/tools.ts`.

The loop carries a number of viable cells per species. Dragging it across the agar is walked in
steps of half a grid cell. At each step of length Δs the loop touches the grid cells within half
its track width, and:

1. **Deposits** a fraction of its load: ΔL = L · (1 − exp(−k · Δs)), with `k = depositPerMm`.
   Along a stroke the load therefore decays exponentially, L(s) ≈ L₀ · exp(−k′ · s).
2. **Picks up** a fraction of whatever is already on the agar under it:
   1 − (1 − p)^(Δs / w) per step, i.e. `p = pickupFraction` for one full pass of a loop of width w.
   Picked-up cells keep their lag state.

Because the moving loop picks some of its own fresh deposit back up, the net depletion rate k′
lies between k · (1 − p) and k.

When fewer than 30 cells are involved in a deposit or pickup they are treated as individuals:
the number is drawn from a Poisson distribution (or rounded stochastically) with the dish's seeded
generator and each cell is placed in a random grid cell under the loop. This is what turns a thin
inoculum into discrete, separate colonies rather than a faint uniform film.

**Flaming** removes everything from the loop. A flamed loop dragged through an earlier streak picks
up a small fraction of those cells and spreads them on, so each flamed quadrant starts from a much
smaller inoculum. Tests confirm that a four-quadrant streak from a 1 µL loopful (10⁶ cells) gives a
confluent first quadrant and isolated colonies by the third, while a short unflamed smear stays
confluent.

Simplifications: pressure, angle and drawing speed do not matter; the agar is never gouged; heat
from a just-flamed loop does not kill cells it touches; the deposit and pickup fractions are tuned
to reproduce the expected plate, not measured.

## What the renderer shows

The renderer never changes simulation state. Each frame the worker encodes, per grid cell,
√(biomass / maximum density), nutrient / initial nutrient and colony coverage (biomass relative to
colonisation density, which locates colony edges to a fraction of a grid cell) into a texture. The
agar shader filters it bicubically and uses it for colony outline, colour, gloss, surface normal
and a small displacement (a mature colony stands `heightMm` above the agar). Freshly inoculated cells are
invisible, as on a real plate; the faint dull track where the loop touched the agar is a visual aid
only.

## Known simplifications

- One generic nutrient; no oxygen, no pH, no waste products.
- The agar is two-dimensional; vertical nutrient gradients and colony height limits due to
  diffusion through the colony are not modelled.
- Diffusion coefficients do not depend on temperature.
- Colony expansion speed is a parameter, not derived from growth rate and rim width.
- No motility or swarming yet; no separate live/dead biomass.

## Still to come

- Swab, spread-plate and stab inoculation
- Antibiotic diffusion and MIC-based inhibition
- Differential and selective media reactions
- Pigments, hemolysis, swarming, fungal hyphae

## References

- Rosso L, Lobry JR, Flandrois JP (1993). An unexpected correlation between cardinal temperatures
  of microbial growth highlighted by a new model. _J Theor Biol_ 162:447–463.
- Baranyi J, Roberts TA (1994). A dynamic approach to predicting bacterial growth in food.
  _Int J Food Microbiol_ 23:277–294.
- Monod J (1949). The growth of bacterial cultures. _Annu Rev Microbiol_ 3:371–394.
