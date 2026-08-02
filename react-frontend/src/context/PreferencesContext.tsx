import { useEffect, useLayoutEffect, useMemo, useReducer, type ReactNode } from 'react';
import { PreferencesContext, type PreferencesState, type ThemeMode } from '../hooks/usePreferences';
import { readStoredBoolean, readStoredNullableNumber, readStoredString, readStoredStringArray, writeStoredValue } from '../shared/storage';

type Action =
  | { type: 'SET_TIMEZONE'; timezone: string }
  | { type: 'TOGGLE_THEME' }
  | { type: 'TOGGLE_METHOD'; method: string }
  | { type: 'TOGGLE_GROUP'; methods: string[]; exclude: boolean }
  | { type: 'SET_FEE_TIER'; tier: string }
  | { type: 'SET_COUPLED_HEDGE'; coupled: boolean }
  | { type: 'SET_MAX_FIAT_LIMIT'; limit: number | null }
  | { type: 'SET_HIDE_ZERO_TRUST_SCORE'; hide: boolean };

interface Props {
  children: ReactNode;
}

function normalizePaymentMethodList(methods: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of methods) {
    for (const part of raw.split(',')) {
      const method = part.trim();
      if (!method || seen.has(method)) continue;
      seen.add(method);
      result.push(method);
    }
  }
  return result;
}

function getInitialTheme(): ThemeMode {
  const stored = readStoredString('dex-theme');
  return stored === 'light' ? 'light' : 'dark';
}

function getInitialState(): PreferencesState {
  return {
    theme: getInitialTheme(),
    preferredTimezone: readStoredString('dex-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    excludedMethods: normalizePaymentMethodList(readStoredStringArray('dex-excluded-payment-methods')),
    feeTier: readStoredString('dex-fee-tier'),
    coupledHedge: readStoredBoolean('dex-coupled-hedge', true),
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
    case 'SET_FEE_TIER':
      return { ...state, feeTier: action.tier };
    case 'SET_COUPLED_HEDGE':
      return { ...state, coupledHedge: action.coupled };
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
    writeStoredValue('dex-excluded-payment-methods', state.excludedMethods);
    writeStoredValue('dex-fee-tier', state.feeTier);
    writeStoredValue('dex-coupled-hedge', state.coupledHedge);
    writeStoredValue('dex-max-fiat-limit', state.maxFiatLimit);
    writeStoredValue('dex-hide-zero-trust-score', state.hideZeroTrustScore);
  }, [state]);

  const value = useMemo(() => ({
    ...state,
    setPreferredTimezone: (timezone: string) => dispatch({ type: 'SET_TIMEZONE', timezone }),
    toggleTheme: () => dispatch({ type: 'TOGGLE_THEME' }),
    toggleMethod: (method: string) => dispatch({ type: 'TOGGLE_METHOD', method }),
    toggleGroup: (methods: string[], exclude: boolean) => dispatch({ type: 'TOGGLE_GROUP', methods, exclude }),
    setFeeTier: (tier: string) => dispatch({ type: 'SET_FEE_TIER', tier }),
    setCoupledHedge: (coupled: boolean) => dispatch({ type: 'SET_COUPLED_HEDGE', coupled }),
    setMaxFiatLimit: (limit: number | null) => dispatch({ type: 'SET_MAX_FIAT_LIMIT', limit }),
    setHideZeroTrustScore: (hide: boolean) => dispatch({ type: 'SET_HIDE_ZERO_TRUST_SCORE', hide }),
  }), [state]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}
