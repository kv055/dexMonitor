import { createContext, useContext } from 'react';

export type ThemeMode = 'dark' | 'light';

export interface PreferencesState {
  theme: ThemeMode;
  preferredTimezone: string;
  excludedMethods: string[];
  maxFiatLimit: number | null;
  hideZeroTrustScore: boolean;
}

export interface PreferencesContextValue extends PreferencesState {
  setPreferredTimezone: (timezone: string) => void;
  toggleTheme: () => void;
  toggleMethod: (method: string) => void;
  toggleGroup: (groupMethods: string[], exclude: boolean) => void;
  setMaxFiatLimit: (limit: number | null) => void;
  setHideZeroTrustScore: (hide: boolean) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}
