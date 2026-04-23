import { useLayoutEffect, useMemo, useReducer, type ReactNode } from 'react';
import { PreferencesContext, type PreferencesState, type ThemeMode } from '../hooks/usePreferences';

type Action =
  | { type: 'SET_TIMEZONE'; timezone: string }
  | { type: 'TOGGLE_THEME' }
  | { type: 'TOGGLE_METHOD'; method: string }
  | { type: 'TOGGLE_GROUP'; methods: string[]; exclude: boolean }
  | { type: 'TOGGLE_CEX'; cex: string }
  | { type: 'SET_FEE_TIER'; tier: string }
  | { type: 'SET_COUPLED_HEDGE'; coupled: boolean }
  | { type: 'SET_MAX_FIAT_LIMIT'; limit: number | null };

interface Props {
  children: ReactNode;
}

function readJsonArray(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem('dex-theme');
  return stored === 'light' ? 'light' : 'dark';
}

function getInitialState(): PreferencesState {
  const maxFiat = localStorage.getItem('dex-max-fiat-limit');
  return {
    theme: getInitialTheme(),
    preferredTimezone: localStorage.getItem('dex-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    excludedMethods: readJsonArray('dex-excluded-payment-methods'),
    excludedCEXes: readJsonArray('dex-excluded-cexes'),
    feeTier: localStorage.getItem('dex-fee-tier') || '',
    coupledHedge: localStorage.getItem('dex-coupled-hedge') !== 'false',
    maxFiatLimit: maxFiat ? Number(maxFiat) : null,
  };
}

function preferencesReducer(state: PreferencesState, action: Action): PreferencesState {
  switch (action.type) {
    case 'SET_TIMEZONE':
      return { ...state, preferredTimezone: action.timezone };
    case 'TOGGLE_THEME':
      return { ...state, theme: state.theme === 'dark' ? 'light' : 'dark' };
    case 'TOGGLE_METHOD':
      return {
        ...state,
        excludedMethods: state.excludedMethods.includes(action.method)
          ? state.excludedMethods.filter(method => method !== action.method)
          : [...state.excludedMethods, action.method],
      };
    case 'TOGGLE_GROUP': {
      const withoutGroup = state.excludedMethods.filter(method => !action.methods.includes(method));
      return {
        ...state,
        excludedMethods: action.exclude ? [...withoutGroup, ...action.methods] : withoutGroup,
      };
    }
    case 'TOGGLE_CEX':
      return {
        ...state,
        excludedCEXes: state.excludedCEXes.includes(action.cex)
          ? state.excludedCEXes.filter(cex => cex !== action.cex)
          : [...state.excludedCEXes, action.cex],
      };
    case 'SET_FEE_TIER':
      return { ...state, feeTier: action.tier };
    case 'SET_COUPLED_HEDGE':
      return { ...state, coupledHedge: action.coupled };
    case 'SET_MAX_FIAT_LIMIT':
      return { ...state, maxFiatLimit: action.limit };
  }
}

export function PreferencesProvider({ children }: Props) {
  const [state, dispatch] = useReducer(preferencesReducer, undefined, getInitialState);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('dex-theme', state.theme);
  }, [state.theme]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-timezone', state.preferredTimezone);
  }, [state.preferredTimezone]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-excluded-payment-methods', JSON.stringify(state.excludedMethods));
  }, [state.excludedMethods]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-excluded-cexes', JSON.stringify(state.excludedCEXes));
  }, [state.excludedCEXes]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-fee-tier', state.feeTier);
  }, [state.feeTier]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-coupled-hedge', String(state.coupledHedge));
  }, [state.coupledHedge]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-max-fiat-limit', state.maxFiatLimit != null ? String(state.maxFiatLimit) : '');
  }, [state.maxFiatLimit]);

  const value = useMemo(() => ({
    ...state,
    setPreferredTimezone: (timezone: string) => dispatch({ type: 'SET_TIMEZONE', timezone }),
    toggleTheme: () => dispatch({ type: 'TOGGLE_THEME' }),
    toggleMethod: (method: string) => dispatch({ type: 'TOGGLE_METHOD', method }),
    toggleGroup: (methods: string[], exclude: boolean) => dispatch({ type: 'TOGGLE_GROUP', methods, exclude }),
    toggleCEX: (cex: string) => dispatch({ type: 'TOGGLE_CEX', cex }),
    setFeeTier: (tier: string) => dispatch({ type: 'SET_FEE_TIER', tier }),
    setCoupledHedge: (coupled: boolean) => dispatch({ type: 'SET_COUPLED_HEDGE', coupled }),
    setMaxFiatLimit: (limit: number | null) => dispatch({ type: 'SET_MAX_FIAT_LIMIT', limit }),
  }), [state]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}
