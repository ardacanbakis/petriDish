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

## Several species on one plate

Each species has its own biomass and lag fields. They interact in two ways only: they draw on the
same nutrient, and the density cap of a grid cell applies to their combined biomass, so a colony
cannot grow into space another already fills. The only direct antagonism is antibiotic
secretion (see Antibiotics).

## Media: selectivity

Each medium lists selectivity rules (`src/data/media.ts`). Every rule that matches an organism
(by kingdom, growth form, Gram reaction or a trait such as bile tolerance) contributes a factor,
and the factors multiply into one growth factor _f_ for that organism on that medium. _f_ scales
both μopt and the colony expansion speed; _f_ = 0 means no growth. Examples: bile salts and
crystal violet in MacConkey agar give _f_ = 0 for organisms that are not bile-tolerant; 7.5 % NaCl
in mannitol salt agar gives _f_ = 0 for organisms that are not salt-tolerant; fastidious
streptococci get _f_ = 0.2 on media without blood.

Simplification: selectivity is all-or-partial scaling of growth, not a model of the inhibitor's
chemistry. Lag is not lengthened on hostile media.

## Media: pH indicators (MacConkey, mannitol salt)

On a medium with an indicator, an organism that ferments the medium's sugar releases acid in
proportion to the biomass it grows:

    acid produced = a · ΔB

The acid diffuses through the agar (Fickian, no-flux wall). Where it accumulates the indicator
turns: colonies of fermenters take the indicator's colony colour and the surrounding agar shifts
towards its acid colour, giving the pink halo of precipitated bile around strong lactose fermenters
on MacConkey and the yellow zone around _S. aureus_ on mannitol salt agar. Non-fermenters release
no acid and stay their own colour.

Simplifications: there is no separate lactose or mannitol pool (acid follows growth on the general
nutrient); acid is never neutralised; non-fermenters do not alkalinise the medium; pH is not
computed, only a dimensionless acid level compared with a threshold.

## Hemolysis (blood agar)

Colonies of α- and β-hemolytic organisms secrete a hemolysin at a rate proportional to their
density and to γ(T). The hemolysin diffuses; red cells exposed to it lyse irreversibly:

    ∂H/∂t = D_H ∇²H + s · (B / Bmax) · γ(T)
    ∂L/∂t = k · H · (1 − L)

`L` is the lysed fraction (separately for α and β). Because lysis is irreversible and driven by
accumulated exposure, the zone has a fairly sharp edge and keeps widening with incubation, as on a
real plate. β-lysis is drawn as clearing of the blood, α as greening; where both occur clearing
wins. γ organisms secrete nothing.

Simplifications: one generic hemolysin per type; hemolysin does not decay or bind; all β organisms
secrete at the same rate, so zone width differs between species only through colony size and
density.

## Pigments

- **Cell-bound, temperature-dependent** (_Serratia_ prodigiosin): each unit of new biomass is
  pigmented by a factor that falls smoothly from 1 at or below `fullBelowC` to 0 at or above
  `noneAboveC`. The pigmented fraction is stored per grid cell and is biomass-weighted, so growth
  made at 25 °C stays red after the plate is moved to 37 °C while new growth is pale.
- **Cell-bound, constitutive** (_Chromobacterium_ violacein, _S. aureus_, _M. luteus_): simply the
  colony colour.
- **Water-soluble** (_Pseudomonas_ pyocyanin/pyoverdine, as one pigment): released in proportion to
  growth, diffuses through the agar and tints it.

## Swarming (_Proteus_)

After a delay following colony establishment, a swarming species alternates between a swarm phase
(front speed `speedMmPerH`, for `activeFraction` of each `periodH` cycle) and a consolidation phase
(front speed back to the ordinary colony expansion speed). Grid cells first reached during a swarm
phase can only ever hold a thin film (`thinDensityFraction` of the normal maximum); cells reached
during consolidation fill to full density. The result is the characteristic set of concentric
terraces. Media that suppress swarming (MacConkey, mannitol salt) give ordinary colonies.

Simplification: the cycle is a fixed clock scaled by nothing but the on/off of γ(T) > 0; real
swarm periodicity depends on temperature, agar concentration and cell density.

## Colony morphology

