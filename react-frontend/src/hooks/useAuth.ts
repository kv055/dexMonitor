import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'authed' | 'anon' | 'public';

export interface AuthContextValue {
  /**
   * 'loading' until the initial /api/auth/me resolves, then 'authed' or 'anon'.
   * 'public' in the public monitor deployment, which has no login at all.
   */
  status: AuthStatus;
  username: string | null;
  /** True only while zero accounts exist (first-run registration). */
  registrationAvailable: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
