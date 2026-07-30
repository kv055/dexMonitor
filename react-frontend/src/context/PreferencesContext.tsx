import { useLayoutEffect, useMemo, useReducer, type ReactNode } from 'react';
import { PreferencesContext, type PreferencesState, type ThemeMode } from '../hooks/usePreferences';

type Action =
  | { type: 'SET_TIMEZONE'; timezone: string }
  | { type: 'TOGGLE_THEME' }
  | { type: 'TOGGLE_METHOD'; method: string }
  | { type: 'TOGGLE_GROUP'; methods: string[]; exclude: boolean }
  | { type: 'TOGGLE_SPOT_CEX'; cex: string }
  | { type: 'TOGGLE_HEDGE_CEX'; cex: string }
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

function readJsonArray(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    const strings = parsed.filter((item): item is string => typeof item === 'string');
    return key === 'dex-excluded-payment-methods' ? normalizePaymentMethodList(strings) : strings;
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
  const legacyCEXes = readJsonArray('dex-excluded-cexes');
  const storedSpotCEXes = localStorage.getItem('dex-excluded-spot-cexes');
  const storedHedgeCEXes = localStorage.getItem('dex-excluded-hedge-cexes');
  return {
    theme: getInitialTheme(),
    preferredTimezone: localStorage.getItem('dex-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    excludedMethods: readJsonArray('dex-excluded-payment-methods'),
    excludedSpotCEXes: storedSpotCEXes == null ? legacyCEXes : readJsonArray('dex-excluded-spot-cexes'),
    excludedHedgeCEXes: storedHedgeCEXes == null ? legacyCEXes : readJsonArray('dex-excluded-hedge-cexes'),
    feeTier: localStorage.getItem('dex-fee-tier') || '',
    coupledHedge: localStorage.getItem('dex-coupled-hedge') !== 'false',
    maxFiatLimit: maxFiat ? Number(maxFiat) : null,
    hideZeroTrustScore: localStorage.getItem('dex-hide-zero-trust-score') === 'true',
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
    case 'TOGGLE_SPOT_CEX':
      return {
        ...state,
        excludedSpotCEXes: state.excludedSpotCEXes.includes(action.cex)
          ? state.excludedSpotCEXes.filter(cex => cex !== action.cex)
          : [...state.excludedSpotCEXes, action.cex],
      };
    case 'TOGGLE_HEDGE_CEX':
      return {
        ...state,
        excludedHedgeCEXes: state.excludedHedgeCEXes.includes(action.cex)
          ? state.excludedHedgeCEXes.filter(cex => cex !== action.cex)
          : [...state.excludedHedgeCEXes, action.cex],
      };
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
    localStorage.setItem('dex-theme', state.theme);
  }, [state.theme]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-timezone', state.preferredTimezone);
  }, [state.preferredTimezone]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-excluded-payment-methods', JSON.stringify(state.excludedMethods));
  }, [state.excludedMethods]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-excluded-spot-cexes', JSON.stringify(state.excludedSpotCEXes));
  }, [state.excludedSpotCEXes]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-excluded-hedge-cexes', JSON.stringify(state.excludedHedgeCEXes));
  }, [state.excludedHedgeCEXes]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-fee-tier', state.feeTier);
  }, [state.feeTier]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-coupled-hedge', String(state.coupledHedge));
  }, [state.coupledHedge]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-max-fiat-limit', state.maxFiatLimit != null ? String(state.maxFiatLimit) : '');
  }, [state.maxFiatLimit]);

  useLayoutEffect(() => {
    localStorage.setItem('dex-hide-zero-trust-score', String(state.hideZeroTrustScore));
  }, [state.hideZeroTrustScore]);

  const value = useMemo(() => ({
    ...state,
    setPreferredTimezone: (timezone: string) => dispatch({ type: 'SET_TIMEZONE', timezone }),
    toggleTheme: () => dispatch({ type: 'TOGGLE_THEME' }),
    toggleMethod: (method: string) => dispatch({ type: 'TOGGLE_METHOD', method }),
    toggleGroup: (methods: string[], exclude: boolean) => dispatch({ type: 'TOGGLE_GROUP', methods, exclude }),
    toggleSpotCEX: (cex: string) => dispatch({ type: 'TOGGLE_SPOT_CEX', cex }),
    toggleHedgeCEX: (cex: string) => dispatch({ type: 'TOGGLE_HEDGE_CEX', cex }),
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
