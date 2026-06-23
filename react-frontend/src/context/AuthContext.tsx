import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext, type AuthStatus } from '../hooks/useAuth';
import {
  authLogin,
  authLogout,
  authMe,
  authRegister,
  authRegistrationAvailable,
} from '../utils/api';

interface Props {
  children: ReactNode;
}

export function AuthProvider({ children }: Props) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const [registrationAvailable, setRegistrationAvailable] = useState(false);

  // Whether first-run registration is still open — only relevant while anonymous.
  const refreshRegistration = useCallback(async () => {
    try {
      const { available } = await authRegistrationAvailable();
      setRegistrationAvailable(available);
    } catch {
      setRegistrationAvailable(false);
    }
  }, []);

  // On mount, ask "who am I?". A 401 (thrown by request()) means anonymous.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await authMe();
        if (cancelled) return;
        setUsername(me.username);
        setStatus('authed');
      } catch {
        if (cancelled) return;
        setUsername(null);
        setStatus('anon');
        void refreshRegistration();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshRegistration]);

  // If a protected call 401s mid-session (cookie expired/cleared), drop to login.
  useEffect(() => {
    const onUnauthorized = () => {
      setStatus('anon');
      setUsername(null);
      void refreshRegistration();
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, [refreshRegistration]);

  const login = useCallback(async (user: string, password: string) => {
    const me = await authLogin(user, password);
    setUsername(me.username);
    setStatus('authed');
  }, []);

  const register = useCallback(async (user: string, password: string) => {
    const me = await authRegister(user, password);
    setUsername(me.username);
    setStatus('authed');
    setRegistrationAvailable(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authLogout();
    } finally {
      setUsername(null);
      setStatus('anon');
      void refreshRegistration();
    }
  }, [refreshRegistration]);

  const value = useMemo(
    () => ({ status, username, registrationAvailable, login, register, logout }),
    [status, username, registrationAvailable, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
