import { describe, expect, it } from 'vitest';
import { CONTAMINATION } from '../../data/contamination';
import { MORPHOLOGY } from '../../data/morphology';
import { ORGANISM_IDS, ORGANISMS, type OrganismId } from '../../data/organisms';
import {
  colourName,
  describeColony,
  differences,
  sizeClass,
  type ColonyMeasurement,
  type Descriptor,
} from '../macroscopy';

const measured = (overrides: Partial<ColonyMeasurement> = {}): ColonyMeasurement => ({
  diameterMm: 2.4,
  circularity: 0.95,
  purity: 1,
  confluent: false,
  pigmentation: null,
  ageHours: null,
  ...overrides,
});

const value = (descriptors: Descriptor[], id: Descriptor['id']) =>
  descriptors.find((d) => d.id === id);

describe('colony morphology words', () => {
  it('classes colony sizes the way lab manuals do', () => {
    expect(sizeClass(0.5)).toBe('pinpoint');
    expect(sizeClass(1.5)).toBe('small');
    expect(sizeClass(3)).toBe('medium');
    expect(sizeClass(6)).toBe('large');
  });

  it('names colours by the nearest reference colour', () => {
    for (const { name, hex } of MORPHOLOGY.colours) {
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
        number,
        number,
        number,
      ];
      expect(colourName(rgb)).toBe(name);
    }
  });

  it('shows lactose fermentation on MacConkey agar, and only there', () => {
    const coli = describeColony('escherichia-coli', 'macconkey-agar', measured());
    expect(value(coli, 'reaction')?.value).toBe('bio.morph.reaction.lactose.positive');
    expect(value(coli, 'colour')?.value).toBe('bio.morph.colour.pinkRed');
    const salmonella = describeColony('salmonella-enterica', 'macconkey-agar', measured());
    expect(value(salmonella, 'reaction')?.value).toBe('bio.morph.reaction.lactose.negative');
    expect(value(salmonella, 'colour')?.value).toBe('bio.morph.colour.cream');
    expect(value(describeColony('escherichia-coli', 'nutrient-agar'), 'reaction')).toBeUndefined();
  });

  it('shows hemolysis on blood agar, and mannitol fermentation on mannitol salt agar', () => {
    expect(value(describeColony('staphylococcus-aureus', 'blood-agar'), 'hemolysis')?.value).toBe(
      'bio.morph.hemolysis.beta',
    );
    expect(
      value(describeColony('staphylococcus-aureus', 'nutrient-agar'), 'hemolysis'),
    ).toBeUndefined();
    expect(
      value(describeColony('staphylococcus-aureus', 'mannitol-salt-agar'), 'reaction')?.value,
    ).toBe('bio.morph.reaction.mannitol.positive');
    expect(
      value(describeColony('staphylococcus-epidermidis', 'mannitol-salt-agar'), 'reaction')?.value,
    ).toBe('bio.morph.reaction.mannitol.negative');
  });

  it('reads the outline from the measurement: punctiform, circular or irregular', () => {
    const form = (m: Partial<ColonyMeasurement>) =>
      value(describeColony('escherichia-coli', 'nutrient-agar', measured(m)), 'form')?.value;
    expect(form({})).toBe('bio.morph.form.circular');
    expect(form({ diameterMm: 0.6 })).toBe('bio.morph.form.punctiform');
    expect(form({ circularity: 0.5 })).toBe('bio.morph.form.irregular');
    // Molds are filamentous whatever their measured outline.
    expect(
      value(describeColony('penicillium-chrysogenum', 'sabouraud-agar', measured()), 'form')?.value,
    ).toBe('bio.morph.form.filamentous');
  });

  it('flags confluent growth and mixed colonies', () => {
    const lawn = describeColony('escherichia-coli', 'nutrient-agar', measured({ confluent: true }));
    expect(value(lawn, 'size')).toMatchObject({ value: 'bio.morph.confluent', warn: true });
    expect(value(lawn, 'form')).toBeUndefined();
    const mixed = describeColony('escherichia-coli', 'nutrient-agar', measured({ purity: 0.7 }));
    expect(value(mixed, 'purity')).toMatchObject({ value: 'bio.morph.mixed', warn: true });
    expect(
      value(describeColony('escherichia-coli', 'nutrient-agar', measured()), 'purity'),
    ).toBeUndefined();
  });

  it('follows pigment expression and mold maturation as measured on the plate', () => {
    const serratia = (pigmentation: number) =>
      value(
        describeColony('serratia-marcescens', 'nutrient-agar', measured({ pigmentation })),
        'colour',
      )?.value;
    expect(serratia(1)).toBe('bio.morph.colour.red');
    expect(serratia(0)).toBe('bio.morph.colour.cream');
    const aspergillus = (ageHours: number) =>
      value(
        describeColony('aspergillus-niger', 'sabouraud-agar', measured({ ageHours })),
        'colour',
      );
    expect(aspergillus(4)?.value).toBe('bio.morph.colour.white');
    expect(aspergillus(60)).toMatchObject({
      value: 'bio.morph.colourMatured',
      params: { colour: 'black' },
    });
    expect(
      value(describeColony('pseudomonas-aeruginosa', 'nutrient-agar'), 'pigment'),
    ).toMatchObject({
      params: { colour: 'blueGreen' },
    });
  });

  it('describes a measured colony in words only, never by name', () => {
    for (const id of ORGANISM_IDS) {
      for (const d of describeColony(id, 'nutrient-agar', measured())) {
        expect(d.value.startsWith('bio.morph.')).toBe(true);
        expect(JSON.stringify(d.params ?? {})).not.toMatch(/[A-Z][a-z]+ [a-z]+/);
      }
    }
  });

  it('lets every common contaminant be told apart, by eye or else under the microscope', () => {
    // Some colonies really do look alike (a staphylococcus and a yeast are both white,
    // round and smooth); then the cells must differ, which is why slides are made.
    const contaminants = CONTAMINATION.organisms.map((o) => o.organism);
    const lookAlikes: string[] = [];
    for (const contaminant of contaminants) {
      for (const id of ORGANISM_IDS) {
        if (id === contaminant) continue;
        const byEye = differences(
          describeColony(contaminant, 'nutrient-agar'),
          describeColony(id as OrganismId, 'nutrient-agar'),
        );
        if (byEye.size > 0) continue;
        lookAlikes.push(`${contaminant}~${id}`);
        const a = ORGANISMS[contaminant].cell;
        const b = ORGANISMS[id as OrganismId].cell;
        const underMicroscope =
          a.shape !== b.shape ||
          a.arrangement !== b.arrangement ||
          ORGANISMS[contaminant].gram !== ORGANISMS[id as OrganismId].gram;
        expect(underMicroscope, `${contaminant} vs ${id}`).toBe(true);
      }
    }
    // Most pairs differ by eye already.
    expect(lookAlikes.length).toBeLessThan(contaminants.length * 2);
  });

  it('ignores small differences in size within a class when comparing', () => {
    const a = describeColony('escherichia-coli', 'nutrient-agar', measured({ diameterMm: 2.2 }));
    const b = describeColony('escherichia-coli', 'nutrient-agar', measured({ diameterMm: 2.9 }));
    expect(differences(a, b).size).toBe(0);
    const c = describeColony('escherichia-coli', 'nutrient-agar', measured({ diameterMm: 0.8 }));
    expect([...differences(a, c)].sort()).toEqual(['form', 'size']);
  });
});
