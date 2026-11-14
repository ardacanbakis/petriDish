import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const LANGUAGES = ['en', 'tr'] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEMES = ['photoreal', 'stylized', 'bioluminescent'] as const;
export type ThemeId = (typeof THEMES)[number];

export const QUALITY_PRESETS = ['low', 'medium', 'high'] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];

export interface SettingsState {
  language: Language;
  theme: ThemeId;
  quality: QualityPreset;
  /** Ambient temperature for dishes left on the bench, in °C. */
  roomTemperatureC: number;
  assistantEnabled: boolean;
  /** Ids of challenges the user has completed. */
  completedChallenges: string[];
  setLanguage: (language: Language) => void;
  setTheme: (theme: ThemeId) => void;
  setQuality: (quality: QualityPreset) => void;
  setRoomTemperatureC: (t: number) => void;
  setAssistantEnabled: (enabled: boolean) => void;
  markChallengeComplete: (id: string) => void;
}

function detectLanguage(): Language {
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('tr')) {
    return 'tr';
  }
  return 'en';
}

/** localStorage can throw (private mode, quota); fall back to a no-op store instead of crashing. */
const safeStorage = createJSONStorage(() => {
  try {
    const probe = '__agar_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    };
  }
});

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: detectLanguage(),
      theme: 'photoreal',
      quality: 'medium',
      roomTemperatureC: 22,
      assistantEnabled: true,
      completedChallenges: [],
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      setQuality: (quality) => set({ quality }),
      setRoomTemperatureC: (roomTemperatureC) => set({ roomTemperatureC }),
      setAssistantEnabled: (assistantEnabled) => set({ assistantEnabled }),
      markChallengeComplete: (id) =>
        set((s) =>
          s.completedChallenges.includes(id)
            ? {}
            : { completedChallenges: [...s.completedChallenges, id] },
        ),
    }),
    { name: 'agar:settings', version: 1, storage: safeStorage },
  ),
);
