import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsPage } from './AppSettingsPage';
import { appSettingDescriptions } from '../utils/appSettingDescriptions';

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
  PUBLIC_HOSTNAME: 'dex.example.com',
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
        return Promise.resolve({ writableFile: true, db: true, file: '/settings/root.env', fileKeys: [], schema, values });
      }
      if (path === '/api/app-settings' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ values: { PUBLIC_HOSTNAME: 'new.example.com' } });
        return Promise.resolve({ updated: ['PUBLIC_HOSTNAME'], restart: ['nginx'], fileSynced: true, values: { ...values, PUBLIC_HOSTNAME: 'new.example.com' } });
      }
      throw new Error(`unexpected request ${path}`);
    });

    render(<AppSettingsPage />);
    expect(await screen.findByText('Public edge')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();

    const hostInput = screen.getByLabelText('Public hostname') as HTMLInputElement;
    expect(hostInput.value).toBe('dex.example.com');

    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton.hasAttribute('disabled')).toBe(true);

    await userEvent.clear(hostInput);
    await userEvent.type(hostInput, 'new.example.com');
    expect(screen.getByRole('button', { name: 'Save (1)' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Save (1)' }));
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/docker compose up -d nginx/)).toBeTruthy();
  });

  it('locks file-backed fields but keeps db-backed fields editable without a mount', async () => {
    mockRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/app-settings' && !init) {
        return Promise.resolve({ writableFile: false, db: true, file: '', fileKeys: ['PUBLIC_HOSTNAME'], schema, values });
      }
      if (path === '/api/app-settings' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ values: { PAYMENT_EMAIL_MODE: 'shadow' } });
        return Promise.resolve({ updated: ['PAYMENT_EMAIL_MODE'], restart: ['fiat-controller'], fileSynced: false, values: { ...values, PAYMENT_EMAIL_MODE: 'shadow' } });
      }
      throw new Error(`unexpected request ${path}`);
    });

    render(<AppSettingsPage />);
    expect(await screen.findByText(/File-backed settings are read-only/)).toBeTruthy();

    // File-backed input is locked …
    const hostInput = screen.getByLabelText('Public hostname') as HTMLInputElement;
    expect(hostInput.hasAttribute('disabled')).toBe(true);

    // … and only file-backed fields carry the deploy-overwrite warning.
    const warnings = screen.getAllByText(/new version push overwrites/);
    expect(warnings).toHaveLength(1);

    // … but db-backed inputs stay editable and save without the mount.
    const modeSelect = screen.getByLabelText('Payment email mode') as HTMLSelectElement;
    expect(modeSelect.hasAttribute('disabled')).toBe(false);
    await userEvent.selectOptions(modeSelect, 'shadow');
    await userEvent.click(screen.getByRole('button', { name: 'Save (1)' }));
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/not updated.*not mounted/)).toBeTruthy();
  });

  it('filters fields by search text and service', async () => {
    mockRequest.mockResolvedValue({ writableFile: false, db: true, file: '', fileKeys: [], schema, values });

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

  it('shows the field info tooltip on hover and closes it on pointer-out or outside click', async () => {
    mockRequest.mockResolvedValue({ writableFile: true, db: true, file: '/settings/root.env', fileKeys: [], schema, values });

    render(<AppSettingsPage />);
    await screen.findByText('Public edge');

    const icon = screen.getByRole('button', { name: 'Info about Public hostname' });
    const description = appSettingDescriptions.PUBLIC_HOSTNAME;

    expect(screen.queryByRole('tooltip')).toBeNull();

    // Hovering the info icon opens the tooltip with the field's description.
    await userEvent.hover(icon);
    expect(screen.getByRole('tooltip')?.textContent).toBe(description);

    // Moving the pointer away closes it again.
    await userEvent.unhover(icon);
    expect(screen.queryByRole('tooltip')).toBeNull();

    // Clicking opens (pins) the tooltip …
    await userEvent.click(icon);
    expect(screen.getByRole('tooltip')?.textContent).toBe(description);

    // … and a click anywhere outside closes it.
    await userEvent.click(screen.getByLabelText('Search settings'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

