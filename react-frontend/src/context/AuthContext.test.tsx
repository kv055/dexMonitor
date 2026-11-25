import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthContext';
import { useAuth } from '../hooks/useAuth';
import { authMe } from '../api/auth';

vi.mock('../api/auth', () => ({
  authMe: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn(),
  authRegister: vi.fn(),
  authRegistrationAvailable: vi.fn().mockResolvedValue({ available: false }),
}));

const mockedMe = vi.mocked(authMe);

function Status() {
  const { status } = useAuth();
  return <div data-testid="status">{status}</div>;
}

async function renderAuthed() {
  mockedMe.mockResolvedValueOnce({ username: 'alice' });
  render(<AuthProvider><Status /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authed'));
}

describe('AuthProvider auth:unauthorized handling', () => {
  beforeEach(() => {
    mockedMe.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('stays signed in when a stray 401 arrives but the session is still valid', async () => {
    await renderAuthed();
    mockedMe.mockResolvedValue({ username: 'alice' });

    await act(async () => {
      window.dispatchEvent(new Event('auth:unauthorized'));
      window.dispatchEvent(new Event('auth:unauthorized'));
    });

    await waitFor(() => expect(mockedMe).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('status').textContent).toBe('authed');
  });

  it('drops to the login page when the session is really gone', async () => {
    await renderAuthed();
    mockedMe.mockRejectedValue(new Error('unauthorized'));

    await act(async () => {
      window.dispatchEvent(new Event('auth:unauthorized'));
    });

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anon'));
  });
});
