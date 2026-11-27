import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthContext, type AuthStatus } from '../hooks/useAuth';
import {
  authLogin,
  authLogout,
  authMe,
  authRegister,
  authRegistrationAvailable,
} from '../api/auth';
import { isPublicEdition } from '../edition';

interface Props {
  children: ReactNode;
}

export function AuthProvider({ children }: Props) {
  // The public monitor has no users: skip /api/auth/* entirely and never drop
  // to the login page on a stray 401.
  const [publicEdition] = useState(isPublicEdition);
  const [status, setStatus] = useState<AuthStatus>(() => (publicEdition ? 'public' : 'loading'));
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
    if (publicEdition) return;
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
  }, [publicEdition, refreshRegistration]);

  // If a protected call 401s mid-session (cookie expired/cleared), drop to login.
  // A 401 can also come from one endpoint misbehaving (for example a backend
  // rejecting a service credential) while the session is still valid. So first
  // ask /api/auth/me, and only drop to login when the session itself is gone.
  // Several polls can 401 at once; they share one in-flight check.
  const sessionCheckRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (publicEdition) return;
    let disposed = false;
    const onUnauthorized = () => {
      if (sessionCheckRef.current) return;
      sessionCheckRef.current = (async () => {
        try {
          const me = await authMe();
          if (disposed) return;
          console.warn('auth: a request returned 401 but the session is still valid; staying signed in');
          setUsername(me.username);
        } catch {
          if (disposed) return;
          setStatus('anon');
          setUsername(null);
          void refreshRegistration();
        } finally {
          sessionCheckRef.current = null;
        }
      })();
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => {
      disposed = true;
      window.removeEventListener('auth:unauthorized', onUnauthorized);
    };
  }, [publicEdition, refreshRegistration]);

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
