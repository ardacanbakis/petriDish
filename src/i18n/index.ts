import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import tr from './tr.json';
import { useSettingsStore } from '../state/settingsStore';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
  },
  lng: useSettingsStore.getState().language,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

function applyLanguage(lng: string) {
  if (i18n.language !== lng) void i18n.changeLanguage(lng);
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}

// The settings store is the single source of truth for the language.
applyLanguage(useSettingsStore.getState().language);
useSettingsStore.subscribe((state) => applyLanguage(state.language));

export default i18n;
