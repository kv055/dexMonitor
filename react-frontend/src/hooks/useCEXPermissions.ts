import { createContext, useContext } from 'react';

export type CEXPermissionStatus = 'granted' | 'unknown' | 'denied' | 'unsupported';

export interface CEXAvailability {
  available: boolean;
  blocking_permissions: string[];
  reason?: string;
}

export interface CEXPermissionExchange {
  account_id: number;
  provider: string;
  exchange: string;
  optimizer_supported: boolean;
  active_key_count: number;
  permissions_checked_at: string | null;
  permissions: Record<string, CEXPermissionStatus>;
  spot: CEXAvailability;
  hedge: CEXAvailability;
}

export interface CEXPermissionsContextValue {
  exchanges: CEXPermissionExchange[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  lockedSpotCEXes: string[];
  lockedHedgeCEXes: string[];
  reload: () => void;
}

export const CEXPermissionsContext = createContext<CEXPermissionsContextValue | null>(null);

export function useCEXPermissions(): CEXPermissionsContextValue {
  const value = useContext(CEXPermissionsContext);
  if (!value) throw new Error('useCEXPermissions must be used inside <CEXPermissionsProvider>');
  return value;
}
