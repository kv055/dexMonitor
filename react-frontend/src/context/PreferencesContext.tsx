import { useEffect, useLayoutEffect, useMemo, useReducer, type ReactNode } from 'react';
import { PreferencesContext, type PreferencesState, type ThemeMode } from '../hooks/usePreferences';
import { readStoredBoolean, readStoredNullableNumber, readStoredString, writeStoredValue } from '../shared/storage';

type Action =
  | { type: 'SET_TIMEZONE'; timezone: string }
  | { type: 'TOGGLE_THEME' }
  | { type: 'SET_MAX_FIAT_LIMIT'; limit: number | null }
  | { type: 'SET_HIDE_ZERO_TRUST_SCORE'; hide: boolean };

interface Props {
  children: ReactNode;
}

function getInitialTheme(): ThemeMode {
  const stored = readStoredString('dex-theme');
  return stored === 'light' ? 'light' : 'dark';
}

function getInitialState(): PreferencesState {
  return {
    theme: getInitialTheme(),
    preferredTimezone: readStoredString('dex-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    maxFiatLimit: readStoredNullableNumber('dex-max-fiat-limit'),
    hideZeroTrustScore: readStoredBoolean('dex-hide-zero-trust-score', false),
  };
}

function preferencesReducer(state: PreferencesState, action: Action): PreferencesState {
  switch (action.type) {
    case 'SET_TIMEZONE':
      return { ...state, preferredTimezone: action.timezone };
    case 'TOGGLE_THEME':
      return { ...state, theme: state.theme === 'dark' ? 'light' : 'dark' };
    case 'SET_MAX_FIAT_LIMIT':
      return { ...state, maxFiatLimit: action.limit };
    case 'SET_HIDE_ZERO_TRUST_SCORE':
      return { ...state, hideZeroTrustScore: action.hide };
  }
}

export function PreferencesProvider({ children }: Props) {
  const [state, dispatch] = useReducer(preferencesReducer, undefined, getInitialState);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
    writeStoredValue('dex-theme', state.theme);
  }, [state.theme]);

  useEffect(() => {
    writeStoredValue('dex-timezone', state.preferredTimezone);
    writeStoredValue('dex-max-fiat-limit', state.maxFiatLimit);
    writeStoredValue('dex-hide-zero-trust-score', state.hideZeroTrustScore);
  }, [state]);

  const value = useMemo(() => ({
    ...state,
    setPreferredTimezone: (timezone: string) => dispatch({ type: 'SET_TIMEZONE', timezone }),
    toggleTheme: () => dispatch({ type: 'TOGGLE_THEME' }),
    setMaxFiatLimit: (limit: number | null) => dispatch({ type: 'SET_MAX_FIAT_LIMIT', limit }),
    setHideZeroTrustScore: (hide: boolean) => dispatch({ type: 'SET_HIDE_ZERO_TRUST_SCORE', hide }),
  }), [state]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}
