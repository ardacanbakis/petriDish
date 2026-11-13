import { useTranslation } from 'react-i18next';
import type { MediumId } from '../../data/media';
import { ORGANISMS, type Organism, type OrganismId } from '../../data/organisms';
import { growthFactor } from '../../data/resolve';
import { sourceComposition, type SourceId } from '../../data/samples';

/** Fact card for the selected culture: what it is and how it behaves on the current plate. */
export function CultureCard({ source, medium }: { source: SourceId; medium: MediumId }) {
  const { t } = useTranslation();
  const sample = sourceComposition(source);

  if (sample.hidden) {
    return <p className="text-xs text-slate-400">{t('lab.culture.hiddenFact')}</p>;
  }
  if (sample.composition.length > 1) {
    return (
      <ul className="text-xs italic text-slate-300">
        {sample.composition.map((part) => (
          <li key={part.organism}>{ORGANISMS[part.organism].name}</li>
        ))}
      </ul>
    );
  }

  const id: OrganismId = sample.composition[0].organism;
  const organism: Organism = ORGANISMS[id];
  const factor = growthFactor(id, medium);
  const traits = [
    t(`bio.gram.${organism.gram ?? 'none'}`),
    `${t(`bio.shape.${organism.cell.shape}`)}, ${t(`bio.arrangement.${organism.cell.arrangement}`)}`,
    organism.cell.motile ? t('bio.motile') : t('bio.nonMotile'),
    t(`bio.hemolysis.${organism.hemolysis}`),
  ];

  return (
    <div className="text-xs text-slate-300">
      <p className="text-sm italic text-agar-100">{organism.name}</p>
      <p className="mt-1 text-slate-400">{traits.join(' · ')}</p>
      <p className="mt-1">{t(`organisms.${id}.fact`)}</p>
      {factor < 0.5 && (
        <p className="mt-1 font-medium text-amber-300">
          {factor === 0 ? t('lab.culture.noGrowth') : t('lab.culture.poorGrowth')}
        </p>
      )}
      <p className="mt-1 text-[10px] text-slate-500">{t('bio.approximation')}</p>
    </div>
  );
}
