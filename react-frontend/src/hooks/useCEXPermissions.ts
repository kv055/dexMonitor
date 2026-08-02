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
  policy: CEXPolicy;
  spot: CEXAvailability;
  hedge: CEXAvailability;
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