Described morphology is translated into model parameters in `src/data/resolve.ts`:

| Described           | Model                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| Edge                | amplitude of per-cell noise and of smooth "lobe" noise on the front speed        |
| Elevation           | exponent of the height profile, height ∝ (B / Bmax)^p (flat 0.15 … umbonate 0.9) |
| Surface             | roughness (glistening … matt) and procedural relief (wrinkled, velvety, cottony) |
| Opacity, colour     | used directly by the renderer                                                    |
| Mucoid (Klebsiella) | taller colony, higher maximum density, low roughness                             |

## Fungi

Yeasts (_Candida_) are treated exactly like bacteria with their own parameters. Molds use the same
front model with a strongly irregular (filamentous or rhizoid) edge, a tall velvety or cottony
surface, and a colour that matures with the age of each part of the colony (time since that grid
cell was colonised), so a colony has a white growing margin and a coloured, sporulating centre.

**Not modelled:** individual hyphae, branching, stolons, aerial spore dispersal. The spec's
agent-based hyphal model is deferred; it matters mainly for the close-up colony view.

## Antibiotics

Parameters: `src/data/antibiotics.ts` (disc potency, diffusion coefficient, cidal or static,
breakpoints) and `src/data/susceptibility.ts` (MIC per organism). Engine: `src/sim/engine/dish.ts`.

### Discs and diffusion

Each antibiotic on a dish has a concentration field `c` in µg per mL of agar. A disc holds its
potency `M` (µg) and leaches it into the agar directly beneath it:

    dM/dt = −k_release · M

The released drug is spread over the grid cells under the disc; one grid cell of area Δx² over agar
of depth `h` (4 mm) holds Δx² · h · 10⁻³ mL. The drug then diffuses (Fickian, no-flux wall), so
drug is conserved: what has left the disc is in the agar.

### Inhibition and killing

For a species with minimum inhibitory concentration `MIC` for the drug:

    MIC_eff = MIC · (1 + B / B_i)                       (inoculum effect)
    growth and front speed are multiplied by 1 / (1 + (c / MIC_eff)⁴)
    death rate = k_kill · min(1, c / MIC_eff − 1)        while c > MIC_eff

`k_kill` is 1 /h for bactericidal drugs and 0.05 /h for bacteriostatic ones. With several drugs the
inhibition factors multiply and the death rates add. A population reduced below one hundredth of a
cell per grid cell is removed.

### Why zones form where they do

Zones are not drawn; they emerge. Without the inoculum effect the zone edge would sit where the
_peak_ concentration ever reaches the MIC, which is far too large. Real plates have a **critical
time**: once the lawn has grown dense enough the drug can no longer stop it, so the zone edge is
where the concentration reached the MIC _before_ that moment. The term `B / B_i` (with
`B_i = 3 × 10⁻³` density units, about 4–5 hours of growth from a standard swab inoculum)
reproduces this: dense growth raises its own effective MIC faster than the drug arrives.

Consequences that match the bench: larger zones for lower MIC, more potent discs and faster-
diffusing drugs; small zones for vancomycin (a large, slow molecule); no zone when the organism is
intrinsically resistant; no effect from a disc placed on an already grown lawn; zones that are
stable between 18 and 24 hours. Tests compare simulated zones with CLSI quality-control ranges for
_E. coli_ ATCC 25922, _S. aureus_ ATCC 25923 and _P. aeruginosa_ ATCC 27853 (the simulation tends
to sit at the lower end of each range).

### Antagonism (Fleming)

An organism can secrete an antibiotic at a rate proportional to its density and γ(T).
_Penicillium_ secretes penicillin, which diffuses and inhibits susceptible bacteria exactly as
disc-borne drug does. A lawn of _S. aureus_ swabbed on after the mold has grown fails to grow near
it; _E. coli_ is unaffected.

Simplifications: one MIC per organism–drug pair (no strain variation, no acquired or induced
resistance, no heteroresistance); drugs do not degrade or bind to agar or cells; killing does not
depend on growth rate; MICs are assigned as "no activity" for intrinsic resistance rather than a
very high number; breakpoints are a single representative CLSI set per drug applied to every
organism; fungi are unaffected by all eight drugs; mature dense growth is fully protected.

