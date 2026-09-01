import { createContext, useContext } from 'react';

export interface CEXCapabilityBlocker {
  code: string;
  permissions?: string[];
  message: string;
}

export interface CEXAvailability {
  supported: boolean;
  policy_enabled: boolean;
  available: boolean;
  effective_enabled: boolean;
  blocking_permissions: string[];
  blockers: CEXCapabilityBlocker[];
}

export interface CEXPolicy {
  spot_enabled: boolean;
  hedge_enabled: boolean;
  updated_at?: string;
}

export interface CEXPermissionExchange {
  account_id: number;
  provider: string;
  exchange: string;
  cost_supported: boolean;
  execution_supported: boolean;
  active_key_count: number;
  permissions_checked_at?: string | null;
  fee_snapshot?: {
    spot_taker_fee_percent?: number | null;
    withdrawal_fee_btc?: number | null;
    futures_open_taker_fee_percent?: number | null;
    futures_close_taker_fee_percent?: number | null;
    futures_funding_fee_percent?: number | null;
    futures_funding_interval_seconds?: number | null;
    spot_available: boolean;
	ask_available?: boolean;
	bid_available?: boolean;
    hedge_available: boolean;
    stale: boolean;
    fetched_at?: string | null;
    last_attempted_at?: string | null;
    last_error?: string;
	spot?: CEXFeeComponentStatus;
	withdrawal?: CEXFeeComponentStatus;
	hedge?: CEXFeeComponentStatus;
  };
  policy: CEXPolicy;
  spot: CEXAvailability;
  hedge: CEXAvailability;
}

export interface CEXFeeComponentStatus {
  available: boolean;
  stale: boolean;
  fetched_at?: string | null;
  last_attempted_at?: string | null;
  last_error?: string;
  source?: string;
  observed_fee_btc?: number | null;
  observed_at?: string | null;
}

export interface CEXPermissionsContextValue {
  exchanges: CEXPermissionExchange[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  revision: number;
  updating: string | null;
  updatePolicy: (exchange: string, policy: CEXPolicy) => Promise<void>;
  reload: () => void;
}

export const CEXPermissionsContext = createContext<CEXPermissionsContextValue | null>(null);

export function useCEXPermissions(): CEXPermissionsContextValue {
  const value = useContext(CEXPermissionsContext);
  if (!value) throw new Error('useCEXPermissions must be used inside <CEXPermissionsProvider>');
  return value;
}

export function useOptionalCEXPermissions(): CEXPermissionsContextValue | null {
  return useContext(CEXPermissionsContext);
}
