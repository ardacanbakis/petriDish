import { useLabStore } from '../../state/labStore';
import { useSettingsStore } from '../../state/settingsStore';

/**
 * The control the Lab Assistant is pointing at gets a pulsing outline: call the
 * returned function with a control's name to get the extra classes for it.
 */
export function useAssistPoint(): (name: string) => string {
  const assistantEnabled = useSettingsStore((x) => x.assistantEnabled);
  const target = useLabStore((s) => (assistantEnabled ? s.advice?.next?.target : undefined));
  return (name: string) => (target === name ? ' ring-2 ring-amber-300 animate-pulse' : '');
}
