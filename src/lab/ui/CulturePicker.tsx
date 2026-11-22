import { useTranslation } from 'react-i18next';
import { ORGANISM_IDS, ORGANISMS } from '../../data/organisms';
import { MIXED_SAMPLE_IDS, MIXED_SAMPLES, type SourceId } from '../../data/samples';
import { useLabStore } from '../../state/labStore';

/** Choice of the culture or sample the loop, swab or pipette takes from. */
export function CulturePicker({ className }: { className: string }) {
  const { t } = useTranslation();
  const source = useLabStore((s) => s.source);
  const setSource = useLabStore((s) => s.setSource);
  const hidden = MIXED_SAMPLE_IDS.filter((id) => MIXED_SAMPLES[id].hidden);
  const open = MIXED_SAMPLE_IDS.filter((id) => !MIXED_SAMPLES[id].hidden);
  return (
    <select
      className={className}
      value={source}
      aria-label={t('lab.culture.title')}
      data-tip={t('lab.work.cultureTip')}
      onChange={(e) => setSource(e.target.value as SourceId)}
    >
      <optgroup label={t('lab.culture.pure')}>
        {ORGANISM_IDS.map((id) => (
          <option key={id} value={`organism:${id}`}>
            {ORGANISMS[id].name}
          </option>
        ))}
      </optgroup>
      <optgroup label={t('lab.culture.mixed')}>
        {open.map((id) => (
          <option key={id} value={`sample:${id}`}>
            {t(`samples.${id}`)}
          </option>
        ))}
      </optgroup>
      <optgroup label={t('lab.culture.unknown')}>
        {hidden.map((id) => (
          <option key={id} value={`sample:${id}`}>
            {t(`samples.${id}`)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
