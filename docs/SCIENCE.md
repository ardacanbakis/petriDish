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

## Models

_To be filled in from Phase 1:_

- Growth: Monod kinetics, μ = μmax(T) · S / (Ks + S)
- Temperature: Rosso cardinal temperature model with inflection (CTMI)
- Lag phase
- Nutrient and antibiotic diffusion (Fickian), numerical scheme and stability bound
- Colony expansion (Fisher–KPP front)
- Antibiotic inhibition (MIC)
- Differential media reactions
