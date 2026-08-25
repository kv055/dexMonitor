import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchTradingAccounts: vi.fn(),
  fetchPaymentMethods: vi.fn(),
  fetchPaymentMethodChatTemplates: vi.fn(),
  updatePaymentMethodChatTemplate: vi.fn(),
}));

vi.mock('../utils/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/api')>();
  return { ...actual, ...mocks };
});

vi.mock('../components/TelegramBotSection', () => ({ TelegramBotSection: () => null }));
vi.mock('../components/PhonePushSetupSection', () => ({ PhonePushSetupSection: () => null }));

import { FiltersProvider } from '../context/FiltersContext';
import { TradingAccountsPanel } from './TradingAccountsPanel';

const accounts = [
  { id: 1, provider: 'Robosats', category: 'DEX' },
  { id: 2, provider: 'Bisq2', category: 'DEX' },
].map(account => ({
  ...account,
  payment_priority: 0,
  is_active: true,
  notification_channels: null,
  email: null,
  password: null,
  phone: null,
  payment_tag: null,
  is_healthy: true,
  last_health_check: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  totp_secrets: [], passkey_credentials: [], seeds: [], api_keys: [],
  account_file_backup: null, lnd_channel_backup: null, bank_accounts: [],
}));

const paymentMethods = [
  { id: 10, name: 'PayPal', is_active: true },
  { id: 11, name: 'Revolut', is_active: false },
].map(method => ({
  ...method, merge_regex: null, alias_list: [], sources: [], currencies: [], category: 'Fiat Transmitter',
  account_id: null, is_linked: false, priority: 0, match_order: 0, popularity: 0, link_label: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}));

function templatesFor(methodID: number) {
  return ['robosats', 'bisq2'].map((exchange, index) => ({
    id: methodID * 10 + index, exchange, trade_direction: 'bid' as const, payment_method_id: methodID,
    template: `${exchange} template`, is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }));
}

function renderPanel() {
  return render(
    <FiltersProvider offers={[]} loading={false} groups={[]} hideZeroTrustScore={false}>
      <TradingAccountsPanel />
    </FiltersProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('TradingAccountsPanel chat templates', () => {
  it('matches canonical stored exchanges for both chat providers, including inactive methods', async () => {
    mocks.fetchTradingAccounts.mockResolvedValue(accounts);
    mocks.fetchPaymentMethods.mockResolvedValue({ payment_methods: paymentMethods });
    mocks.fetchPaymentMethodChatTemplates.mockImplementation((id: number) => Promise.resolve({ chat_templates: templatesFor(id) }));
    mocks.updatePaymentMethodChatTemplate.mockImplementation((id: number) => Promise.resolve({ chat_templates: templatesFor(id) }));

    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: /Trading/ }));
    await user.click(await screen.findByTestId('account-summary-card-1'));
    await user.click(screen.getAllByTestId('account-detail-tab-methods')[0]);
    await user.click(screen.getAllByRole('button', { name: /Chat payment methods/ })[0]);

    expect((await screen.findAllByText('PayPal')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revolut').length).toBeGreaterThan(0);
    expect(screen.getAllByText('template active').length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    expect(screen.getAllByText('robosats template').length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'Edit BID template' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Save template' })[0]);
    await waitFor(() => expect(mocks.updatePaymentMethodChatTemplate).toHaveBeenCalledWith(10, 'robosats', expect.anything()));

    await user.click(screen.getByTestId('account-summary-card-2'));
    await user.click(screen.getAllByTestId('account-detail-tab-methods')[0]);
    await user.click((await screen.findAllByRole('button', { name: /Chat payment methods/ }))[0]);
    await waitFor(() => expect(screen.getAllByText('template active').length).toBeGreaterThan(0));
    expect(mocks.fetchPaymentMethodChatTemplates).toHaveBeenCalledWith(11);
  });
});