## Contamination

Parameters: `src/data/contamination.ts`.

- **Airborne fallout.** While the lid is off, cells and spores land on the agar as a Poisson
  process with a mean of 20 per hour of exposure, at uniformly random positions, drawn from a
  weighted list of typical indoor-air organisms (micrococci, _Bacillus_, _S. epidermidis_, mold
  spores). Each arrival is a single cell that then grows, or fails to, like any other inoculum on
  that medium.
- **Exposure time.** Simulated time that passes with the lid off counts in full. Bench work is
  compressed: each real second with the lid off counts as 10 seconds of exposure.
- **Aseptic zone.** A lit Bunsen burner removes 90 % of the fallout.
- **Unsterilised loop.** A loop that has not been flamed since it was last laid down has a 50 %
  chance of carrying about 200 cells of one of the same organisms. Flaming removes whatever is on
  the loop. A swab is sterile out of its wrapper.

All draws come from the dish's seeded generator, so a given seed and sequence of actions always
produces the same contaminants in the same places.

Simplifications: fallout is uniform over the plate and independent of air movement, people or
distance from the flame; the protection factor and time compression are teaching values.

## Where a plate is

Up to four plates share one lab clock. Each plate has its own medium, random stream, inoculations
and history, and is stepped with the conditions of wherever it currently is:

| Location  | Temperature                               | Atmosphere                     |
| --------- | ----------------------------------------- | ------------------------------ |
| Bench     | room temperature (setting, default 22 °C) | air                            |
| Incubator | set temperature (20–50 °C, default 37 °C) | air, or 5 % CO₂ if switched on |
| Fridge    | 4 °C                                      | air                            |

At 4 °C every organism in the library is below or near its minimum temperature, so growth stops
(γ(T) = 0) and the lag does not progress; diffusion of nutrients, acid, pigments and antibiotics
carries on at the same rate (their temperature dependence is not modelled). A plate taken out of
the fridge resumes from where it left off.

**CO₂.** Capnophilic organisms carry a growth-rate multiplier that applies only in the CO₂
incubator (_S. pneumoniae_ × 1.4, _S. pyogenes_ × 1.15). It has no effect on other organisms, and
CO₂ does not change the pH of the medium.

Tools carry organisms by identity, not by plate: a loop that touches a colony on one plate and
then streaks another transfers those cells (subculturing), and each organism then behaves
according to the medium of the plate it lands on.

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
colonisation density, which locates colony edges to a fraction of a grid cell) into textures,
together with a biomass-weighted colony colour and the agar colour after indicator, hemolysis and
pigment changes (`src/sim/render/compose.ts`). The agar shader filters them and uses them for
colony outline, colour, gloss, surface normal and a small displacement. Freshly inoculated cells are
invisible, as on a real plate; the faint dull track where the loop touched the agar is a visual aid
only.

## Known simplifications

- One generic nutrient; no oxygen, no true pH, no waste products other than indicator acid.
- The agar is two-dimensional; vertical nutrient gradients and colony height limits due to
  diffusion through the colony are not modelled.
- Diffusion coefficients do not depend on temperature.
- Colony expansion speed is a parameter, not derived from growth rate and rim width.
- Motility is represented only by colony expansion speed and Proteus swarming; no separate
  live/dead biomass.

## Still to come

- Spread-plate and stab inoculation
- Agent-based fungal hyphae

## References

- Rosso L, Lobry JR, Flandrois JP (1993). An unexpected correlation between cardinal temperatures
  of microbial growth highlighted by a new model. _J Theor Biol_ 162:447–463.
- Baranyi J, Roberts TA (1994). A dynamic approach to predicting bacterial growth in food.
  _Int J Food Microbiol_ 23:277–294.
- Rauprich O et al. (1996). Periodic phenomena in _Proteus mirabilis_ swarm colony development.
  _J Bacteriol_ 178:6525–6538.
- Williams RP et al. (1971). Influence of temperature of incubation and type of growth medium on
  pigmentation in _Serratia marcescens_. _J Bacteriol_ 106:438–443.
- Monod J (1949). The growth of bacterial cultures. _Annu Rev Microbiol_ 3:371–394.
