import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsPage } from './AppSettingsPage';

const schema = {
  sections: [
    {
      id: 'edge',
      title: 'Public edge',
      description: 'Edge section',
      fields: [
        { key: 'PUBLIC_HOSTNAME', label: 'Public hostname', type: 'hostname', owner: 'nginx', required: true, restartServices: ['nginx'] },
        { key: 'SESSION_COOKIE_SECURE', label: 'Secure session cookies', type: 'bool', owner: 'dexmonitor / unified-api', default: 'true' },
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications',
      fields: [
        { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram bot token', type: 'secret', owner: 'mm-controller / fiat-controller' },
        { key: 'PAYMENT_EMAIL_MODE', label: 'Payment email mode', type: 'enum', owner: 'fiat-controller', enum: ['capture', 'shadow', 'active'], default: 'capture' },
      ],
    },
  ],
};

const values = {
  PUBLIC_HOSTNAME: 'dexmonitor.live',
  SESSION_COOKIE_SECURE: 'true',
  TELEGRAM_BOT_TOKEN: '***',
  PAYMENT_EMAIL_MODE: 'capture',
};

const mockRequest = vi.fn();

vi.mock('../api/client', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
  fetchResponse: vi.fn(),
  apiFetch: vi.fn(),
  apiPost: vi.fn(),
  apiPostWithHeaders: vi.fn(),
}));

describe('AppSettingsPage', () => {
  afterEach(() => {
    cleanup();
    mockRequest.mockReset();
  });

  it('renders sections and saves only dirty values', async () => {
    mockRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/app-settings' && !init) {
        return Promise.resolve({ writable: true, file: '/settings/root.env', schema, values });
      }
      if (path === '/api/app-settings' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ values: { PUBLIC_HOSTNAME: 'new.example.com' } });
        return Promise.resolve({ updated: ['PUBLIC_HOSTNAME'], restart: ['nginx'], values: { ...values, PUBLIC_HOSTNAME: 'new.example.com' } });
      }
      throw new Error(`unexpected request ${path}`);
    });

    render(<AppSettingsPage />);
    expect(await screen.findByText('Public edge')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();

    const hostInput = screen.getByLabelText('Public hostname') as HTMLInputElement;
    expect(hostInput.value).toBe('dexmonitor.live');

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton.hasAttribute('disabled')).toBe(true);

    await userEvent.clear(hostInput);
    await userEvent.type(hostInput, 'new.example.com');
    expect(screen.getByRole('button', { name: 'Save (1)' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Save (1)' }));
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/docker compose up -d nginx/)).toBeTruthy();
  });

  it('is read-only when the settings file is not mounted', async () => {
    mockRequest.mockResolvedValue({ writable: false, file: '', schema, values });

    render(<AppSettingsPage />);
    expect(await screen.findByText(/Read-only/)).toBeTruthy();
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton.hasAttribute('disabled')).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('filters fields by search text and service', async () => {
    mockRequest.mockResolvedValue({ writable: false, file: '', schema, values });

    render(<AppSettingsPage />);
    await screen.findByText('Public edge');
    expect(screen.getByText('4 of 4 shown')).toBeTruthy();

    // Search narrows to matching fields; empty sections drop out.
    const search = screen.getByLabelText('Search settings');
    await userEvent.type(search, 'telegram');
    expect(screen.getByText('Telegram bot token')).toBeTruthy();
    expect(screen.queryByText('Public hostname')).toBeNull();
    expect(screen.queryByText('Payment email mode')).toBeNull();
    expect(screen.getByText('1 of 4 shown')).toBeTruthy();
    await userEvent.clear(search);

    // Service filter matches every service listed in an owner string.
    await userEvent.selectOptions(screen.getByLabelText('Filter by service'), 'fiat-controller');
    expect(screen.getByText('Telegram bot token')).toBeTruthy();
    expect(screen.getByText('Payment email mode')).toBeTruthy();
    expect(screen.queryByText('Public hostname')).toBeNull();
    expect(screen.getByText('2 of 4 shown')).toBeTruthy();
  });
});
