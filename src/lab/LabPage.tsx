import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSettingsStore, type QualityPreset } from '../state/settingsStore';
import { LabScene } from './scene/LabScene';
import { LabSession } from './session';
import { getTheme } from './themes';
import { SessionContext } from './SessionContext';
import { Hud } from './ui/Hud';
import { useLabHotkeys } from './ui/useLabHotkeys';

/** What each quality preset costs. Post-processing joins this table in Phase 10. */
const QUALITY: Record<QualityPreset, { gridSize: number; maxDpr: number; shadows: boolean }> = {
  low: { gridSize: 128, maxDpr: 1, shadows: false },
  medium: { gridSize: 256, maxDpr: 1.5, shadows: true },
  high: { gridSize: 256, maxDpr: 2, shadows: true },
};

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function LabPage() {
  const { t } = useTranslation();
  const quality = useSettingsStore((s) => s.quality);
  const theme = getTheme(useSettingsStore((s) => s.theme));
  const [webgl] = useState(hasWebGL);
  const [session, setSession] = useState<LabSession | null>(null);
  useLabHotkeys();

  useEffect(() => {
    if (!webgl) return;
    const created = new LabSession({
      gridSize: QUALITY[quality].gridSize,
      seed: 1,
    });
    setSession(created);
    return () => {
      created.dispose();
      setSession(null);
    };
  }, [webgl, quality]);

  if (!webgl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-slate-300">
        <p>{t('lab.webglUnavailable')}</p>
        <Link to="/" className="text-agar-300 hover:underline">
          ← {t('common.back')}
        </Link>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      {session && (
        <SessionContext.Provider value={session}>
          <Canvas
            key={quality}
            shadows={QUALITY[quality].shadows}
            dpr={[1, QUALITY[quality].maxDpr]}
            camera={{ position: [0, 150, 205], fov: 32, near: 5, far: 4000 }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* R3F does not forward React context into the canvas tree. */}
            <SessionContext.Provider value={session}>
              <LabScene />
            </SessionContext.Provider>
          </Canvas>
          {/* Vignette: draws the eye to the work area; purely cosmetic. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${theme.vignette}) 100%)`,
            }}
          />
          <Hud />
        </SessionContext.Provider>
      )}
    </div>
  );
}
