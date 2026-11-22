import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../app/LanguageToggle';
import { HELP_KEYS as KEYS, HELP_MOUSE as MOUSE } from '../lab/ui/shortcuts';
import { THEMES, type ThemeId } from '../state/settingsStore';

// three.js only arrives if the browser can use it.
const HeroDish = lazy(() => import('./HeroDish'));

const STEPS = [
  'plate',
  'medium',
  'flame',
  'inoculate',
  'discs',
  'incubate',
  'observe',
  'save',
] as const;
const CHALLENGES = [
  'pure-culture',
  'fleming',
  'kirby-bauer',
  'temperature',
  'differential-media',
  'blood-agar',
  'count-cfu',
  'aseptic',
  'mystery',
] as const;
/** A swatch standing in for each theme: bench, agar and colony colours. */
const THEME_SWATCH: Record<ThemeId, { bench: string; agar: string; colonies: string[] }> = {
  photoreal: { bench: '#1c2227', agar: '#d9c588', colonies: ['#ebe2c6', '#e6c860', '#c0182b'] },
  stylized: { bench: '#cfdbe3', agar: '#e6dcae', colonies: ['#f5efd6', '#f0d27a', '#e06a78'] },
  bioluminescent: {
    bench: '#02050a',
    agar: '#0b1118',
    colonies: ['#40e0d0', '#ff6384', '#ffce56'],
  },
};

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(query);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function StaticDish() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}favicon.svg`}
      alt=""
      className="h-full w-full object-contain p-6 drop-shadow-[0_0_40px_rgba(233,217,166,0.25)]"
    />
  );
}

const sectionTitle = 'text-2xl font-semibold text-agar-100';
const card = 'rounded-lg border border-slate-700 bg-bench-900/70 p-4';

export function IntroPage() {
  const { t } = useTranslation();
  const [webgl] = useState(hasWebGL);
  const reducedMotion = usePrefersReducedMotion();

  return (
    <main className="mx-auto max-w-5xl px-6 pb-20">
      <div className="flex justify-end pt-6">
        <LanguageToggle />
      </div>

      {/* Hero */}
      <section className="grid items-center gap-8 py-8 md:grid-cols-2">
        <div className="space-y-5 text-center md:text-left">
          <h1 className="text-6xl font-semibold tracking-tight text-agar-100">
            {t('common.appName')}
          </h1>
          <p className="text-xl text-slate-300">{t('intro.tagline')}</p>
          <Link
            to="/lab"
            className="inline-block rounded-lg bg-agar-200 px-7 py-3 text-lg font-semibold text-bench-900 shadow-lg transition hover:bg-agar-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-agar-400"
          >
            {t('intro.enterLab')}
          </Link>
          <p className="text-sm text-slate-400">{t('intro.desktopNote')}</p>
        </div>
        <div className="mx-auto aspect-square w-full max-w-md" aria-hidden="true">
          {webgl ? (
            <Suspense fallback={<StaticDish />}>
              <HeroDish animate={!reducedMotion} />
            </Suspense>
          ) : (
            <StaticDish />
          )}
        </div>
      </section>

      {/* What is this */}
      <section className="space-y-3 py-8">
        <h2 className={sectionTitle}>{t('intro.what.title')}</h2>
        <p className="text-slate-300">{t('intro.what.p1')}</p>
        <p className="text-slate-300">{t('intro.what.p2')}</p>
        <p className="rounded border border-amber-700 bg-amber-950/50 p-3 text-amber-100">
          {t('intro.disclaimer')}
        </p>
      </section>

      {/* How to use */}
      <section className="py-8">
        <h2 className={sectionTitle}>{t('intro.how.title')}</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step} className={card}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-agar-200 font-semibold text-bench-900">
                {index + 1}
              </span>
              <h3 className="mt-2 font-semibold text-slate-100">
                {t(`intro.how.steps.${step}.title`)}
              </h3>
              <p className="mt-1 text-sm text-slate-400">{t(`intro.how.steps.${step}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Controls */}
      <section className="py-8">
        <h2 className={sectionTitle}>{t('lab.help.title')}</h2>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <table className="w-full text-sm">
            <tbody>
              {KEYS.map(([keys, id]) => (
                <tr key={id} className="border-b border-slate-800">
                  <td className="w-32 py-1.5">
                    <kbd className="rounded bg-bench-700 px-1.5 py-0.5 font-mono text-xs text-agar-100">
                      {keys}
                    </kbd>
                  </td>
                  <td className="py-1.5 text-slate-300">{t(`lab.help.keys.${id}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
            {MOUSE.map((id) => (
              <li key={id}>{t(`lab.help.mouse.${id}`)}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Modes */}
      <section className="py-8">
        <h2 className={sectionTitle}>{t('intro.modes.title')}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className={card}>
            <h3 className="font-semibold text-slate-100">{t('lab.challenges.sandbox')}</h3>
            <p className="mt-1 text-sm text-slate-400">{t('intro.modes.sandbox')}</p>
          </div>
          <div className={card}>
            <h3 className="font-semibold text-slate-100">{t('lab.challenges.title')}</h3>
            <p className="mt-1 text-sm text-slate-400">{t('intro.modes.challenges')}</p>
            <ol className="mt-2 list-decimal pl-5 text-sm text-slate-300">
              {CHALLENGES.map((id) => (
                <li key={id}>{t(`challenges.${id}.title`)}</li>
              ))}
            </ol>
          </div>
          <div className={card}>
            <h3 className="font-semibold text-slate-100">{t('assistant.title')}</h3>
            <p className="mt-1 text-sm text-slate-400">{t('intro.modes.assistant')}</p>
          </div>
        </div>
      </section>

      {/* Themes */}
      <section className="py-8">
        <h2 className={sectionTitle}>{t('lab.settings.theme')}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {THEMES.map((id) => {
            const swatch = THEME_SWATCH[id];
            return (
              <div key={id} className={card}>
                <div
                  className="flex h-28 items-center justify-center rounded"
                  style={{ backgroundColor: swatch.bench }}
                  aria-hidden="true"
                >
                  <div
                    className="relative h-20 w-20 rounded-full border-2 border-white/40"
                    style={{ backgroundColor: swatch.agar }}
                  >
                    {swatch.colonies.map((color, i) => (
                      <span
                        key={color}
                        className="absolute h-4 w-4 rounded-full"
                        style={{
                          backgroundColor: color,
                          left: `${22 + i * 22}%`,
                          top: `${28 + ((i * 37) % 40)}%`,
                          boxShadow: id === 'bioluminescent' ? `0 0 10px 3px ${color}` : undefined,
                          outline: id === 'stylized' ? '2px solid #1a1723' : undefined,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <h3 className="mt-2 font-semibold text-slate-100">{t(`themes.${id}.name`)}</h3>
                <p className="mt-1 text-sm text-slate-400">{t(`themes.${id}.about`)}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Science */}
      <section className="space-y-3 py-8">
        <h2 className={sectionTitle}>{t('science.title')}</h2>
        <p className="text-slate-300">{t('intro.science')}</p>
        <Link to="/science" className="inline-block text-agar-300 underline">
          {t('science.title')} →
        </Link>
      </section>

      <footer className="border-t border-slate-800 pt-6 text-sm text-slate-500">
        <Link to="/debug/sim" className="hover:underline">
          {t('intro.debugLink')}
        </Link>
      </footer>
    </main>
  );
}
