import { useState, type FormEvent } from 'react';
import { usePreferences } from '../hooks/usePreferences';
import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const { theme } = usePreferences();
  const { registrationAvailable, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Registration is only ever offered while it is available (first user).
  const isRegister = mode === 'register' && registrationAvailable;

  const markSrc = theme === 'dark' ? '/brand/mark-dark.svg' : '/brand/mark-light.svg';
  const wordmarkSrc = theme === 'dark' ? '/brand/wordmark-dark.svg' : '/brand/wordmark-light.svg';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isRegister) {
        await register(username, password);
      } else {
        await login(username, password);
      }
      // On success the AuthProvider flips status → the dashboard mounts and
      // unmounts this page; no need to reset local state.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  const inputClass =
    'bg-bg border border-border rounded-md px-3 py-2 text-sm text-text normal-case tracking-normal focus:outline-none focus:border-accent';

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg text-text p-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-lg p-6 sm:p-8 flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <img src={markSrc} alt="" aria-hidden className="h-16 w-auto" />
          <img src={wordmarkSrc} alt="dexArbPendulum" className="h-6 w-auto" />
        </div>

        <form onSubmit={onSubmit} className="w-full flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[0.7rem] uppercase tracking-widest text-muted">
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-[0.7rem] uppercase tracking-widest text-muted">
            Password
            <input
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className={inputClass}
            />
          </label>

          {error && <p className="text-red text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 bg-accent text-black font-semibold rounded-md px-3 py-2 text-sm cursor-pointer disabled:opacity-50 hover:opacity-90"
          >
            {submitting ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
          </button>
        </form>

        {registrationAvailable && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode(m => (m === 'login' ? 'register' : 'login'));
            }}
            className="text-xs text-muted hover:text-text cursor-pointer bg-transparent border-none"
          >
            {isRegister ? 'Have an account? Log in' : 'First time? Create the admin account'}
          </button>
        )}
      </div>
    </div>
  );
}
