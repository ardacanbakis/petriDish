import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  parseSessionFile,
  serializeSession,
  sessionFileName,
  type SessionFile,
} from '../persistence/schema';
import { SessionStore } from '../persistence/storage';
import { deriveSeed } from '../sim';
import { useLabStore } from '../state/labStore';
import { useSettingsStore, type QualityPreset } from '../state/settingsStore';
import { BENCH_POSE } from './layout';
import { LabScene } from './scene/LabScene';
import { LabSession } from './session';
import { SessionContext } from './SessionContext';
import { getTheme } from './themes';
import { Hud } from './ui/Hud';
import { SessionManager, type SessionActions } from './ui/SessionManager';
import { useLabHotkeys } from './ui/useLabHotkeys';
import { MicroscopeView } from './zoom/MicroscopeView';

/** What each quality preset costs. Post-processing joins this table in Phase 10. */
const QUALITY: Record<QualityPreset, { gridSize: number; maxDpr: number; shadows: boolean }> = {
  low: { gridSize: 128, maxDpr: 1, shadows: false },
  medium: { gridSize: 256, maxDpr: 1.5, shadows: true },
  high: { gridSize: 256, maxDpr: 2, shadows: true },
};
const AUTOSAVE_DELAY_MS = 1500;

/** Which session to run: a fresh one, or one opened from storage or a file. */
interface Boot {
  id: string;
  name: string;
  seed: number;
  file?: SessionFile;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const newId = () => `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
/** The seed is the only thing a new session takes from chance; everything after is deterministic. */
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

export default function LabPage() {
  const { t, i18n } = useTranslation();
  const quality = useSettingsStore((s) => s.quality);
  const theme = getTheme(useSettingsStore((s) => s.theme));
  const [webgl] = useState(hasWebGL);
  const store = useMemo(() => SessionStore.browser(), []);
  const [managerOpen, setManagerOpen] = useState(false);
  const microscopeOpen = useLabStore((s) => s.microscopeOpen);
  const inspect = useLabStore((s) => s.inspect);
  const [session, setSession] = useState<LabSession | null>(null);
  const sessionRef = useRef<LabSession | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qualityRef = useRef(quality);
  qualityRef.current = quality;

  const freshBoot = useCallback(
    (): Boot => ({
      id: newId(),
      name: t('lab.session.defaultName', {
        date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date()),
      }),
      seed: newSeed(),
    }),
    [t, i18n.language],
  );

  // Reopen whatever was open last time, if it is still there and valid.
  const [boot, setBoot] = useState<Boot>(() => {
    const lastId = store.lastId;
    const file = lastId ? store.load(lastId) : null;
    return lastId && file ? { id: lastId, name: file.name, seed: file.seed, file } : freshBoot();
  });

  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const current = sessionRef.current;
    const { sessionId, sessionName, showHint } = useLabStore.getState();
    if (!current || !sessionId || !store.available) return;
    const result = store.save(sessionId, current.toFile(sessionName));
    if (result.ok) store.lastId = sessionId;
    else if (result.reason === 'quota') showHint('lab.hints.saveFailed');
    if (result.evicted.length > 0) showHint('lab.hints.sessionsEvicted');
  }, [store]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(saveNow, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  useEffect(() => {
    if (!webgl) return;
    useLabStore.setState({ sessionId: boot.id, sessionName: boot.name });
    const created = new LabSession({
      gridSize: QUALITY[qualityRef.current].gridSize,
      seed: boot.seed,
      file: boot.file,
      onChange: scheduleSave,
    });
    sessionRef.current = created;
    setSession(created);
    return () => {
      saveNow();
      sessionRef.current = null;
      created.dispose();
      setSession(null);
    };
  }, [webgl, boot, scheduleSave, saveNow]);

  // Do not lose the last second or two of work when the tab is closed or hidden.
  useEffect(() => {
    const flush = () => saveNow();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [saveNow]);

  useLabHotkeys(session);

  const actions = useMemo<SessionActions>(
    () => ({
      storageAvailable: store.available,
      list: () => store.list(),
      create: () => {
        setBoot(freshBoot());
        setManagerOpen(false);
      },
      open: (id) => {
        const file = store.load(id);
        if (!file) return;
        setBoot({ id, name: file.name, seed: file.seed, file });
        setManagerOpen(false);
      },
      rename: (id, name) => {
        if (id === useLabStore.getState().sessionId) {
          useLabStore.setState({ sessionName: name });
          scheduleSave();
        } else {
          store.rename(id, name);
        }
      },
      duplicate: (id) => {
        if (id === useLabStore.getState().sessionId) saveNow();
        const source = store.load(id);
        if (!source) return;
        store.duplicate(
          id,
          newId(),
          t('lab.session.copyOf', { name: source.name }),
          new Date().toISOString(),
        );
      },
      remove: (id) => store.delete(id),
      exportCurrent: () => {
        const current = sessionRef.current;
        if (!current) return;
        const name = useLabStore.getState().sessionName;
        const blob = new Blob([serializeSession(current.toFile(name))], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = sessionFileName(name);
        link.click();
        URL.revokeObjectURL(url);
      },
      importFile: async (file) => {
        const result = parseSessionFile(await file.text());
        if (!result.ok) {
          return t(`lab.session.importErrors.${result.reason}`, { detail: result.detail });
        }
        setBoot({
          id: newId(),
          name: result.session.name,
          seed: result.session.seed,
          file: result.session,
        });
        setManagerOpen(false);
        return null;
      },
    }),
    [store, freshBoot, scheduleSave, saveNow, t],
  );

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
            // The bench does not need redrawing while the user is looking down the microscope.
            frameloop={microscopeOpen ? 'never' : 'always'}
            shadows={QUALITY[quality].shadows}
            dpr={[1, QUALITY[quality].maxDpr]}
            camera={{ position: BENCH_POSE.position, fov: 36, near: 5, far: 6000 }}
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
          <Hud onOpenSessions={() => setManagerOpen(true)} />
          {managerOpen && (
            <SessionManager actions={actions} onClose={() => setManagerOpen(false)} />
          )}
          {microscopeOpen && inspect?.species && (
            <MicroscopeView
              sample={{
                species: inspect.species,
                // The same spot on the same plate always gives the same slide.
                seed: deriveSeed(
                  session.seed,
                  `slide:${inspect.dishId}:${inspect.xMm}:${inspect.yMm}`,
                ),
              }}
              onClose={() => useLabStore.getState().setMicroscopeOpen(false)}
            />
          )}
        </SessionContext.Provider>
      )}
    </div>
  );
}
