import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type DragEvent, type ReactNode, type SetStateAction } from 'react';
import { TelegramBotSection } from './TelegramBotSection';
import { PhonePushSetupSection } from './PhonePushSetupSection';
import {
  createAccount,
  createAPIKey,
  closeLNDChannel,
  createLNDWalletAddress,
  createPasskey,
  createSeed,
  createBankAccount,
  createTOTPSecret,
  deleteAccount,
  deleteAPIKey,
  deleteBankAccount,
  deletePasskey,
  deleteSeed,
  deleteTOTPSecret,
  downloadBisqAccountFile,
  fetchCexBalances,
  fetchCexDepositAddresses,
  fetchCexHedgePositions,
  fetchCexSpotTrades,
  fetchCexWithdrawalAddresses,
  fetchLNDWalletState,
  fetchLNDWalletStatus,
  fetchServiceVersions,
  fetchTradingAccounts,
  revealTradingAccountCredentials,
  revealTradingAccountSecrets,
  fetchBisqPaymentAccounts,
  fetchBisqPaymentMethods,
  fetchBisqPaymentAccountForm,
  fetchPaymentMethods,
  createBisqPaymentAccount,
  deletePaymentMethodChatTemplate,
  deleteBisqPaymentAccount,
  fetchPaymentMethodChatTemplates,
  initLNDWallet,
  openLNDChannel,
  runAccountHealthCheck,
  updateAccount,
  updateAPIKey,
  updateBankAccount,
  updatePaymentMethodChatTemplate,
  reorderPaymentAccounts,
  updatePasskey,
  updateSeed,
  updateTOTPSecret,
} from '../utils/api';
import { emailFormatError, ibanFormatError } from '../utils/validators';
import type {
  CexBalancesResponse,
  CexDepositAddress,
  CexHedgePosition,
  CexHedgePositionsResponse,
  CexSpotTrade,
  CexWithdrawalAddress,
  LNDWalletState,
  LNDWalletStatus,
  ServiceVersions,
  TradingAccount,
  TradingAccountCredentialReveal,
  TradingAccountKeyPermissionResult,
  TradingBankAccount,
  BisqPaymentAccount,
  BisqPaymentMethod,
  BisqPaymentAccountForm,
  PaymentMethodRow,
  PaymentMethodChatTemplate,
} from '../types';
import { useFilters } from '../hooks/useFilters';

type ProviderOption = { value: string; label: string };

type ProviderDefinition = {
  value: string;
  label: string;
  category: string;
  creatable: boolean;
};

const LND_WALLET_PROVIDER = 'LND wallet';

const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  { value: 'PayPal', label: 'PayPal', category: 'Fiat Transmitter', creatable: true },
  { value: 'Revolut', label: 'Revolut', category: 'Fiat Transmitter', creatable: true },
  { value: 'WISE', label: 'WISE', category: 'Fiat Transmitter', creatable: true },
  { value: 'N26', label: 'N26', category: 'Fiat Transmitter', creatable: true },
  { value: 'HodlHodl', label: 'HodlHodl', category: 'DEX', creatable: true },
  { value: 'Bisq', label: 'Bisq', category: 'DEX', creatable: false },
  { value: 'Bisq2', label: 'Bisq2', category: 'DEX', creatable: false },
  { value: 'Robosats', label: 'RoboSats', category: 'DEX', creatable: true },
  { value: 'Peach', label: 'Peach Bitcoin', category: 'DEX', creatable: true },
  { value: 'Kraken', label: 'Kraken', category: 'CEX', creatable: true },
  { value: 'Coinbase', label: 'Coinbase', category: 'CEX', creatable: true },
  { value: 'Binance', label: 'Binance', category: 'CEX', creatable: true },
  { value: LND_WALLET_PROVIDER, label: 'LND wallet', category: 'Internal Infrastructure', creatable: false },
];

const CREATABLE_PROVIDER_CATEGORIES = ['Fiat Transmitter', 'DEX', 'CEX', 'Bank', 'Wallet addresses'] as const;

const PAYMENT_CATEGORIES = ['Fiat Transmitter', 'Bank', 'Wallet addresses'] as const;
const TRADING_CATEGORIES = ['DEX', 'CEX', 'Internal Infrastructure', 'Uncategorized'] as const;
const TAB_STORAGE_KEY = 'tradingAccounts.activeTab';

function isPaymentCategory(category: string): boolean {
  return (PAYMENT_CATEGORIES as readonly string[]).includes(category);
}

const CATEGORY_ORDER = ['Fiat Transmitter', 'Bank', 'Wallet addresses', 'DEX', 'CEX', 'Internal Infrastructure', 'Uncategorized'];

const inputCls =
  'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent';
const textareaCls =
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent min-h-16';
const compactInputCls =
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent';
const buttonCls =
  'rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-text transition hover:bg-surface';
const compactButtonCls =
  'rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-text transition hover:bg-surface';
const compactPrimaryButtonCls =
  'rounded-md border border-accent bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/20';
const primaryButtonCls =
  'rounded-md border border-accent bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatAccountHeaderDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function providerLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = PROVIDER_DEFINITIONS.find(option => option.value.toLowerCase() === normalized);
  return match?.label ?? value;
}

function groupedCreatableProviders(categoryFilter?: string) {
  return CREATABLE_PROVIDER_CATEGORIES
    .filter(category => !categoryFilter || category === categoryFilter)
    .map(category => ({
      category,
      providers: PROVIDER_DEFINITIONS.filter(provider => provider.creatable && provider.category === category),
    }))
    .filter(group => group.providers.length > 0);
}

function createPlaceholderAccount(provider: string, category: string, id: number): TradingAccount {
  return {
    id,
    provider,
    category,
    payment_priority: 0,
    is_active: true,
    notification_channels: null,
    email: null,
    password: null,
    phone: null,
    payment_tag: null,
    is_healthy: false,
    last_health_check: null,
    created_at: '',
    updated_at: '',
    totp_secrets: [],
    passkey_credentials: [],
    seeds: [],
    api_keys: [],
    account_file_backup: null,
    lnd_channel_backup: null,
    bank_accounts: [],
  };
}

function withInfrastructureAccounts(accounts: TradingAccount[]): TradingAccount[] {
  // 'Internal Infrastructure' is not stored in the DB (not in the CHECK constraint),
  // so force it on any LND wallet row that comes back with the wrong category.
  const result = accounts.map(account =>
    isLndWalletProvider(account.provider) && account.category !== 'Internal Infrastructure'
      ? { ...account, category: 'Internal Infrastructure' }
      : account,
  );

  const ensure = (provider: string, category: string, placeholderId: number) => {
    const normalized = provider.trim().toLowerCase();
    if (result.some(account => account.provider.trim().toLowerCase() === normalized)) {
      return;
    }
    result.push(createPlaceholderAccount(provider, category, placeholderId));
  };

  ensure('Bisq', 'DEX', -1);
  ensure('Bisq2', 'DEX', -2);
  ensure(LND_WALLET_PROVIDER, 'Internal Infrastructure', 0);
  return result;
}

function isRobosatsProvider(value: string) {
  return value.trim().toLowerCase() === 'robosats';
}

function isHodlHodlProvider(value: string) {
  return value.trim().toLowerCase() === 'hodlhodl';
}

type APIKeyFormProfile = {
  sectionTitle: string;
  newTitle: string;
  keyLabel: string;
  keyPlaceholder: string;
  secretLabel: string | null;
  secretPlaceholder: string | null;
  createLabel: string;
  countLabel: string;
  itemTitleFallback: string;
  showName: boolean;
  showSecret: boolean;
  showPassphrase: boolean;
  helpText: string | null;
  emptyMessage: string;
};

function apiKeyFormProfile(provider: string): APIKeyFormProfile {
  if (isRobosatsProvider(provider)) {
    return {
      sectionTitle: 'Robot Token',
      newTitle: 'New Robot Token',
      keyLabel: 'Token',
      keyPlaceholder: 'Robot token',
      secretLabel: null,
      secretPlaceholder: null,
      createLabel: 'Create Robot Token',
      countLabel: 'Tokens',
      itemTitleFallback: 'Robot token',
      showName: false,
      showSecret: false,
      showPassphrase: false,
      helpText: 'Paste the robot token from your RoboSats coordinator. No other credentials are required.',
      emptyMessage: 'No robot tokens yet.',
    };
  }
  if (isHodlHodlProvider(provider)) {
    return {
      sectionTitle: 'API Credentials',
      newTitle: 'New API Credentials',
      keyLabel: 'API key',
      keyPlaceholder: 'HodlHodl API key',
      secretLabel: 'Signature key',
      secretPlaceholder: 'HodlHodl signature key',
      createLabel: 'Create API Credentials',
      countLabel: 'Credentials',
      itemTitleFallback: 'API credentials',
      showName: false,
      showSecret: true,
      showPassphrase: false,
      helpText: 'Store your HodlHodl API key and signature key from Account → API. Login details, TOTP, and passkeys are not required here.',
      emptyMessage: 'No API credentials yet.',
    };
  }
  return {
    sectionTitle: 'API Keys',
    newTitle: 'New API Key',
    keyLabel: 'API key',
    keyPlaceholder: 'API key',
    secretLabel: 'API secret',
    secretPlaceholder: 'API secret',
    createLabel: 'Create API Key',
    countLabel: 'API Keys',
    itemTitleFallback: 'API key',
    showName: true,
    showSecret: true,
    showPassphrase: true,
    helpText: null,
    emptyMessage: 'No API keys yet.',
  };
}

function apiKeyPayloadExtras(profile: APIKeyFormProfile, form: APIKeyFormState) {
  return {
    api_secret: profile.showSecret ? form.api_secret || null : null,
    passphrase: profile.showPassphrase ? form.passphrase || null : null,
  };
}

function showDexIdentitySections(provider: string) {
  return !isLocalWalletProvider(provider)
    && !isLndWalletProvider(provider)
    && providerCategoryFor(provider) !== 'CEX'
    && !isRobosatsProvider(provider)
    && !isHodlHodlProvider(provider);
}

function isLocalWalletProvider(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'bisq' || normalized === 'bisq2' || normalized === 'lnd wallet';
}

function isBisqProvider(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'bisq' || normalized === 'bisq2';
}

// isBisq1Provider matches only Bisq v1 — the "Saved payment methods" sync targets the bisq1
// gRPC daemon; Bisq2 exposes a different REST API and is out of scope for this feature.
function isBisq1Provider(value: string) {
  return value.trim().toLowerCase() === 'bisq';
}

function isBisq2Provider(value: string) {
  return value.trim().toLowerCase() === 'bisq2';
}

function chatExchangeForProvider(value: string): 'RoboSats' | 'Bisq2' | null {
  if (isRobosatsProvider(value)) return 'RoboSats';
  if (isBisq2Provider(value)) return 'Bisq2';
  return null;
}

function paymentMethodMatchKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bisqPaymentMethodLabel(id: string) {
  const acronyms = new Set(['ACH', 'BLIK', 'F2F', 'IMPS', 'NEFT', 'PIX', 'SEPA', 'SWIFT', 'UPI']);
  return id.trim().split('_').filter(Boolean).map(word => (
    acronyms.has(word.toUpperCase())
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  )).join(' ');
}

// Bisq exposes stable IDs while the local catalog uses display names, aliases, and regexes.
function catalogRowForBisqMethod(id: string, rows: PaymentMethodRow[]) {
  const key = paymentMethodMatchKey(id);
  const words = id.toLowerCase().split('_').filter(Boolean);
  const label = words.join(' ');
  const ranked = rows.map(row => {
    if ([row.name, ...row.alias_list].some(name => paymentMethodMatchKey(name) === key)) {
      return { row, score: 10_000 + row.name.length };
    }
    if (row.merge_regex) {
      try {
        if (new RegExp(row.merge_regex.replaceAll('(?i)', ''), 'i').test(label)) {
          return { row, score: 5_000 + row.name.length };
        }
      } catch {
        // The catalog editor surfaces bad regexes; exact/token matching can still succeed.
      }
    }
    const rowWords = row.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const tokenMatch = rowWords.length > 0 && rowWords.every(word => words.includes(word));
    return { row, score: tokenMatch ? 1_000 + rowWords.length * 100 : 0 };
  });
  return ranked.sort((a, b) => b.score - a.score).find(candidate => candidate.score > 0)?.row;
}

function bisqFieldLabel(name: string) {
  if (name === 'paymentMethodId') return 'Payment method';
  if (name === 'iban') return 'IBAN';
  if (name === 'bic') return 'BIC';
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, char => char.toUpperCase());
}

function cleanBisqTemplateValues(form: BisqPaymentAccountForm) {
  return Object.fromEntries(Object.entries(form.fields).map(([name, value]) => {
    if (name === 'paymentMethodId' || name === 'salt') return [name, value];
    // Daemon templates contain instructional values ("your username", "primary trading …").
    return [name, ''];
  }));
}

function findDetail(details: Record<string, string>, fieldName: string) {
  const wanted = paymentMethodMatchKey(fieldName);
  const entry = Object.entries(details).find(([key]) => paymentMethodMatchKey(key) === wanted);
  return entry?.[1]?.trim() ?? '';
}

function isLndWalletProvider(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'lnd wallet' || normalized === 'lnd' || normalized === 'lnd_wallet';
}

function isCexAccount(account: TradingAccount) {
  return account.category === 'CEX';
}

type AccountHealthMessage = {
  message: string;
  healthy: boolean | null;
  keys?: TradingAccountKeyPermissionResult[];
};

function formatPermissionLabel(name: string) {
  return name
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

type PermStatus = 'granted' | 'denied' | 'unsupported';

// Canonical CEX permission order — mirrors accounthealth.CanonicalCEXPermissions.
const CANONICAL_PERMISSIONS = ['fetch_deposit_address', 'spot_trading', 'read_balances', 'withdraw', 'hedge_positions'];

// Coerce a stored permission value to a tri-state status. Legacy rows stored
// booleans (true→granted, false→denied) before the tri-state schema existed.
function toPermStatus(value: string | boolean): PermStatus {
  if (typeof value === 'boolean') return value ? 'granted' : 'denied';
  if (value === 'granted' || value === 'denied' || value === 'unsupported') return value;
  return value ? 'granted' : 'denied';
}

const PERM_STYLES: Record<PermStatus, { cls: string; mark: string; title?: string }> = {
  granted: { cls: 'border-green/40 bg-green/10 text-green', mark: '✓' },
  denied: { cls: 'border-red/40 bg-red/10 text-red', mark: '✗' },
  unsupported: { cls: 'border-border bg-surface text-muted', mark: '—', title: 'Not reported by this exchange' },
};

// Union of per-key permissions — mirrors AssessCEXPermissions (any grant wins).
function aggregateAPIKeyPermissions(apiKeys: TradingAccount['api_keys']): Record<string, PermStatus> {
  const combined: Record<string, PermStatus> = {};
  for (const permission of CANONICAL_PERMISSIONS) {
    let status: PermStatus = 'denied';
    let sawUnsupported = false;
    for (const key of apiKeys) {
      const raw = key.permissions?.[permission];
      if (raw === undefined || raw === null || raw === '') {
        continue;
      }
      const value = toPermStatus(raw);
      if (value === 'granted') {
        status = 'granted';
        break;
      }
      if (value === 'unsupported') {
        sawUnsupported = true;
      }
    }
    if (status !== 'granted' && sawUnsupported) {
      status = 'unsupported';
    }
    combined[permission] = status;
  }
  return combined;
}

function AggregatedPermissionsRow({ apiKeys }: { apiKeys: TradingAccount['api_keys'] }) {
  const aggregated = aggregateAPIKeyPermissions(apiKeys);
  return (
    <div className="rounded border border-border bg-surface/40 px-2 py-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[0.65rem] text-text whitespace-nowrap font-medium">Aggregated Permissions</span>
      <div className="flex flex-wrap gap-1">
        {CANONICAL_PERMISSIONS.map(name => {
          const style = PERM_STYLES[aggregated[name] ?? 'denied'];
          return (
            <span
              key={name}
              title={style.title}
              className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] whitespace-nowrap ${style.cls}`}
            >
              {formatPermissionLabel(name)} {style.mark}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function APIKeyPermissionChips({ permissions }: { permissions: Record<string, string | boolean> }) {
  const entries = Object.entries(permissions).sort(([left], [right]) => {
    const li = CANONICAL_PERMISSIONS.indexOf(left);
    const ri = CANONICAL_PERMISSIONS.indexOf(right);
    if (li !== -1 || ri !== -1) {
      return (li === -1 ? Infinity : li) - (ri === -1 ? Infinity : ri);
    }
    return left.localeCompare(right);
  });
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([name, value]) => {
        const style = PERM_STYLES[toPermStatus(value)];
        return (
          <span
            key={name}
            title={style.title}
            className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] whitespace-nowrap ${style.cls}`}
          >
            {formatPermissionLabel(name)} {style.mark}
          </span>
        );
      })}
    </div>
  );
}

function hasStoredAPIKeyPermissions(apiKeys: TradingAccount['api_keys']) {
  return apiKeys.some(key => key.permissions && Object.keys(key.permissions).length > 0);
}

function healthCheckDisplayMessage(
  message: string,
  keys: TradingAccountKeyPermissionResult[] | undefined,
  apiKeys: TradingAccount['api_keys'],
) {
  if (!keys?.length && !hasStoredAPIKeyPermissions(apiKeys)) {
    return message;
  }
  const validatedMarker = ' validated.';
  const markerIndex = message.indexOf(validatedMarker);
  if (markerIndex >= 0) {
    return message.slice(0, markerIndex + validatedMarker.length);
  }
  const keyDetailIndex = message.indexOf(' key "');
  if (keyDetailIndex >= 0) {
    return message.slice(0, keyDetailIndex);
  }
  return message;
}

function providerDefinition(provider: string) {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_DEFINITIONS.find(option => option.value.toLowerCase() === normalized);
}

function providerCategoryFor(provider: string) {
  return providerDefinition(provider)?.category ?? null;
}

function isFiatProvider(provider: string) {
  return providerCategoryFor(provider) === 'Fiat Transmitter';
}

function usesAPIKeysAtCreate(provider: string) {
  const definition = providerDefinition(provider);
  if (!definition) {
    return false;
  }
  if (definition.category === 'CEX') {
    return true;
  }
  return definition.category === 'DEX' && definition.creatable;
}

function showContactFieldsForProvider(provider: string) {
  return isFiatProvider(provider);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateHash(sha256: string) {
  if (sha256.length <= 8) return sha256;
  return `${sha256.slice(0, 8)}…`;
}

function truncatePubkey(pubkey: string) {
  const trimmed = pubkey.trim();
  if (trimmed.length <= 16) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-8)}`;
}

function formatTokenAmount(value: number | undefined, digits = 8) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pickMainnetDepositAddress(addresses: CexDepositAddress[]) {
  if (!addresses.length) {
    return null;
  }
  const mainnetHints = ['bitcoin', 'btc', 'mainnet', 'onchain', 'on-chain'];
  for (const hint of mainnetHints) {
    const match = addresses.find(entry => {
      if (entry.asset.trim().toUpperCase() !== 'BTC') {
        return false;
      }
      const network = entry.network.trim().toLowerCase();
      const method = entry.method?.trim().toLowerCase() ?? '';
      return network.includes(hint) || method.includes(hint);
    });
    if (match) {
      return match;
    }
  }
  return addresses.find(entry => entry.asset.trim().toUpperCase() === 'BTC') ?? addresses[0];
}

function formatCexBalanceSummary(balances: CexBalancesResponse | null | undefined) {
  if (!balances) {
    return null;
  }
  const parts: string[] = [];
  if (balances.bitcoin) {
    parts.push(`BTC ${formatTokenAmount(balances.bitcoin.available)}`);
  }
  for (const entry of balances.fiat) {
    parts.push(`${entry.asset} ${formatTokenAmount(entry.available, 2)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function cexSliceField(section: CexDataSectionKey): keyof CexAccountSlice {
  switch (section) {
    case 'cexDepositAddresses':
      return 'depositAddresses';
    case 'cexBalances':
      return 'balances';
    case 'cexHedging':
      return 'hedgePositions';
    case 'cexSpotTrades':
      return 'spotTrades';
    case 'cexWithdrawalAddresses':
      return 'withdrawalAddresses';
  }
}

async function fetchCexSectionData(section: CexDataSectionKey, accountId: number) {
  switch (section) {
    case 'cexDepositAddresses':
      return fetchCexDepositAddresses(accountId);
    case 'cexBalances':
      return fetchCexBalances(accountId);
    case 'cexHedging':
      return fetchCexHedgePositions(accountId);
    case 'cexSpotTrades':
      return fetchCexSpotTrades(accountId);
    case 'cexWithdrawalAddresses':
      return fetchCexWithdrawalAddresses(accountId);
  }
}

function renderCexSectionMessage(loading: boolean, error: string | null, emptyMessage: string, hasData: boolean) {
  if (loading && !hasData) {
    return <div className="text-[0.65rem] text-muted px-1">Loading…</div>;
  }
  if (error) {
    return <div className="text-[0.65rem] text-red px-1">{error}</div>;
  }
  if (!hasData) {
    return <div className="text-[0.65rem] text-muted px-1">{emptyMessage}</div>;
  }
  return null;
}

function renderHedgePositionCard(position: CexHedgePosition, label: string) {
  return (
    <ResourceCard key={`${label}-${position.transaction_id}`} title={`${label} #${position.transaction_id}`}>
      <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
        <div><span className="text-text">Direction:</span> {position.direction}</div>
        <div><span className="text-text">Status:</span> {position.status}</div>
        {position.venue ? <div><span className="text-text">Venue:</span> {position.venue}</div> : null}
        {position.instrument ? <div><span className="text-text">Instrument:</span> {position.instrument}</div> : null}
        {position.size_btc != null ? <div><span className="text-text">Size:</span> {formatTokenAmount(position.size_btc)} BTC</div> : null}
        {position.fee != null ? <div><span className="text-text">Fee:</span> {formatTokenAmount(position.fee)}</div> : null}
        {position.opened_at ? <div><span className="text-text">Opened:</span> {formatDate(position.opened_at)}</div> : null}
        {position.closed_at ? <div><span className="text-text">Closed:</span> {formatDate(position.closed_at)}</div> : null}
      </div>
    </ResourceCard>
  );
}

function formatSats(sats: number | undefined) {
  const value = sats ?? 0;
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(8)} BTC`;
  }
  return `${value.toLocaleString()} sats`;
}

function channelHealthLabel(health: string) {
  switch (health) {
    case 'healthy':
      return 'Healthy';
    case 'inactive':
      return 'Inactive';
    case 'low_outbound':
      return 'Low outbound';
    default:
      return health;
  }
}

function channelHealthClass(health: string) {
  switch (health) {
    case 'healthy':
      return 'border-green/40 bg-green/10 text-green';
    case 'inactive':
      return 'border-red/40 bg-red/10 text-red';
    case 'low_outbound':
      return 'border-yellow/40 bg-yellow/10 text-yellow';
    default:
      return 'border-border bg-surface text-muted';
  }
}

function providerOptionsForValue(value: string, category?: string): ProviderOption[] {
  const options: ProviderOption[] = [
    { value: '', label: 'Please select provider' },
    ...PROVIDER_DEFINITIONS
      .filter(provider => !category || provider.category === category)
      .map(provider => ({ value: provider.value, label: provider.label })),
  ];
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || options.some(option => option.value.toLowerCase() === trimmed)) {
    return options;
  }
  return [...options, { value: value.trim(), label: value }];
}

function renderProviderSelectOptions(grouped: boolean, flatOptions: ProviderOption[], category?: string) {
  if (grouped) {
    return (
      <>
        <option value="" disabled hidden>
          Please select provider
        </option>
        {groupedCreatableProviders(category).map(group => (
          <optgroup key={group.category} label={group.category}>
            {group.providers.map(provider => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </optgroup>
        ))}
      </>
    );
  }
  return flatOptions.map(option => {
    if (!option.value) {
      return (
        <option key="provider-placeholder" value="" disabled hidden>
          {option.label}
        </option>
      );
    }
    return (
      <option key={`${option.value}-${option.label}`} value={option.value}>
        {option.label}
      </option>
    );
  });
}

function categoryRank(category: string) {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function HealthBadge({ account, compact = false }: { account: TradingAccount; compact?: boolean }) {
  const label = account.is_healthy ? 'Healthy' : 'Unhealthy';
  const cls = account.is_healthy
    ? 'border-green/40 bg-green/10 text-green'
    : 'border-red/40 bg-red/10 text-red';
  const sizeCls = compact ? 'px-1.5 py-0.5 text-[0.65rem]' : 'px-2 py-1 text-xs';
  return (
    <span
      className={`rounded-full border font-medium ${sizeCls} ${cls}`}
      title={`Last health check: ${formatDate(account.last_health_check)}`}
    >
      {label}
    </span>
  );
}

interface AccountFormState {
  provider: string;
  category: string;
  email: string;
  password: string;
  phone: string;
  payment_tag: string;
}

type CredentialField = keyof TradingAccountCredentialReveal;

interface BankAccountFormState {
  label: string;
  owner_name: string;
  currency: string;
  country: string;
  scheme: string;
  iban: string;
  bic: string;
  is_active: boolean;
}

type AccountSectionKey =
  | 'totp'
  | 'passkeys'
  | 'seeds'
  | 'apiKeys'
  | 'bisqPaymentMethods'
  | 'chatPaymentMethods'
  | 'lndBackup'
  | 'lightningManagement'
  | 'walletAddresses'
  | 'cexHedging'
  | 'cexSpotTrades'
  | 'cexWithdrawalAddresses';

type ChatTemplateDraft = {
  template: string;
  is_active: boolean;
};

type CexSectionSlice<T> = {
  loading: boolean;
  error: string | null;
  data: T | null;
};

type CexAccountSlice = {
  depositAddresses?: CexSectionSlice<CexDepositAddress[]>;
  balances?: CexSectionSlice<CexBalancesResponse>;
  hedgePositions?: CexSectionSlice<CexHedgePositionsResponse>;
  spotTrades?: CexSectionSlice<CexSpotTrade[]>;
  withdrawalAddresses?: CexSectionSlice<CexWithdrawalAddress[]>;
};

type CexCollapsibleSectionKey = 'cexHedging' | 'cexSpotTrades' | 'cexWithdrawalAddresses';
type CexDataSectionKey = CexCollapsibleSectionKey | 'cexDepositAddresses' | 'cexBalances';
type NewFormKey = 'totp' | 'passkeys' | 'seeds' | 'apiKeys';

interface TradingPanelUiState {
  expandedId: number | null;
  showNewAccountForm: boolean;
  newAccount: AccountFormState;
  newAccountAPIKey: APIKeyFormState;
  editingAccountId: number | null;
  editingAccount: AccountFormState;
  openSectionsByAccount: Record<number, Partial<Record<AccountSectionKey, boolean>>>;
  showNewFormByAccount: Record<number, Partial<Record<NewFormKey, boolean>>>;
  newTOTPByAccount: Record<number, TOTPFormState>;
  editingTOTPById: Record<number, TOTPFormState>;
  newPasskeyByAccount: Record<number, PasskeyFormState>;
  editingPasskeyById: Record<number, PasskeyFormState>;
  newSeedByAccount: Record<number, SeedFormState>;
  editingSeedById: Record<number, SeedFormState>;
  newAPIKeyByAccount: Record<number, APIKeyFormState>;
  editingAPIKeyById: Record<number, APIKeyFormState>;
  newBankAccountByAccount: Record<number, BankAccountFormState>;
  editingBankAccountById: Record<number, BankAccountFormState>;
  checkingHealthByAccount: Record<number, boolean>;
  healthMessageByAccount: Record<number, AccountHealthMessage>;
}

type TradingPanelUiAction = {
  type: 'UPDATE';
  update: (state: TradingPanelUiState) => TradingPanelUiState;
};

function resolveState<T>(value: SetStateAction<T>, previous: T): T {
  return typeof value === 'function' ? (value as (prev: T) => T)(previous) : value;
}

function tradingPanelUiReducer(state: TradingPanelUiState, action: TradingPanelUiAction): TradingPanelUiState {
  switch (action.type) {
    case 'UPDATE':
      return action.update(state);
  }
}

interface TOTPFormState {
  secret: string;
  is_active: boolean;
}

interface PasskeyFormState {
  credential_id: string;
  rp_id: string;
  private_key_pkcs8: string;
  user_handle: string;
  sign_count: string;
  is_active: boolean;
  last_used_at: string;
}

interface SeedFormState {
  seed_phrase: string;
  wallet_created_at: string;
}

interface APIKeyFormState {
  name: string;
  api_key: string;
  api_secret: string;
  passphrase: string;
  is_active: boolean;
}

function emptyAccountForm(): AccountFormState {
  return { provider: '', category: '', email: '', password: '', phone: '', payment_tag: '' };
}

function emptyBankAccountForm(): BankAccountFormState {
  return { label: '', owner_name: '', currency: 'EUR', country: 'DE', scheme: 'iban_bic', iban: '', bic: '', is_active: true };
}

function isBankAccount(account: TradingAccount) {
  return account.category === 'Bank';
}

function emptyAPIKeyForm(): APIKeyFormState {
  return { name: '', api_key: '', api_secret: '', passphrase: '', is_active: true };
}

interface OpenChannelFormState {
  nodePubkey: string;
  peerHost: string;
  localFundingAmountSat: string;
  pushSat: string;
  satPerVbyte: string;
  private: boolean;
}

function emptyOpenChannelForm(): OpenChannelFormState {
  return {
    nodePubkey: '',
    peerHost: '',
    localFundingAmountSat: '100000',
    pushSat: '0',
    satPerVbyte: '2',
    private: false,
  };
}

function APIKeyDraftFields({
  value,
  onChange,
  provider,
}: {
  value: APIKeyFormState;
  onChange: (next: APIKeyFormState) => void;
  provider: string;
}) {
  const profile = apiKeyFormProfile(provider);

  return (
    <div className="grid gap-2 rounded-md border border-border bg-surface p-2">
      <div className="text-xs font-semibold text-text">{profile.sectionTitle}</div>
      {profile.helpText ? (
        <p className="text-[0.65rem] text-muted leading-relaxed">{profile.helpText}</p>
      ) : null}
      <div className="grid gap-1.5 md:grid-cols-2">
        {profile.showName ? (
          <label className="grid gap-1 text-xs text-muted">
            <span>Name</span>
            <input
              className={compactInputCls}
              value={value.name}
              onChange={e => onChange({ ...value, name: e.target.value })}
              placeholder="Optional label"
            />
          </label>
        ) : null}
        <label className="grid gap-1 text-xs text-muted md:col-span-2">
          <span>{profile.keyLabel}</span>
          <textarea
            className={textareaCls}
            value={value.api_key}
            onChange={e => onChange({ ...value, api_key: e.target.value })}
            placeholder={profile.keyPlaceholder}
          />
        </label>
        {profile.showSecret ? (
          <label className="grid gap-1 text-xs text-muted md:col-span-2">
            <span>{profile.secretLabel}</span>
            <textarea
              className={textareaCls}
              value={value.api_secret}
              onChange={e => onChange({ ...value, api_secret: e.target.value })}
              placeholder={profile.secretPlaceholder ?? undefined}
            />
          </label>
        ) : null}
        {profile.showPassphrase ? (
          <label className="grid gap-1 text-xs text-muted md:col-span-2">
            <span>Passphrase</span>
            <input
              className={compactInputCls}
              value={value.passphrase}
              onChange={e => onChange({ ...value, passphrase: e.target.value })}
              placeholder="Optional passphrase"
            />
          </label>
        ) : null}
        <label className={`flex items-center gap-2 text-xs text-muted ${!profile.showName ? 'md:col-span-2' : ''}`}>
          <input
            type="checkbox"
            checked={value.is_active}
            onChange={e => onChange({ ...value, is_active: e.target.checked })}
          />
          Active
        </label>
      </div>
    </div>
  );
}

function AccountEditor({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  compact = false,
  submitDisabled = false,
  showContactFields = true,
  showWalletPasswordOnly = false,
  groupedProviders = false,
  freeFormProvider = false,
  providerCategory,
  extraContent,
}: {
  value: AccountFormState;
  onChange: (next: AccountFormState) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
  compact?: boolean;
  submitDisabled?: boolean;
  showContactFields?: boolean;
  showWalletPasswordOnly?: boolean;
  groupedProviders?: boolean;
  freeFormProvider?: boolean;
  providerCategory?: string;
  extraContent?: ReactNode;
}) {
  const options = useMemo(
    () => providerOptionsForValue(value.provider, providerCategory),
    [value.provider, providerCategory],
  );
  const fieldCls = compact
    ? 'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent'
    : inputCls;
  const labelCls = compact ? 'grid min-w-0 gap-1 text-xs text-muted' : 'grid gap-1 text-sm text-muted';
  const emailError = showContactFields ? emailFormatError(value.email) : null;
  const effectiveSubmitDisabled = submitDisabled || Boolean(emailError);
  const submitCls = effectiveSubmitDisabled
    ? `${primaryButtonCls} cursor-not-allowed opacity-50`
    : primaryButtonCls;

  if (compact) {
    return (
      <div className="grid gap-2">
        <div className={`grid items-end gap-2 ${showContactFields ? 'md:grid-cols-[minmax(9rem,1.1fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_minmax(7rem,0.8fr)_auto]' : showWalletPasswordOnly ? 'md:grid-cols-[minmax(9rem,1.1fr)_minmax(9rem,1fr)_auto]' : 'md:grid-cols-[minmax(9rem,1.1fr)_auto]'}`}>
          <label className={labelCls}>
            <span>Provider</span>
            {freeFormProvider ? (
              <input
                className={fieldCls}
                value={value.provider}
                onChange={e => onChange({ ...value, provider: e.target.value })}
                placeholder="Bank name (e.g. N26, Sparkasse)"
              />
            ) : (
              <select
                className={fieldCls}
                value={value.provider}
                onChange={e => onChange({ ...value, provider: e.target.value })}
              >
                {renderProviderSelectOptions(groupedProviders, options, providerCategory)}
              </select>
            )}
          </label>
          {showContactFields ? (
            <>
              <label className={labelCls}>
                <span>Email</span>
                <input
                  className={fieldCls}
                  value={value.email}
                  onChange={e => onChange({ ...value, email: e.target.value })}
                  placeholder="Optional"
                />
                {emailError ? <span className="text-[0.65rem] text-red">{emailError}</span> : null}
              </label>
              <label className={labelCls}>
                <span>Password</span>
                <input
                  className={fieldCls}
                  type="password"
                  value={value.password}
                  onChange={e => onChange({ ...value, password: e.target.value })}
                  placeholder="Optional"
                />
              </label>
              <label className={labelCls}>
                <span>Phone</span>
                <input
                  className={fieldCls}
                  value={value.phone}
                  onChange={e => onChange({ ...value, phone: e.target.value })}
                placeholder="Optional"
              />
              </label>
              <label className={labelCls}>
                <span>Payment Tag</span>
                <input
                  className={fieldCls}
                  value={value.payment_tag}
                  onChange={e => onChange({ ...value, payment_tag: e.target.value })}
                  placeholder="e.g. revtag or Wise tag"
                />
              </label>
            </>
          ) : null}
          {!showContactFields && showWalletPasswordOnly ? (
            <label className={labelCls}>
              <span>Wallet password</span>
              <input
                className={fieldCls}
                type="password"
                value={value.password}
                onChange={e => onChange({ ...value, password: e.target.value })}
                placeholder="Required for LND"
              />
            </label>
          ) : null}
          <div className="flex gap-1">
            {onCancel ? (
              <button type="button" className={compactButtonCls} onClick={onCancel}>
                Cancel
              </button>
            ) : null}
            <button type="button" className={submitCls} disabled={effectiveSubmitDisabled} onClick={onSubmit}>
              {submitLabel}
            </button>
          </div>
        </div>
        {extraContent}
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-4">
      <label className={labelCls}>
        <span>Provider</span>
        {freeFormProvider ? (
          <input
            className={fieldCls}
            value={value.provider}
            onChange={e => onChange({ ...value, provider: e.target.value })}
            placeholder="Bank name (e.g. N26, Sparkasse)"
          />
        ) : (
          <select
            className={fieldCls}
            value={value.provider}
            onChange={e => onChange({ ...value, provider: e.target.value })}
          >
            {renderProviderSelectOptions(groupedProviders, options, providerCategory)}
          </select>
        )}
      </label>
      {showContactFields ? (
        <>
          <label className={labelCls}>
            <span>Email</span>
            <input
              className={fieldCls}
              value={value.email}
              onChange={e => onChange({ ...value, email: e.target.value })}
              placeholder="Optional"
            />
            {emailError ? <span className="text-[0.65rem] text-red">{emailError}</span> : null}
          </label>
          <label className={labelCls}>
            <span>Password</span>
            <input
              className={fieldCls}
              type="password"
              value={value.password}
              onChange={e => onChange({ ...value, password: e.target.value })}
              placeholder="Optional"
            />
          </label>
      <label className={labelCls}>
        <span>Phone</span>
            <input
              className={fieldCls}
              value={value.phone}
              onChange={e => onChange({ ...value, phone: e.target.value })}
          placeholder="Optional"
        />
      </label>
      <label className={labelCls}>
        <span>Payment Tag</span>
        <input
          className={fieldCls}
          value={value.payment_tag}
          onChange={e => onChange({ ...value, payment_tag: e.target.value })}
          placeholder="e.g. revtag or Wise tag"
        />
      </label>
        </>
      ) : null}
      {!showContactFields && showWalletPasswordOnly ? (
        <label className={labelCls}>
          <span>Wallet password</span>
          <input
            className={fieldCls}
            type="password"
            value={value.password}
            onChange={e => onChange({ ...value, password: e.target.value })}
            placeholder="Required for LND"
          />
        </label>
      ) : null}
      {extraContent ? <div className="md:col-span-4">{extraContent}</div> : null}
      <div className={`${showContactFields || showWalletPasswordOnly ? 'md:col-span-4' : 'md:col-span-1'} flex justify-end gap-1`}>
        {onCancel ? (
          <button type="button" className={buttonCls} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="button" className={submitCls} disabled={effectiveSubmitDisabled} onClick={onSubmit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={onToggle}
        >
          <span className="shrink-0 text-[0.6rem] text-muted">{open ? '▼' : '▶'}</span>
          <span className="text-xs font-semibold text-text">{title}</span>
          {count != null ? (
            <span className="rounded-full border border-border px-1.5 py-0 text-[0.6rem] text-muted">{count}</span>
          ) : null}
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {open ? <div className="border-t border-border px-2 py-1.5 grid gap-1.5">{children}</div> : null}
    </div>
  );
}

function BackupField({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-bg px-2 py-1.5 grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text">{title}</span>
        {meta ? <span className="text-[0.65rem] text-muted">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

function SecretItem({
  title,
  meta,
  summary,
  footer,
  children,
  actions,
  forceOpen = false,
  flat = false,
}: {
  title: string;
  meta?: string;
  summary?: string;
  footer?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  forceOpen?: boolean;
  flat?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
  return (
    <div className={flat ? "border-b border-border last:border-b-0" : "rounded border border-border bg-bg"}>
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setOpen(prev => !prev)}
        >
          <span className="shrink-0 text-[0.55rem] text-muted">{isOpen ? '▼' : '▶'}</span>
          <span className="truncate text-xs font-medium text-text">{title}</span>
          {meta ? <span className="hidden truncate text-[0.65rem] text-muted sm:inline">{meta}</span> : null}
        </button>
        {actions ? <div className="flex shrink-0 gap-1">{actions}</div> : null}
      </div>
      {!isOpen && summary ? (
        <div className="border-t border-border px-2 py-1 text-[0.65rem] text-muted truncate">{summary}</div>
      ) : null}
      {footer ? <div className="border-t border-border px-2 py-1.5">{footer}</div> : null}
      {isOpen ? <div className="border-t border-border px-2 py-1.5 grid gap-1.5">{children}</div> : null}
    </div>
  );
}

function SecretRevealValue({
  label,
  value,
  visible,
  onToggle,
  disabled,
  revealLabel,
}: {
  label?: string;
  value: string | null | undefined;
  visible: boolean;
  onToggle: () => void;
  disabled: boolean;
  revealLabel: string;
}) {
  const actionLabel = visible ? `Hide ${revealLabel}` : `Show ${revealLabel}`;
  return (
    <div className="min-w-0">
      {label ? <div className="mb-0.5 text-muted">{label}</div> : null}
      <div className="relative min-w-0">
        <button
          type="button"
          className="absolute left-0 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-bg text-sm text-muted transition hover:bg-surface hover:text-text disabled:cursor-wait disabled:opacity-50"
          aria-label={actionLabel}
          title={actionLabel}
          onClick={onToggle}
          disabled={disabled}
        >
          👁
        </button>
        <code className="block min-h-7 break-all py-1 pl-9 font-mono text-text">
          {visible ? value || '—' : '••••••••'}
        </code>
      </div>
    </div>
  );
}

function ResourceCard({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-bg p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text">{title}</div>
          {meta ? <div className="text-[0.65rem] text-muted">{meta}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

type AccountsSubview = 'payment' | 'trading' | 'communication';

type AccountGroup = {
  category: string;
  accounts: TradingAccount[];
};

type AccountSummaryViewModel = {
  providerName: string;
  category: string;
  createdLabel: string;
  updatedLabel: string;
  capabilityBadges: string[];
};

function buildAccountSummaryViewModel(account: TradingAccount): AccountSummaryViewModel {
  const capabilityBadges: string[] = [];
  const localWallet = isLocalWalletProvider(account.provider);
  const dexIdentity = showDexIdentitySections(account.provider);
  const backupItems = Number(Boolean(account.password)) + Number(Boolean(account.seeds[0])) + Number(Boolean(account.lnd_channel_backup));

  if (dexIdentity && account.totp_secrets.length > 0) {
    capabilityBadges.push(`${account.totp_secrets.length} TOTP`);
  }
  if (dexIdentity && account.passkey_credentials.length > 0) {
    capabilityBadges.push(`${account.passkey_credentials.length} Passkeys`);
  }
  if (dexIdentity && !isBankAccount(account) && account.category !== 'Fiat Transmitter' && account.seeds.length > 0) {
    capabilityBadges.push(`${account.seeds.length} Seeds`);
  }
  if (!localWallet && !isBankAccount(account) && account.category !== 'Fiat Transmitter' && account.api_keys.length > 0) {
    capabilityBadges.push(`${account.api_keys.length} ${apiKeyFormProfile(account.provider).countLabel}`);
  }
  if (isBisqProvider(account.provider) && account.account_file_backup) {
    capabilityBadges.push('Account file');
  }
  if (isLndWalletProvider(account.provider) && backupItems > 0) {
    capabilityBadges.push(`${backupItems} Backups`);
  }
  if (account.bank_accounts.length > 0) {
    capabilityBadges.push(`${account.bank_accounts.length} Bank accounts`);
  }

  return {
    providerName: providerLabel(account.provider),
    category: account.category || 'Uncategorized',
    createdLabel: formatAccountHeaderDate(account.created_at),
    updatedLabel: formatAccountHeaderDate(account.updated_at),
    capabilityBadges,
  };
}

function serviceVersionForAccount(account: TradingAccount, versions: ServiceVersions | null) {
  if (isBisq1Provider(account.provider)) return versions?.bisq1 || null;
  if (isBisq2Provider(account.provider)) return versions?.bisq2 || null;
  if (isLndWalletProvider(account.provider)) return versions?.lnd || null;
  return null;
}

function accountCredentialSummary(account: TradingAccount) {
  const parts: string[] = [];
  if (showDexIdentitySections(account.provider)) {
    if (account.email) parts.push('Email stored');
    if (account.password) parts.push('Password stored');
    if (account.phone) parts.push('Phone stored');
  }
  if (isLndWalletProvider(account.provider)) {
    parts.push(account.password ? 'Wallet password stored' : 'Wallet password missing');
  }
  if (account.api_keys.length > 0) {
    parts.push(`${account.api_keys.length} API keys`);
  }
  if (account.totp_secrets.length > 0) {
    parts.push(`${account.totp_secrets.length} TOTP`);
  }
  if (account.passkey_credentials.length > 0) {
    parts.push(`${account.passkey_credentials.length} passkeys`);
  }
  if (account.seeds.length > 0) {
    parts.push(`${account.seeds.length} seeds`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'No stored credentials';
}

function AccountsToolbar({
  activeTab,
  paymentAccountCount,
  tradingAccountCount,
  onSelectTab,
  showActions,
  showNewAccountForm,
  onToggleNewAccount,
  onRefresh,
}: {
  activeTab: AccountsSubview;
  paymentAccountCount: number;
  tradingAccountCount: number;
  onSelectTab: (tab: AccountsSubview) => void;
  showActions: boolean;
  showNewAccountForm: boolean;
  onToggleNewAccount: () => void;
  onRefresh: () => void;
}) {
  const activeLabel =
    activeTab === 'payment'
      ? `${paymentAccountCount} payment account${paymentAccountCount === 1 ? '' : 's'}`
      : activeTab === 'trading'
        ? `${tradingAccountCount} trading account${tradingAccountCount === 1 ? '' : 's'}`
        : 'Telegram gateway';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 mr-auto">
        <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Trading Accounts</h3>
        <p className="mt-1 text-xs text-muted">{activeLabel}</p>
      </div>
      <AccountsSubtabBar
        activeTab={activeTab}
        paymentAccountCount={paymentAccountCount}
        tradingAccountCount={tradingAccountCount}
        onSelect={onSelectTab}
      />
      {showActions ? (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={compactPrimaryButtonCls} onClick={onToggleNewAccount}>
            {showNewAccountForm ? 'Cancel' : 'Add Account'}
          </button>
          <button type="button" className={compactButtonCls} onClick={onRefresh}>
            Refresh
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AccountsSubtabBar({
  activeTab,
  paymentAccountCount,
  tradingAccountCount,
  onSelect,
}: {
  activeTab: AccountsSubview;
  paymentAccountCount: number;
  tradingAccountCount: number;
  onSelect: (tab: AccountsSubview) => void;
}) {
  const tabs: Array<{ id: AccountsSubview; label: string; count: number | null }> = [
    { id: 'payment', label: 'Payments', count: paymentAccountCount },
    { id: 'trading', label: 'Trading', count: tradingAccountCount },
    { id: 'communication', label: 'Communication', count: 2 },
  ];

  return (
    <div className="flex shrink-0 gap-0.5 rounded-lg border border-border bg-bg p-0.5">
      {tabs.map(tab => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={`min-w-0 rounded-md px-2 py-1 text-[0.7rem] font-medium transition ${
              active ? 'bg-accent/10 text-accent shadow-sm' : 'text-muted hover:bg-surface hover:text-text'
            }`}
            onClick={() => onSelect(tab.id)}
          >
            <span className="truncate">{tab.label}</span>
            {tab.count != null ? <span className="ml-1 text-[0.65rem] opacity-70">{tab.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function AccountSummaryCard({
  account,
  viewModel,
  selected,
  onSelect,
  paymentPriority,
  serviceVersion,
  onDragStart,
  onDrop,
}: {
  account: TradingAccount;
  viewModel: AccountSummaryViewModel;
  selected: boolean;
  onSelect: () => void;
  paymentPriority?: number;
  serviceVersion?: string | null;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`account-summary-card-${account.id}`}
      draggable={paymentPriority != null}
      title={paymentPriority != null ? 'Drag to reorder payment account' : undefined}
      className={`w-full rounded-lg border p-3 text-left transition ${
        selected
          ? 'border-accent bg-accent/5 shadow-sm'
          : 'border-border bg-bg hover:border-accent/40 hover:bg-surface'
      }`}
      onClick={onSelect}
      onDragStart={onDragStart}
      onDragOver={paymentPriority != null ? event => event.preventDefault() : undefined}
      onDrop={onDrop}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-text">{viewModel.providerName}</div>
          <div className="mt-1 text-[0.68rem] text-muted">{viewModel.category}</div>
          {selected && serviceVersion ? <div className="mt-1 truncate font-mono text-[0.65rem] text-muted">{serviceVersion}</div> : null}
        </div>
        <div className="shrink-0">
          <div className="flex items-center gap-1.5">
            {paymentPriority != null ? (
              <span className="rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent" aria-label={`Priority ${paymentPriority}`}>
                {paymentPriority}
              </span>
            ) : null}
            {!isPaymentCategory(account.category || 'Uncategorized') ? <HealthBadge account={account} compact /> : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {viewModel.capabilityBadges.map(badge => (
          <span key={badge} className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted">
            {badge}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.65rem] text-muted">
        <span>Created {viewModel.createdLabel}</span>
        <span>Updated {viewModel.updatedLabel}</span>
      </div>
    </button>
  );
}

function AccountsList({
  groups,
  selectedAccountId,
  onSelectAccount,
  onReorderPaymentAccounts,
  serviceVersions,
  showCategoryDividers = true,
}: {
  groups: AccountGroup[];
  selectedAccountId: number | null;
  onSelectAccount: (accountId: number) => void;
  onReorderPaymentAccounts?: (fromAccountId: number, toAccountId: number) => void;
  serviceVersions?: ServiceVersions | null;
  showCategoryDividers?: boolean;
}) {
  return (
    <div data-testid="accounts-list" className="grid content-start gap-3">
      {groups.map(group => (
        <section key={group.category} className="grid gap-2">
          {showCategoryDividers ? (
            <div className="flex items-center justify-between gap-2">
              <div className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-muted">{group.category}</div>
              <div className="h-px flex-1 bg-border" />
            </div>
          ) : null}
          <div className="grid gap-2">
            {group.accounts.map(account => (
              <AccountSummaryCard
                key={account.id}
                account={account}
                viewModel={buildAccountSummaryViewModel(account)}
                selected={selectedAccountId === account.id}
                onSelect={() => onSelectAccount(account.id)}
                serviceVersion={serviceVersionForAccount(account, serviceVersions ?? null)}
                paymentPriority={showCategoryDividers ? undefined : account.payment_priority || undefined}
                onDragStart={showCategoryDividers ? undefined : event => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(account.id));
                }}
                onDrop={showCategoryDividers ? undefined : event => {
                  event.preventDefault();
                  const fromAccountId = Number(event.dataTransfer.getData('text/plain'));
                  if (Number.isInteger(fromAccountId) && fromAccountId !== account.id) {
                    onReorderPaymentAccounts?.(fromAccountId, account.id);
                  }
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function AccountDetailPane({
  account,
  summaryView,
  actions,
  healthMessage,
  onDismissHealthMessage,
  onToggleActive,
  overview,
  children,
}: {
  account: TradingAccount;
  summaryView: AccountSummaryViewModel;
  actions: ReactNode;
  healthMessage?: AccountHealthMessage;
  onDismissHealthMessage?: () => void;
  onToggleActive: () => void;
  overview: ReactNode;
  children: ReactNode;
}) {
  const isPaymentAccount = isPaymentCategory(account.category || 'Uncategorized');
  const healthMessageHealthy = healthMessage?.healthy === true;

  return (
    <div data-testid="account-detail-pane" className="rounded-lg border border-border bg-bg p-3">
      <div className="flex flex-col gap-3 border-b border-border pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-semibold text-text">{summaryView.providerName}</h4>
              <span className="rounded-full border border-border px-2 py-0.5 text-[0.68rem] text-muted">
                {summaryView.category}
              </span>
              {!isPaymentAccount ? <HealthBadge account={account} /> : null}
            </div>
            <div className="mt-2 text-[0.68rem] text-muted">
              Created {summaryView.createdLabel} · Updated {summaryView.updatedLabel}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {account.category === 'Fiat Transmitter' || account.category === 'Bank' || account.category === 'Wallet addresses' ? (
              <>
                <button
                  type="button"
                  role="switch"
                  aria-checked={account.is_active}
                  aria-label={`${account.is_active ? 'Deactivate' : 'Activate'} ${summaryView.providerName}`}
                  title={`${account.is_active ? 'Deactivate' : 'Activate'} payment method`}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${account.is_active ? 'border-green/50 bg-green/20' : 'border-border bg-border/50'}`}
                  onClick={onToggleActive}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-text transition-transform ${account.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className={`text-xs ${account.is_active ? 'text-green' : 'text-muted'}`}>{account.is_active ? 'Active' : 'Inactive'}</span>
              </>
            ) : null}
            {actions}
          </div>
        </div>
        {!isPaymentAccount && healthMessage ? (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
              healthMessageHealthy ? 'border-green/30 bg-green/5' : 'border-red/30 bg-red/5'
            }`}
          >
            <p className={`min-w-0 flex-1 text-xs leading-relaxed ${healthMessageHealthy ? 'text-green' : 'text-red'}`}>
              {healthCheckDisplayMessage(healthMessage.message, healthMessage.keys, account.api_keys)}
            </p>
            {onDismissHealthMessage ? (
              <button
                type="button"
                className={`${compactButtonCls} shrink-0 px-1.5 ${healthMessageHealthy ? 'text-green' : 'text-red'}`}
                aria-label="Dismiss health check message"
                onClick={onDismissHealthMessage}
              >
                ✕
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="rounded-lg border border-border bg-surface p-3">{overview}</div>
      </div>
      <div className="mt-3 grid gap-2">{children}</div>
    </div>
  );
}

export function TradingAccountsPanel() {
  const { filters } = useFilters();
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [activeTab, setActiveTab] = useState<'payment' | 'trading' | 'communication'>(() => {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
      if (stored === 'payment' || stored === 'trading' || stored === 'communication') return stored;
    }
    return 'payment';
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingNotificationChannelsByAccount, setSavingNotificationChannelsByAccount] = useState<Record<number, boolean>>({});
  const [revealedCredentialsByAccount, setRevealedCredentialsByAccount] = useState<Record<number, TradingAccountCredentialReveal>>({});
  const [visibleCredentialFieldsByAccount, setVisibleCredentialFieldsByAccount] = useState<Record<number, Partial<Record<CredentialField, boolean>>>>({});
  const [revealingCredentialsByAccount, setRevealingCredentialsByAccount] = useState<Record<number, boolean>>({});
  const [revealedAccountSecretsByAccount, setRevealedAccountSecretsByAccount] = useState<Record<number, TradingAccount>>({});
  const [visibleAccountSecretsByAccount, setVisibleAccountSecretsByAccount] = useState<Record<number, Record<string, boolean>>>({});
  const [lndWalletStatus, setLndWalletStatus] = useState<LNDWalletStatus | null>(null);
  const [lndWalletLoading, setLndWalletLoading] = useState(false);
  const [lndWalletError, setLndWalletError] = useState<string | null>(null);
  const [lndWalletNotice, setLndWalletNotice] = useState<string | null>(null);
  const [lndWalletState, setLndWalletState] = useState<LNDWalletState | null>(null);
  const [serviceVersions, setServiceVersions] = useState<ServiceVersions | null>(null);
  const [lndWalletStateLoading, setLndWalletStateLoading] = useState(false);
  const [walletPassword, setWalletPassword] = useState('');
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState('');
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [newAddressLabel, setNewAddressLabel] = useState('');
  const [creatingAddress, setCreatingAddress] = useState(false);
  const [openChannelForm, setOpenChannelForm] = useState<OpenChannelFormState>(emptyOpenChannelForm);
  const [openingChannel, setOpeningChannel] = useState(false);
  const [closingChannelPoint, setClosingChannelPoint] = useState<string | null>(null);
  const [cexDataByAccount, setCexDataByAccount] = useState<Record<number, CexAccountSlice>>({});
  // Bisq1 "Saved payment methods" section state. Loaded lazily when the section is first
  // opened (it needs the DEX stack, which may be down independently of the panel).
  const [bisqPmAccounts, setBisqPmAccounts] = useState<BisqPaymentAccount[]>([]);
  const [bisqSupportedMethods, setBisqSupportedMethods] = useState<BisqPaymentMethod[]>([]);
  const [bisqCatalogRows, setBisqCatalogRows] = useState<PaymentMethodRow[]>([]);
  const [bisqSelectedMethodID, setBisqSelectedMethodID] = useState('');
  const [bisqAccountForm, setBisqAccountForm] = useState<BisqPaymentAccountForm | null>(null);
  const [bisqFormValues, setBisqFormValues] = useState<Record<string, string>>({});
  const [bisqFormStep, setBisqFormStep] = useState<'edit' | 'review'>('edit');
  const [bisqFormLoading, setBisqFormLoading] = useState(false);
  const bisqFormRequestID = useRef(0);
  const [bisqPmLoading, setBisqPmLoading] = useState(false);
  const [bisqPmError, setBisqPmError] = useState<string | null>(null);
  const [bisqPmLoaded, setBisqPmLoaded] = useState(false);
  const [bisqPmBusyKey, setBisqPmBusyKey] = useState<string | null>(null);
  const [bisqAccountFileDownloading, setBisqAccountFileDownloading] = useState<number | null>(null);
  const [bisqAccountFileError, setBisqAccountFileError] = useState<string | null>(null);
  const [chatPaymentMethods, setChatPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [chatTemplatesByMethod, setChatTemplatesByMethod] = useState<Record<number, PaymentMethodChatTemplate[]>>({});
  const [chatTemplateDrafts, setChatTemplateDrafts] = useState<Record<number, ChatTemplateDraft>>({});
  const [chatTemplateEditingMethods, setChatTemplateEditingMethods] = useState<Record<number, boolean>>({});
  const [chatPaymentMethodsLoading, setChatPaymentMethodsLoading] = useState(false);
  const [chatPaymentMethodsError, setChatPaymentMethodsError] = useState<string | null>(null);
  const [chatTemplateSavingMethodID, setChatTemplateSavingMethodID] = useState<number | null>(null);
  const [uiState, dispatchUi] = useReducer(tradingPanelUiReducer, undefined, () => ({
    expandedId: null,
    showNewAccountForm: false,
    newAccount: emptyAccountForm(),
    newAccountAPIKey: emptyAPIKeyForm(),
    editingAccountId: null,
    editingAccount: emptyAccountForm(),
    openSectionsByAccount: {},
    showNewFormByAccount: {},
    newTOTPByAccount: {},
    editingTOTPById: {},
    newPasskeyByAccount: {},
    editingPasskeyById: {},
    newSeedByAccount: {},
    editingSeedById: {},
    newAPIKeyByAccount: {},
    editingAPIKeyById: {},
    newBankAccountByAccount: {},
    editingBankAccountById: {},
    checkingHealthByAccount: {},
    healthMessageByAccount: {},
  }));
  const {
    expandedId,
    showNewAccountForm,
    newAccount,
    newAccountAPIKey,
    editingAccountId,
    editingAccount,
    openSectionsByAccount,
    showNewFormByAccount,
    newTOTPByAccount,
    editingTOTPById,
    newPasskeyByAccount,
    editingPasskeyById,
    newSeedByAccount,
    editingSeedById,
    newAPIKeyByAccount,
    editingAPIKeyById,
    newBankAccountByAccount,
    editingBankAccountById,
    checkingHealthByAccount,
    healthMessageByAccount,
  } = uiState;

  const setExpandedId = useCallback((value: SetStateAction<number | null>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, expandedId: resolveState(value, state.expandedId) }) });
  }, []);
  const setShowNewAccountForm = useCallback((value: SetStateAction<boolean>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, showNewAccountForm: resolveState(value, state.showNewAccountForm) }) });
  }, []);
  const setNewAccount = useCallback((value: SetStateAction<AccountFormState>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, newAccount: resolveState(value, state.newAccount) }) });
  }, []);
  const setNewAccountAPIKey = useCallback((value: SetStateAction<APIKeyFormState>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, newAccountAPIKey: resolveState(value, state.newAccountAPIKey) }) });
  }, []);
  const resetNewAccountForm = useCallback(() => {
    dispatchUi({
      type: 'UPDATE',
      update: state => ({
        ...state,
        newAccount: emptyAccountForm(),
        newAccountAPIKey: emptyAPIKeyForm(),
      }),
    });
  }, []);
  const setEditingAccountId = useCallback((value: SetStateAction<number | null>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingAccountId: resolveState(value, state.editingAccountId) }) });
  }, []);
  const setEditingAccount = useCallback((value: SetStateAction<AccountFormState>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingAccount: resolveState(value, state.editingAccount) }) });
  }, []);
  const openSection = useCallback((accountId: number, section: AccountSectionKey) => {
    dispatchUi({
      type: 'UPDATE',
      update: state => ({
        ...state,
        openSectionsByAccount: {
          ...state.openSectionsByAccount,
          [accountId]: { ...state.openSectionsByAccount[accountId], [section]: true },
        },
      }),
    });
  }, []);
  const toggleSection = useCallback((accountId: number, section: AccountSectionKey) => {
    dispatchUi({
      type: 'UPDATE',
      update: state => ({
        ...state,
        openSectionsByAccount: {
          ...state.openSectionsByAccount,
          [accountId]: {
            ...state.openSectionsByAccount[accountId],
            [section]: !state.openSectionsByAccount[accountId]?.[section],
          },
        },
      }),
    });
  }, []);
  const loadCexSection = useCallback(async (accountId: number, section: CexDataSectionKey) => {
    const field = cexSliceField(section);
    setCexDataByAccount(prev => ({
      ...prev,
      [accountId]: {
        ...prev[accountId],
        [field]: {
          loading: true,
          error: null,
          data: prev[accountId]?.[field]?.data ?? null,
        },
      },
    }));
    try {
      const data = await fetchCexSectionData(section, accountId);
      setCexDataByAccount(prev => ({
        ...prev,
        [accountId]: {
          ...prev[accountId],
          [field]: { loading: false, error: null, data },
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load CEX data';
      setCexDataByAccount(prev => ({
        ...prev,
        [accountId]: {
          ...prev[accountId],
          [field]: { loading: false, error: message, data: null },
        },
      }));
    }
  }, []);
  const toggleCexSection = useCallback((account: TradingAccount, section: CexCollapsibleSectionKey) => {
    const willOpen = !openSectionsByAccount[account.id]?.[section];
    toggleSection(account.id, section);
    if (willOpen) {
      void loadCexSection(account.id, section);
    }
  }, [loadCexSection, openSectionsByAccount, toggleSection]);
  const setShowNewForm = useCallback((accountId: number, section: NewFormKey, open: boolean) => {
    dispatchUi({
      type: 'UPDATE',
      update: state => ({
        ...state,
        showNewFormByAccount: {
          ...state.showNewFormByAccount,
          [accountId]: {
            ...state.showNewFormByAccount[accountId],
            [section]: open,
          },
        },
        openSectionsByAccount: open
          ? {
              ...state.openSectionsByAccount,
              [accountId]: { ...state.openSectionsByAccount[accountId], [section]: true },
            }
          : state.openSectionsByAccount,
      }),
    });
  }, []);
  const setNewTOTPByAccount = useCallback((value: SetStateAction<Record<number, TOTPFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, newTOTPByAccount: resolveState(value, state.newTOTPByAccount) }) });
  }, []);
  const setEditingTOTPById = useCallback((value: SetStateAction<Record<number, TOTPFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingTOTPById: resolveState(value, state.editingTOTPById) }) });
  }, []);
  const setNewPasskeyByAccount = useCallback((value: SetStateAction<Record<number, PasskeyFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, newPasskeyByAccount: resolveState(value, state.newPasskeyByAccount) }) });
  }, []);
  const setEditingPasskeyById = useCallback((value: SetStateAction<Record<number, PasskeyFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingPasskeyById: resolveState(value, state.editingPasskeyById) }) });
  }, []);
  const setNewSeedByAccount = useCallback((value: SetStateAction<Record<number, SeedFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, newSeedByAccount: resolveState(value, state.newSeedByAccount) }) });
  }, []);
  const setEditingSeedById = useCallback((value: SetStateAction<Record<number, SeedFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingSeedById: resolveState(value, state.editingSeedById) }) });
  }, []);
  const setNewAPIKeyByAccount = useCallback((value: SetStateAction<Record<number, APIKeyFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, newAPIKeyByAccount: resolveState(value, state.newAPIKeyByAccount) }) });
  }, []);
  const setEditingAPIKeyById = useCallback((value: SetStateAction<Record<number, APIKeyFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingAPIKeyById: resolveState(value, state.editingAPIKeyById) }) });
  }, []);
  const setNewBankAccountByAccount = useCallback((value: SetStateAction<Record<number, BankAccountFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, newBankAccountByAccount: resolveState(value, state.newBankAccountByAccount) }) });
  }, []);
  const setEditingBankAccountById = useCallback((value: SetStateAction<Record<number, BankAccountFormState>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingBankAccountById: resolveState(value, state.editingBankAccountById) }) });
  }, []);
  const setCheckingHealthByAccount = useCallback((value: SetStateAction<Record<number, boolean>>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, checkingHealthByAccount: resolveState(value, state.checkingHealthByAccount) }) });
  }, []);
  const dismissHealthMessage = useCallback((accountId: number) => {
    dispatchUi({
      type: 'UPDATE',
      update: state => {
        const next = { ...state.healthMessageByAccount };
        delete next[accountId];
        return { ...state, healthMessageByAccount: next };
      },
    });
  }, []);

  const groupedAccounts = useMemo(() => {
    const groups = new Map<string, TradingAccount[]>();
    for (const account of accounts) {
      const category = account.category || 'Uncategorized';
      groups.set(category, [...(groups.get(category) ?? []), account]);
    }
    return Array.from(groups.entries())
      .map(([category, groupAccounts]) => ({
        category,
        accounts: groupAccounts,
      }))
      .sort((a, b) => {
        const rankDelta = categoryRank(a.category) - categoryRank(b.category);
        return rankDelta || a.category.localeCompare(b.category);
      });
  }, [accounts]);

  const activeGroups = useMemo(
    () => {
      if (activeTab === 'payment') {
        const paymentAccounts = accounts
          .filter(account => isPaymentCategory(account.category || 'Uncategorized'))
          .sort((left, right) => left.payment_priority - right.payment_priority || left.provider.localeCompare(right.provider));
        return paymentAccounts.length > 0 ? [{ category: 'Payment accounts', accounts: paymentAccounts }] : [];
      }
      return groupedAccounts.filter(group => (TRADING_CATEGORIES as readonly string[]).includes(group.category));
    },
    [accounts, groupedAccounts, activeTab],
  );

  const paymentAccountCount = useMemo(
    () => groupedAccounts.reduce(
      (total, group) => total + (isPaymentCategory(group.category) ? group.accounts.length : 0),
      0,
    ),
    [groupedAccounts],
  );
  const activeAccounts = useMemo(
    () => activeGroups.flatMap(group => group.accounts),
    [activeGroups],
  );

  const tradingAccountCount = useMemo(
    () => groupedAccounts.reduce(
      (total, group) =>
        total + ((TRADING_CATEGORIES as readonly string[]).includes(group.category) ? group.accounts.length : 0),
      0,
    ),
    [groupedAccounts],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = withInfrastructureAccounts(await fetchTradingAccounts());
      setAccounts(next);
      setExpandedId(current => current != null && !next.some(account => account.id === current) ? null : current);
      dispatchUi({
        type: 'UPDATE',
        update: state => {
          const ids = new Set(next.map(account => account.id));
          const healthMessageByAccount = Object.fromEntries(
            Object.entries(state.healthMessageByAccount).filter(([id]) => ids.has(Number(id))),
          );
          return { ...state, healthMessageByAccount };
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trading accounts');
    } finally {
      setLoading(false);
    }
  }, [setExpandedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reorderPaymentAccountList = useCallback(async (fromAccountId: number, toAccountId: number) => {
    const paymentAccounts = activeGroups.flatMap(group => group.accounts);
    const fromIndex = paymentAccounts.findIndex(account => account.id === fromAccountId);
    const toIndex = paymentAccounts.findIndex(account => account.id === toAccountId);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = [...paymentAccounts];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setAccounts(current => current.map(account => {
      const priority = reordered.findIndex(candidate => candidate.id === account.id);
      return priority >= 0 ? { ...account, payment_priority: priority + 1 } : account;
    }));
    try {
      await reorderPaymentAccounts(reordered.map(account => account.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payment account order');
      await load();
    }
  }, [activeGroups, load]);

  const loadBisqPaymentAccounts = useCallback(async () => {
    const response = await fetchBisqPaymentAccounts();
    setBisqPmAccounts(response.payment_accounts);
  }, []);

  // Load the three independent sources needed by the creation flow: daemon accounts,
  // daemon-supported methods, and the local availability/link catalog.
  const loadBisqPaymentMethods = useCallback(async () => {
    setBisqPmLoading(true);
    setBisqPmError(null);
    try {
      const [bisq, supported, catalog] = await Promise.all([
        fetchBisqPaymentAccounts(),
        fetchBisqPaymentMethods(),
        fetchPaymentMethods(),
      ]);
      setBisqPmAccounts(bisq.payment_accounts);
      setBisqSupportedMethods(supported.payment_methods);
      setBisqCatalogRows(catalog.payment_methods);
      setBisqPmLoaded(true);
    } catch (err) {
      setBisqPmError(err instanceof Error ? err.message : 'Failed to load bisq payment methods');
      setBisqPmLoaded(true);
    } finally {
      setBisqPmLoading(false);
    }
  }, []);

  const loadChatPaymentMethods = useCallback(async () => {
    setChatPaymentMethodsLoading(true);
    setChatPaymentMethodsError(null);
    try {
      const { payment_methods: methods } = await fetchPaymentMethods();
      const templates = await Promise.all(methods.map(async method => {
        const response = await fetchPaymentMethodChatTemplates(method.id);
        return [method.id, response.chat_templates] as const;
      }));
      setChatPaymentMethods(methods);
      setChatTemplatesByMethod(Object.fromEntries(templates));
      setChatTemplateDrafts({});
    } catch (err) {
      setChatPaymentMethodsError(err instanceof Error ? err.message : 'Failed to load chat payment methods');
    } finally {
      setChatPaymentMethodsLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, [activeTab]);

  const selectedAccount = useMemo(
    () => accounts.find(account => account.id === expandedId) ?? null,
    [accounts, expandedId],
  );

  useEffect(() => {
    if (activeTab === 'communication' || loading) {
      return;
    }
    if (activeAccounts.length === 0) {
      if (expandedId != null) {
        setExpandedId(null);
      }
      return;
    }
    if (!activeAccounts.some(account => account.id === expandedId)) {
      setExpandedId(activeAccounts[0].id);
    }
  }, [activeAccounts, activeTab, expandedId, loading, setExpandedId]);

  const loadLndWalletStatus = useCallback(async () => {
    setLndWalletLoading(true);
    setLndWalletError(null);
    setLndWalletNotice(null);
    try {
      const status = await fetchLNDWalletStatus();
      // The mm-controller API serializes empty Go slices as null, but the type
      // (and every render path below) assumes arrays. Normalize so a wallet with
      // no channels/peers/addresses doesn't crash the panel.
      setLndWalletStatus(
        status
          ? {
              ...status,
              peers: status.peers ?? [],
              channels: status.channels ?? [],
              pending_channels: status.pending_channels ?? [],
              addresses: status.addresses ?? [],
            }
          : status,
      );
    } catch (err) {
      setLndWalletStatus(null);
      setLndWalletError(err instanceof Error ? err.message : 'Failed to load LND wallet status');
    } finally {
      setLndWalletLoading(false);
    }
  }, []);

  const loadLndWalletState = useCallback(async (): Promise<LNDWalletState | null> => {
    setLndWalletStateLoading(true);
    try {
      const state = await fetchLNDWalletState();
      setLndWalletState(state);
      return state;
    } catch {
      setLndWalletState(null);
      return null;
    } finally {
      setLndWalletStateLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'trading') return;
    void fetchServiceVersions().then(setServiceVersions).catch(() => setServiceVersions(null));
  }, [activeTab]);

  const handleOpenChannel = useCallback(async () => {
    setOpeningChannel(true);
    setLndWalletError(null);
    setLndWalletNotice(null);
    try {
      const result = await openLNDChannel({
        node_pubkey: openChannelForm.nodePubkey.trim(),
        peer_host: openChannelForm.peerHost.trim() || undefined,
        local_funding_amount_sat: Number(openChannelForm.localFundingAmountSat),
        push_sat: Number(openChannelForm.pushSat || 0),
        sat_per_vbyte: Number(openChannelForm.satPerVbyte || 2),
        private: openChannelForm.private,
      });
      setOpenChannelForm(emptyOpenChannelForm());
      await loadLndWalletStatus();
      setLndWalletNotice(`Channel opening submitted. Funding tx: ${result.funding_txid || 'pending'}`);
    } catch (err) {
      setLndWalletError(err instanceof Error ? err.message : 'Failed to open channel');
    } finally {
      setOpeningChannel(false);
    }
  }, [loadLndWalletStatus, openChannelForm]);

  const handleCloseChannel = useCallback(async (channelPoint: string, force: boolean) => {
    const label = force ? 'Force-close this channel?' : 'Cooperatively close this channel?';
    if (!window.confirm(label)) {
      return;
    }
    setClosingChannelPoint(channelPoint);
    setLndWalletError(null);
    setLndWalletNotice(null);
    try {
      const result = await closeLNDChannel({
        channel_point: channelPoint,
        force,
        sat_per_vbyte: 2,
      });
      await loadLndWalletStatus();
      setLndWalletNotice(`Channel close submitted. Closing tx: ${result.closing_txid || 'pending'}`);
    } catch (err) {
      setLndWalletError(err instanceof Error ? err.message : 'Failed to close channel');
    } finally {
      setClosingChannelPoint(null);
    }
  }, [loadLndWalletStatus]);

  useEffect(() => {
    if (!selectedAccount || !isLndWalletProvider(selectedAccount.provider)) {
      return;
    }
    void (async () => {
      const state = await loadLndWalletState();
      if (state?.client_ready) {
        await loadLndWalletStatus();
      } else {
        setLndWalletStatus(null);
      }
    })();
  }, [selectedAccount, loadLndWalletState, loadLndWalletStatus]);

  useEffect(() => {
    if (!selectedAccount || !isCexAccount(selectedAccount)) {
      return;
    }
    void loadCexSection(selectedAccount.id, 'cexDepositAddresses');
    void loadCexSection(selectedAccount.id, 'cexBalances');
  }, [selectedAccount, loadCexSection]);

  const withReload = async (fn: () => Promise<void>) => {
    try {
      setError(null);
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trading accounts request failed');
    }
  };

  const setNotificationChannel = async (
    account: TradingAccount,
    channel: 'push' | 'email',
    enabled: boolean,
  ) => {
    const nextChannels = new Set(account.notification_channels ?? []);
    if (enabled) nextChannels.add(channel);
    else nextChannels.delete(channel);
    setSavingNotificationChannelsByAccount(prev => ({ ...prev, [account.id]: true }));
    try {
      setError(null);
      await updateAccount(account.id, {
        provider: account.provider,
        category: account.category,
        email: account.email ?? '',
        password: account.password ?? '',
        phone: account.phone ?? '',
        payment_tag: account.payment_tag ?? '',
        notification_channels: ['push', 'email'].filter(
          candidate => nextChannels.has(candidate as 'push' | 'email'),
        ) as Array<'push' | 'email'>,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save notification channels');
    } finally {
      setSavingNotificationChannelsByAccount(prev => ({ ...prev, [account.id]: false }));
    }
  };

  // Existing-account actions refresh only the saved daemon list, leaving any in-progress
  // creation form untouched.
  const runBisqAction = async (busyKey: string, fn: () => Promise<void>) => {
    setBisqPmBusyKey(busyKey);
      setBisqPmError(null);
    try {
      await fn();
      await loadBisqPaymentAccounts();
    } catch (err) {
      setBisqPmError(err instanceof Error ? err.message : 'Bisq payment request failed');
    } finally {
      setBisqPmBusyKey(null);
    }
  };

  const resetBisqCreateForm = () => {
    bisqFormRequestID.current += 1;
    setBisqSelectedMethodID('');
    setBisqAccountForm(null);
    setBisqFormValues({});
    setBisqFormStep('edit');
    setBisqFormLoading(false);
  };

  const handleBisqMethodSelection = async (methodID: string) => {
    const requestID = bisqFormRequestID.current + 1;
    bisqFormRequestID.current = requestID;
    setBisqSelectedMethodID(methodID);
    setBisqAccountForm(null);
    setBisqFormValues({});
    setBisqFormStep('edit');
    setBisqPmError(null);
    if (!methodID) {
      setBisqFormLoading(false);
      return;
    }

    setBisqFormLoading(true);
    try {
      const form = await fetchBisqPaymentAccountForm(methodID);
      if (requestID !== bisqFormRequestID.current) return;
      setBisqAccountForm(form);
      if (!form.supported) {
        setBisqFormValues({});
        return;
      }

      const values = cleanBisqTemplateValues(form);
      // Make the daemon form usable immediately. Local secret reads below are best-effort
      // prefills and must never prevent manual entry.
      setBisqFormValues({ ...values });
      const catalogRow = catalogRowForBisqMethod(methodID, bisqCatalogRows);
      const bank = catalogRow?.bank_account_id == null
        ? undefined
        : accounts.flatMap(candidate => candidate.bank_accounts)
          .find(candidate => candidate.id === catalogRow.bank_account_id);
      const bankOwner = bank ? accounts.find(candidate => candidate.id === bank.account_id) : undefined;
      let revealedBank = bank;
      if (bankOwner && bank) {
        try {
          const revealedAccount = revealedAccountSecretsByAccount[bankOwner.id]
            ?? await revealTradingAccountSecrets(bankOwner.id);
          if (requestID !== bisqFormRequestID.current) return;
          setRevealedAccountSecretsByAccount(current => ({ ...current, [bankOwner.id]: revealedAccount }));
          revealedBank = revealedAccount.bank_accounts.find(candidate => candidate.id === bank.id) ?? bank;
        } catch {
          // Keep the blank editable form when local secrets cannot be revealed.
        }
      }

      const linkedAccount = catalogRow?.account_id == null
        ? undefined
        : accounts.find(candidate => candidate.id === catalogRow.account_id);
      let credentials = linkedAccount ? revealedCredentialsByAccount[linkedAccount.id] : undefined;
      if (linkedAccount && !credentials) {
        try {
          credentials = await revealTradingAccountCredentials(linkedAccount.id);
          if (requestID !== bisqFormRequestID.current) return;
          setRevealedCredentialsByAccount(current => ({ ...current, [linkedAccount.id]: credentials! }));
        } catch {
          // A prefill miss is not a form-loading failure; the user can enter values manually.
        }
      }

      const put = (field: string, value: string | null | undefined) => {
        const trimmed = value?.trim();
        if (field in values && trimmed) values[field] = trimmed;
      };
      if (revealedBank) {
        for (const field of Object.keys(values)) put(field, findDetail(revealedBank.details, field));
        put('accountName', `${bisqPaymentMethodLabel(methodID)} ${revealedBank.label || revealedBank.owner_name}`);
        put('holderName', revealedBank.owner_name);
        put('bankAccountName', revealedBank.owner_name);
        put('contact', revealedBank.owner_name);
        put('iban', revealedBank.details.iban);
        put('bic', revealedBank.details.bic);
        put('country', revealedBank.country);
        put('tradeCurrencies', revealedBank.currency);
        put('selectedTradeCurrency', revealedBank.currency);
      }
      if (linkedAccount && credentials) {
        put('accountName', `${bisqPaymentMethodLabel(methodID)} ${linkedAccount.provider}`);
        put('email', credentials.email);
        put('userName', credentials.payment_tag || credentials.email);
        put('holderName', credentials.payment_tag);
        put('phone', credentials.phone);
        put('mobileNr', credentials.phone);
        put('accountId', credentials.payment_tag);
        put('accountNr', credentials.payment_tag);
        put('cashTag', credentials.payment_tag);
      }
      setBisqFormValues({ ...values });
    } catch (err) {
      if (requestID === bisqFormRequestID.current) {
        setBisqPmError(err instanceof Error ? err.message : 'Failed to load Bisq payment account form');
      }
    } finally {
      if (requestID === bisqFormRequestID.current) setBisqFormLoading(false);
    }
  };

  const confirmBisqPaymentAccount = async () => {
    if (!bisqAccountForm?.supported || !bisqSelectedMethodID) return;
    setBisqPmBusyKey('create-confirm');
    setBisqPmError(null);
    try {
      await createBisqPaymentAccount({
        payment_method_id: bisqSelectedMethodID,
        fields: bisqFormValues,
      });
      await loadBisqPaymentAccounts();
      resetBisqCreateForm();
    } catch (err) {
      // Intentionally keep the review step and entered values for correction/retry.
      setBisqPmError(err instanceof Error ? err.message : 'Bisq payment account creation failed');
    } finally {
      setBisqPmBusyKey(null);
    }
  };

  const handleCreateWallet = useCallback(
    async (account: TradingAccount) => {
      if (walletPassword.length < 8) {
        setLndWalletError('Wallet password must be at least 8 characters.');
        return;
      }
      if (walletPassword !== walletPasswordConfirm) {
        setLndWalletError('Passwords do not match.');
        return;
      }
      setCreatingWallet(true);
      setLndWalletError(null);
      setLndWalletNotice(null);
      try {
        // Save the password through the unified-api accounts path, then ask
        // mm-controller to generate the wallet from it.
        await updateAccount(account.id, {
          provider: account.provider,
          email: account.email ?? '',
          password: walletPassword,
          phone: account.phone ?? '',
          payment_tag: account.payment_tag ?? '',
        });
        const result = await initLNDWallet();
        setWalletPassword('');
        setWalletPasswordConfirm('');
        setLndWalletNotice(
          result.primary_address
            ? `Wallet created. Primary deposit address: ${result.primary_address}`
            : 'Wallet created.',
        );
        const state = await loadLndWalletState();
        if (state?.client_ready) {
          await loadLndWalletStatus();
        }
        await load();
      } catch (err) {
        setLndWalletError(err instanceof Error ? err.message : 'Failed to create wallet');
      } finally {
        setCreatingWallet(false);
      }
    },
    [walletPassword, walletPasswordConfirm, loadLndWalletState, loadLndWalletStatus, load],
  );

  const triggerHealthCheck = async (account: TradingAccount) => {
    setCheckingHealthByAccount(prev => ({ ...prev, [account.id]: true }));
    setError(null);
    try {
      const result = await runAccountHealthCheck(account.id);
      setAccounts(prev => prev.map(item => (item.id === result.account.id ? result.account : item)));
      dispatchUi({
        type: 'UPDATE',
        update: state => ({
          ...state,
          healthMessageByAccount: {
            ...state.healthMessageByAccount,
            [account.id]: {
              message: result.message,
              healthy: result.healthy,
              keys: result.keys,
            },
          },
        }),
      });
      if (result.keys && result.keys.length > 0 && account.api_keys.length > 0) {
        setExpandedId(account.id);
        openSection(account.id, 'apiKeys');
      }
    } catch (err) {
      dispatchUi({
        type: 'UPDATE',
        update: state => ({
          ...state,
          healthMessageByAccount: {
            ...state.healthMessageByAccount,
            [account.id]: {
              message: err instanceof Error ? err.message : 'Health check failed',
              healthy: false,
            },
          },
        }),
      });
    } finally {
      setCheckingHealthByAccount(prev => {
        const next = { ...prev };
        delete next[account.id];
        return next;
      });
    }
  };

  const toggleCredentialReveal = async (account: TradingAccount, field: CredentialField) => {
    if (visibleCredentialFieldsByAccount[account.id]?.[field]) {
      setVisibleCredentialFieldsByAccount(prev => ({
        ...prev,
        [account.id]: { ...prev[account.id], [field]: false },
      }));
      return;
    }

    if (!revealedCredentialsByAccount[account.id]) {
      setRevealingCredentialsByAccount(prev => ({ ...prev, [account.id]: true }));
      setError(null);
      try {
        const credentials = await revealTradingAccountCredentials(account.id);
        setRevealedCredentialsByAccount(prev => ({ ...prev, [account.id]: credentials }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reveal account credentials');
        setRevealingCredentialsByAccount(prev => ({ ...prev, [account.id]: false }));
        return;
      } finally {
        setRevealingCredentialsByAccount(prev => ({ ...prev, [account.id]: false }));
      }
    }

    setVisibleCredentialFieldsByAccount(prev => ({
      ...prev,
      [account.id]: { ...prev[account.id], [field]: true },
    }));
  };

  const toggleAccountSecretReveal = async (account: TradingAccount, field: string) => {
    if (visibleAccountSecretsByAccount[account.id]?.[field]) {
      setVisibleAccountSecretsByAccount(prev => ({ ...prev, [account.id]: { ...prev[account.id], [field]: false } }));
      return;
    }
    if (!revealedAccountSecretsByAccount[account.id]) {
      setRevealingCredentialsByAccount(prev => ({ ...prev, [account.id]: true }));
      setError(null);
      try {
        const revealed = await revealTradingAccountSecrets(account.id);
        setRevealedAccountSecretsByAccount(prev => ({ ...prev, [account.id]: revealed }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reveal account secrets');
        return;
      } finally {
        setRevealingCredentialsByAccount(prev => ({ ...prev, [account.id]: false }));
      }
    }
    setVisibleAccountSecretsByAccount(prev => ({ ...prev, [account.id]: { ...prev[account.id], [field]: true } }));
  };

  const toggleLocalSecretVisibility = (accountID: number, field: string) => {
    setVisibleAccountSecretsByAccount(prev => ({
      ...prev,
      [accountID]: { ...prev[accountID], [field]: !prev[accountID]?.[field] },
    }));
  };

  const startAccountEdit = (account: TradingAccount) => {
    setEditingAccountId(account.id);
    setEditingAccount({
      provider: account.provider,
      category: account.category,
      email: account.email ?? '',
      password: account.password ?? '',
      phone: account.phone ?? '',
      payment_tag: account.payment_tag ?? '',
    });
  };

  const renderTOTPSection = (account: TradingAccount) => {
    if (!showDexIdentitySections(account.provider)) {
      return null;
    }
    const draft = newTOTPByAccount[account.id] ?? { secret: '', is_active: true };
    const open = !!openSectionsByAccount[account.id]?.totp;
    const showNew = !!showNewFormByAccount[account.id]?.totp;
    return (
      <CollapsibleSection
        title="TOTP Secrets"
        count={account.totp_secrets.length}
        open={open}
        onToggle={() => toggleSection(account.id, 'totp')}
        actions={
          <button
            type="button"
            className={compactButtonCls}
            onClick={() => setShowNewForm(account.id, 'totp', !showNew)}
          >
            {showNew ? 'Cancel' : 'Add'}
          </button>
        }
      >
        {account.totp_secrets.map(secret => {
          const edit = editingTOTPById[secret.id];
          const secretField = `totp:${secret.id}`;
          const revealedSecret = revealedAccountSecretsByAccount[account.id]?.totp_secrets.find(item => item.id === secret.id)?.secret;
          const secretVisible = visibleAccountSecretsByAccount[account.id]?.[secretField] === true;
          return (
            <SecretItem
              key={secret.id}
              forceOpen={!!edit}
              title={`Secret #${secret.id}`}
              meta={secret.is_active ? 'Active' : 'Inactive'}
              summary={secret.secret.length > 48 ? `${secret.secret.slice(0, 48)}…` : secret.secret}
              actions={
                !edit ? (
                  <>
                    <button
                      type="button"
                      className={compactButtonCls}
                      onClick={() =>
                        setEditingTOTPById(prev => ({
                          ...prev,
                          [secret.id]: { secret: secret.secret, is_active: secret.is_active },
                        }))
                      }
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${compactButtonCls} text-red`}
                      onClick={() => withReload(async () => { await deleteTOTPSecret(secret.id); })}
                    >
                      Del
                    </button>
                  </>
                ) : null
              }
            >
              {edit ? (
                <div className="grid gap-1.5">
                  <textarea
                    className={textareaCls}
                    value={edit.secret}
                    onChange={e => setEditingTOTPById(prev => ({ ...prev, [secret.id]: { ...edit, secret: e.target.value } }))}
                  />
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={edit.is_active}
                      onChange={e => setEditingTOTPById(prev => ({ ...prev, [secret.id]: { ...edit, is_active: e.target.checked } }))}
                    />
                    Active
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className={compactButtonCls}
                      onClick={() =>
                        withReload(async () => {
                          await updateTOTPSecret(secret.id, edit);
                          setEditingTOTPById(prev => {
                            const next = { ...prev };
                            delete next[secret.id];
                            return next;
                          });
                        })
                      }
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className={compactButtonCls}
                      onClick={() =>
                        setEditingTOTPById(prev => {
                          const next = { ...prev };
                          delete next[secret.id];
                          return next;
                        })
                      }
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-1">
                  <div className="flex items-start gap-1">
                    <pre className="min-w-0 flex-1 overflow-x-auto rounded border border-border bg-surface p-2 text-[0.65rem] text-text whitespace-pre-wrap break-all">{secretVisible ? revealedSecret : '••••••••'}</pre>
                    <button type="button" className="text-muted hover:text-text" aria-label={secretVisible ? 'Hide TOTP secret' : 'Show TOTP secret'} onClick={() => void toggleAccountSecretReveal(account, secretField)} disabled={revealingCredentialsByAccount[account.id] === true}>👁</button>
                  </div>
                  <div className="text-[0.65rem] text-muted">Created {formatDate(secret.created_at)}</div>
                </div>
              )}
            </SecretItem>
          );
        })}
        {showNew ? (
          <ResourceCard title="New TOTP">
            <div className="grid gap-1.5">
              <textarea
                className={textareaCls}
                value={draft.secret}
                onChange={e => setNewTOTPByAccount(prev => ({ ...prev, [account.id]: { ...draft, secret: e.target.value } }))}
                placeholder="TOTP secret"
              />
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={e => setNewTOTPByAccount(prev => ({ ...prev, [account.id]: { ...draft, is_active: e.target.checked } }))}
                />
                Active
              </label>
              <div className="flex justify-end">
                <button
                  type="button"
                  className={compactButtonCls}
                  onClick={() =>
                    withReload(async () => {
                      await createTOTPSecret(account.id, draft);
                      setNewTOTPByAccount(prev => ({ ...prev, [account.id]: { secret: '', is_active: true } }));
                      setShowNewForm(account.id, 'totp', false);
                    })
                  }
                >
                  Create
                </button>
              </div>
            </div>
          </ResourceCard>
        ) : null}
        {!showNew && account.totp_secrets.length === 0 ? (
          <div className="text-[0.65rem] text-muted px-1">No TOTP secrets yet.</div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderPasskeysSection = (account: TradingAccount) => {
    if (!showDexIdentitySections(account.provider)) {
      return null;
    }
    const draft = newPasskeyByAccount[account.id] ?? {
      credential_id: '',
      rp_id: '',
      private_key_pkcs8: '',
      user_handle: '',
      sign_count: '0',
      is_active: true,
      last_used_at: '',
    };
    const open = !!openSectionsByAccount[account.id]?.passkeys;
    const showNew = !!showNewFormByAccount[account.id]?.passkeys;
    return (
      <CollapsibleSection
        title="Passkeys"
        count={account.passkey_credentials.length}
        open={open}
        onToggle={() => toggleSection(account.id, 'passkeys')}
        actions={
          <button type="button" className={compactButtonCls} onClick={() => setShowNewForm(account.id, 'passkeys', !showNew)}>
            {showNew ? 'Cancel' : 'Add'}
          </button>
        }
      >
        {account.passkey_credentials.map(cred => {
          const edit = editingPasskeyById[cred.id];
          const passkeyField = `passkey:${cred.id}`;
          const credentialIDField = `passkey:${cred.id}:credential-id`;
          const userHandleField = `passkey:${cred.id}:user-handle`;
          const revealedPrivateKey = revealedAccountSecretsByAccount[account.id]?.passkey_credentials.find(item => item.id === cred.id)?.private_key_pkcs8;
          const form = edit ?? {
            credential_id: cred.credential_id,
            rp_id: cred.rp_id,
            private_key_pkcs8: cred.private_key_pkcs8,
            user_handle: cred.user_handle,
            sign_count: String(cred.sign_count),
            is_active: cred.is_active,
            last_used_at: cred.last_used_at ?? '',
          };
          return (
            <SecretItem
              key={cred.id}
              forceOpen={!!edit}
              title={cred.rp_id || `Passkey #${cred.id}`}
              meta={cred.is_active ? 'Active' : 'Inactive'}
              summary="Passkey credential stored"
              actions={
                !edit ? (
                  <>
                    <button type="button" className={compactButtonCls} onClick={() => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: form }))}>Edit</button>
                    <button type="button" className={`${compactButtonCls} text-red`} onClick={() => withReload(async () => { await deletePasskey(cred.id); })}>Del</button>
                  </>
                ) : null
              }
            >
              {edit ? (
                <>
                  <div className="grid gap-1.5 md:grid-cols-2">
                    <input className={compactInputCls} value={form.credential_id} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, credential_id: e.target.value } }))} placeholder="Credential ID" />
                    <input className={compactInputCls} value={form.rp_id} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, rp_id: e.target.value } }))} placeholder="RP ID" />
                    <input className={compactInputCls} value={form.user_handle} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, user_handle: e.target.value } }))} placeholder="User handle" />
                    <input className={compactInputCls} value={form.sign_count} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, sign_count: e.target.value } }))} placeholder="Sign count" />
                    <input className={`${compactInputCls} md:col-span-2`} value={form.last_used_at} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, last_used_at: e.target.value } }))} placeholder="Last used at (ISO)" />
                    <label className="flex items-center gap-2 text-xs text-muted md:col-span-2">
                      <input type="checkbox" checked={form.is_active} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, is_active: e.target.checked } }))} />
                      Active
                    </label>
                    <textarea className={`${textareaCls} md:col-span-2`} value={form.private_key_pkcs8} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, private_key_pkcs8: e.target.value } }))} placeholder="Private key PKCS8" />
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button type="button" className={compactButtonCls} onClick={() => withReload(async () => {
                      await updatePasskey(cred.id, {
                        credential_id: form.credential_id,
                        rp_id: form.rp_id,
                        private_key_pkcs8: form.private_key_pkcs8,
                        user_handle: form.user_handle,
                        sign_count: Number(form.sign_count || 0),
                        is_active: form.is_active,
                        last_used_at: form.last_used_at || null,
                      });
                      setEditingPasskeyById(prev => { const next = { ...prev }; delete next[cred.id]; return next; });
                    })}>Save</button>
                    <button type="button" className={compactButtonCls} onClick={() => setEditingPasskeyById(prev => { const next = { ...prev }; delete next[cred.id]; return next; })}>Cancel</button>
                  </div>
                </>
              ) : (
                <div className="grid gap-1 text-[0.65rem] text-muted sm:grid-cols-2">
                  <div className="flex min-w-0 items-center gap-1 sm:col-span-2"><span className="min-w-0 truncate"><span className="text-text">Credential:</span> {visibleAccountSecretsByAccount[account.id]?.[credentialIDField] ? cred.credential_id : '••••••••'}</span><button type="button" className="text-muted hover:text-text" aria-label={visibleAccountSecretsByAccount[account.id]?.[credentialIDField] ? 'Hide passkey credential ID' : 'Show passkey credential ID'} onClick={() => toggleLocalSecretVisibility(account.id, credentialIDField)}>👁</button></div>
                  <div className="flex min-w-0 items-center gap-1"><span className="min-w-0 truncate"><span className="text-text">User handle:</span> {cred.user_handle ? (visibleAccountSecretsByAccount[account.id]?.[userHandleField] ? cred.user_handle : '••••••••') : '—'}</span>{cred.user_handle ? <button type="button" className="text-muted hover:text-text" aria-label={visibleAccountSecretsByAccount[account.id]?.[userHandleField] ? 'Hide passkey user handle' : 'Show passkey user handle'} onClick={() => toggleLocalSecretVisibility(account.id, userHandleField)}>👁</button> : null}</div>
                  <div><span className="text-text">Sign count:</span> {cred.sign_count}</div>
                  <div><span className="text-text">Last used:</span> {formatDate(cred.last_used_at)}</div>
                  <div><span className="text-text">Created:</span> {formatDate(cred.created_at)}</div>
                  <div className="flex items-center gap-1 sm:col-span-2"><span><span className="text-text">Private key:</span> {visibleAccountSecretsByAccount[account.id]?.[passkeyField] ? revealedPrivateKey : '••••••••'}</span><button type="button" className="text-muted hover:text-text" aria-label={visibleAccountSecretsByAccount[account.id]?.[passkeyField] ? 'Hide passkey private key' : 'Show passkey private key'} onClick={() => void toggleAccountSecretReveal(account, passkeyField)} disabled={revealingCredentialsByAccount[account.id] === true}>👁</button></div>
                </div>
              )}
            </SecretItem>
          );
        })}
        {showNew ? (
          <ResourceCard title="New Passkey">
            <div className="grid gap-1.5 md:grid-cols-2">
              <input className={compactInputCls} value={draft.credential_id} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, credential_id: e.target.value } }))} placeholder="Credential ID" />
              <input className={compactInputCls} value={draft.rp_id} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, rp_id: e.target.value } }))} placeholder="RP ID" />
              <input className={compactInputCls} value={draft.user_handle} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, user_handle: e.target.value } }))} placeholder="User handle" />
              <input className={compactInputCls} value={draft.sign_count} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, sign_count: e.target.value } }))} placeholder="Sign count" />
              <input className={`${compactInputCls} md:col-span-2`} value={draft.last_used_at} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, last_used_at: e.target.value } }))} placeholder="Last used at (ISO)" />
              <label className="flex items-center gap-2 text-xs text-muted md:col-span-2">
                <input type="checkbox" checked={draft.is_active} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, is_active: e.target.checked } }))} />
                Active
              </label>
              <textarea className={`${textareaCls} md:col-span-2`} value={draft.private_key_pkcs8} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, private_key_pkcs8: e.target.value } }))} placeholder="Private key PKCS8" />
            </div>
            <div className="mt-1.5 flex justify-end">
              <button type="button" className={compactButtonCls} onClick={() => withReload(async () => {
                await createPasskey(account.id, {
                  credential_id: draft.credential_id,
                  rp_id: draft.rp_id,
                  private_key_pkcs8: draft.private_key_pkcs8,
                  user_handle: draft.user_handle,
                  sign_count: Number(draft.sign_count || 0),
                  is_active: draft.is_active,
                  last_used_at: draft.last_used_at || null,
                });
                setNewPasskeyByAccount(prev => ({
                  ...prev,
                  [account.id]: { credential_id: '', rp_id: '', private_key_pkcs8: '', user_handle: '', sign_count: '0', is_active: true, last_used_at: '' },
                }));
                setShowNewForm(account.id, 'passkeys', false);
              })}>Create</button>
            </div>
          </ResourceCard>
        ) : null}
        {!showNew && account.passkey_credentials.length === 0 ? (
          <div className="text-[0.65rem] text-muted px-1">No passkeys yet.</div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderLNDBackupSection = (account: TradingAccount) => {
    const backup = account.lnd_channel_backup;
    const seed = account.seeds[0];
    const open = openSectionsByAccount[account.id]?.lndBackup ?? true;
    const backupItems = Number(!!account.password) + Number(!!seed) + Number(!!backup);

    return (
      <CollapsibleSection
        title="Backup"
        count={backupItems}
        open={open}
        onToggle={() => toggleSection(account.id, 'lndBackup')}
      >
        <p className="text-[0.65rem] text-muted leading-relaxed px-1">
          Disaster-recovery material stored for this wallet: password, aezeed seed, and static channel backup metadata.
        </p>
        <div className="grid gap-1.5">
          <BackupField title="Wallet password">
            {account.password ? (
              <SecretRevealValue
                value={revealedCredentialsByAccount[account.id]?.password}
                visible={visibleCredentialFieldsByAccount[account.id]?.password === true}
                onToggle={() => void toggleCredentialReveal(account, 'password')}
                disabled={revealingCredentialsByAccount[account.id] === true}
                revealLabel="wallet password"
              />
            ) : (
              <div className="text-[0.65rem] text-muted">Set the wallet password in Account → Edit before starting mm-controller.</div>
            )}
          </BackupField>

          <BackupField title="Aezeed seed" meta={seed ? formatDate(seed.created_at) : undefined}>
            {seed ? (
              <SecretRevealValue
                value={revealedAccountSecretsByAccount[account.id]?.seeds.find(item => item.id === seed.id)?.seed_phrase}
                visible={visibleAccountSecretsByAccount[account.id]?.[`seed:${seed.id}`] === true}
                onToggle={() => void toggleAccountSecretReveal(account, `seed:${seed.id}`)}
                disabled={revealingCredentialsByAccount[account.id] === true}
                revealLabel="aezeed seed"
              />
            ) : (
              <div className="text-[0.65rem] text-muted">
                No aezeed stored yet — set the wallet password and start mm-controller to generate one.
              </div>
            )}
          </BackupField>

          <BackupField title="Channel backup" meta={backup ? formatDate(backup.created_at) : undefined}>
            {backup ? (
              <div className="rounded border border-border bg-surface px-2 py-1.5 grid gap-1 text-xs text-muted sm:grid-cols-2">
                <div><span className="text-text">Channels:</span> {backup.channel_count}</div>
                <div><span className="text-text">Backed up:</span> {formatDate(backup.created_at)}</div>
                <div><span className="text-text">Size:</span> {formatFileSize(backup.backup_size_bytes)}</div>
                <div className="sm:col-span-2"><span className="text-text">SHA256:</span> {backup.backup_sha256}</div>
              </div>
            ) : (
              <div className="text-[0.65rem] text-muted">
                No static channel backup in the database yet — mm-controller exports after LND starts.
              </div>
            )}
          </BackupField>
        </div>
      </CollapsibleSection>
    );
  };

  const renderLightningManagementSection = (account: TradingAccount) => {
    const open = openSectionsByAccount[account.id]?.lightningManagement ?? true;
    const channelCount = lndWalletStatus?.channels?.length ?? 0;
    const state = lndWalletState;
    const stillLoading = lndWalletStateLoading && !state;
    const showWizard = state?.can_create ?? false;
    const showLockedNotice = !!state && state.wallet_exists && !state.client_ready;
    const showUnreachable = !!state && !state.lnd_reachable && !state.wallet_exists && !state.can_create;
    const showManagement = state?.client_ready ?? false;
    return (
      <CollapsibleSection
        title="Lightning management"
        count={channelCount}
        open={open}
        onToggle={() => toggleSection(account.id, 'lightningManagement')}
        actions={
          <button
            type="button"
            className={compactButtonCls}
            disabled={lndWalletLoading}
            onClick={() => void loadLndWalletStatus()}
          >
            {lndWalletLoading ? '…' : 'Refresh'}
          </button>
        }
      >
        {showManagement ? (
          <p className="text-[0.65rem] text-muted leading-relaxed px-1">
            Live channel and peer status from LND via mm-controller. Open or close channels below.
          </p>
        ) : null}
        {lndWalletNotice ? (
          <div className="text-[0.65rem] text-green px-1">{lndWalletNotice}</div>
        ) : null}
        {lndWalletError ? (
          <div className="text-[0.65rem] text-red px-1">{lndWalletError}</div>
        ) : null}
        {stillLoading ? (
          <div className="text-[0.65rem] text-muted px-1">Checking wallet status…</div>
        ) : null}
        {showWizard ? (
          <div className="grid gap-2 rounded border border-border bg-bg px-2 py-2">
            <div className="text-xs font-semibold text-text">Create a new Lightning wallet</div>
            <p className="text-[0.65rem] text-muted leading-relaxed">
              No LND wallet exists yet. Choose a wallet password (min. 8 characters) — it
              encrypts the wallet and is required to unlock it on every restart. mm-controller
              generates a fresh 24-word seed and stores it under this account&apos;s backup.
            </p>
            <input
              type="password"
              autoComplete="new-password"
              className={compactInputCls}
              value={walletPassword}
              onChange={e => setWalletPassword(e.target.value)}
              placeholder="Wallet password"
            />
            <input
              type="password"
              autoComplete="new-password"
              className={compactInputCls}
              value={walletPasswordConfirm}
              onChange={e => setWalletPasswordConfirm(e.target.value)}
              placeholder="Confirm password"
            />
            <div className="flex justify-end">
              <button
                type="button"
                className={compactPrimaryButtonCls}
                disabled={
                  creatingWallet ||
                  walletPassword.length < 8 ||
                  walletPassword !== walletPasswordConfirm
                }
                onClick={() => void handleCreateWallet(account)}
              >
                {creatingWallet ? 'Creating…' : 'Create wallet'}
              </button>
            </div>
          </div>
        ) : null}
        {showLockedNotice ? (
          <div className="text-[0.65rem] text-red px-1 leading-relaxed">
            LND wallet is unavailable: {state?.last_init_error || 'mm-controller has not completed LND initialization yet.'}
          </div>
        ) : null}
        {showUnreachable ? (
          <div className="text-[0.65rem] text-muted px-1">
            LND is not reachable yet. Wait for the node to start, then refresh.
          </div>
        ) : null}
        {showManagement ? (
          <>
        <SecretItem title="Open channel" summary="Expand to connect to a hub and fund a new channel">
          <div className="grid gap-1.5 md:grid-cols-2">
            <input
              className={compactInputCls}
              value={openChannelForm.nodePubkey}
              onChange={e => setOpenChannelForm(prev => ({ ...prev, nodePubkey: e.target.value }))}
              placeholder="Hub node pubkey"
            />
            <input
              className={compactInputCls}
              value={openChannelForm.peerHost}
              onChange={e => setOpenChannelForm(prev => ({ ...prev, peerHost: e.target.value }))}
              placeholder="Peer host (ip:9735)"
            />
            <input
              className={compactInputCls}
              value={openChannelForm.localFundingAmountSat}
              onChange={e => setOpenChannelForm(prev => ({ ...prev, localFundingAmountSat: e.target.value }))}
              placeholder="Local funding (sats)"
            />
            <input
              className={compactInputCls}
              value={openChannelForm.pushSat}
              onChange={e => setOpenChannelForm(prev => ({ ...prev, pushSat: e.target.value }))}
              placeholder="Push amount (sats)"
            />
            <input
              className={compactInputCls}
              value={openChannelForm.satPerVbyte}
              onChange={e => setOpenChannelForm(prev => ({ ...prev, satPerVbyte: e.target.value }))}
              placeholder="Fee rate (sat/vB)"
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={openChannelForm.private}
                onChange={e => setOpenChannelForm(prev => ({ ...prev, private: e.target.checked }))}
              />
              Private channel
            </label>
          </div>
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              className={compactPrimaryButtonCls}
              disabled={openingChannel || !openChannelForm.nodePubkey.trim()}
              onClick={() => void handleOpenChannel()}
            >
              {openingChannel ? 'Opening…' : 'Open channel'}
            </button>
          </div>
        </SecretItem>
        {lndWalletLoading && !lndWalletStatus ? (
          <div className="text-[0.65rem] text-muted px-1">Loading Lightning status…</div>
        ) : null}
        {lndWalletStatus ? (
          <div className="grid gap-2">
            <div className="rounded border border-border bg-bg px-2 py-1.5 grid gap-1 text-xs text-muted sm:grid-cols-2">
              <div><span className="text-text">Node:</span> {lndWalletStatus.node.alias || truncatePubkey(lndWalletStatus.node.identity_pubkey)}</div>
              <div><span className="text-text">Peers:</span> {lndWalletStatus.node.num_peers}</div>
              <div><span className="text-text">Chain sync:</span> {lndWalletStatus.node.synced_to_chain ? 'Synced' : 'Syncing'}</div>
              <div><span className="text-text">Graph sync:</span> {lndWalletStatus.node.synced_to_graph ? 'Synced' : 'Syncing'}</div>
              <div className="sm:col-span-2"><span className="text-text">Checked:</span> {formatDate(lndWalletStatus.checked_at)}</div>
            </div>
            {lndWalletStatus.channels.length === 0 ? (
              <div className="text-[0.65rem] text-muted px-1">No open Lightning channels.</div>
            ) : (
              lndWalletStatus.channels.map(channel => {
                const hubLabel = channel.remote_alias || truncatePubkey(channel.remote_pubkey);
                return (
                  <div key={channel.channel_point} className="rounded border border-border bg-surface px-2 py-1.5 grid gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-text">{hubLabel}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium ${channelHealthClass(channel.health)}`}>
                        {channelHealthLabel(channel.health)}
                      </span>
                      {channel.private ? (
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted">Private</span>
                      ) : null}
                    </div>
                    <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                      <div><span className="text-text">Hub pubkey:</span> {truncatePubkey(channel.remote_pubkey)}</div>
                      <div><span className="text-text">Peer:</span> {channel.peer_address || '—'}</div>
                      <div><span className="text-text">Capacity:</span> {formatSats(channel.capacity_sat)}</div>
                      <div><span className="text-text">Local balance:</span> {formatSats(channel.local_balance_sat)}</div>
                      <div><span className="text-text">Remote balance:</span> {formatSats(channel.remote_balance_sat)}</div>
                      <div><span className="text-text">Active:</span> {channel.active ? 'Yes' : 'No'}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <button
                        type="button"
                        className={compactButtonCls}
                        disabled={closingChannelPoint === channel.channel_point}
                        onClick={() => void handleCloseChannel(channel.channel_point, false)}
                      >
                        {closingChannelPoint === channel.channel_point ? 'Closing…' : 'Close'}
                      </button>
                      <button
                        type="button"
                        className={`${compactButtonCls} text-red`}
                        disabled={closingChannelPoint === channel.channel_point}
                        onClick={() => void handleCloseChannel(channel.channel_point, true)}
                      >
                        Force close
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            {lndWalletStatus.pending_channels.length > 0 ? (
              <div className="grid gap-1.5">
                <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted px-1">Pending</div>
                <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {lndWalletStatus.pending_channels.map((pending, index) => (
                    <div key={`${pending.remote_pubkey}-${pending.state}-${index}`} className="rounded border border-border bg-bg px-2 py-1.5 text-xs text-muted">
                      <div><span className="text-text">Hub:</span> {pending.remote_alias || truncatePubkey(pending.remote_pubkey)}</div>
                      <div><span className="text-text">State:</span> {pending.state}</div>
                      <div><span className="text-text">Capacity:</span> {formatSats(pending.capacity_sat)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
          </>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderWalletAddressesSection = (account: TradingAccount) => {
    const open = openSectionsByAccount[account.id]?.walletAddresses ?? true;
    const onChainCount = lndWalletStatus?.addresses?.filter(entry => entry.kind === 'onchain').length ?? 0;
    return (
      <CollapsibleSection
        title="Wallet addresses"
        count={onChainCount}
        open={open}
        onToggle={() => toggleSection(account.id, 'walletAddresses')}
        actions={
          <button
            type="button"
            className={compactButtonCls}
            disabled={lndWalletLoading}
            onClick={() => void loadLndWalletStatus()}
          >
            {lndWalletLoading ? '…' : 'Refresh'}
          </button>
        }
      >
        <p className="text-[0.65rem] text-muted leading-relaxed px-1">
          Lightning node identity and on-chain deposit addresses from LND. Lightning payments use invoices, not static addresses.
        </p>
        <div className="grid gap-1.5 px-1 sm:grid-cols-[1fr_auto] sm:items-end">
          <input
            className={compactInputCls}
            value={newAddressLabel}
            onChange={e => setNewAddressLabel(e.target.value)}
            placeholder="Optional label for new on-chain address"
          />
          <button
            type="button"
            className={compactPrimaryButtonCls}
            disabled={creatingAddress || lndWalletLoading}
            onClick={() => {
              setCreatingAddress(true);
              void (async () => {
                try {
                  await createLNDWalletAddress(newAddressLabel);
                  setNewAddressLabel('');
                  await loadLndWalletStatus();
                } catch (err) {
                  setLndWalletError(err instanceof Error ? err.message : 'Failed to create address');
                } finally {
                  setCreatingAddress(false);
                }
              })();
            }}
          >
            {creatingAddress ? 'Creating…' : 'New on-chain address'}
          </button>
        </div>
        {lndWalletLoading && !lndWalletStatus ? (
          <div className="text-[0.65rem] text-muted px-1">Loading addresses…</div>
        ) : null}
        {lndWalletStatus ? (
          <div className="grid gap-1.5">
            {lndWalletStatus.addresses.length === 0 ? (
              <div className="text-[0.65rem] text-muted px-1">No addresses returned from LND.</div>
            ) : (
              lndWalletStatus.addresses.map(entry => {
                const addressField = `lnd-address:${entry.kind}:${entry.address}`;
                const addressVisible = visibleAccountSecretsByAccount[account.id]?.[addressField] === true;
                return <div key={`${entry.kind}-${entry.address}`} className="rounded border border-border bg-bg px-2 py-1.5 grid gap-1 text-xs text-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-text font-medium">
                      {entry.kind === 'lightning' ? 'Lightning node' : 'On-chain'}
                    </span>
                    {entry.label ? (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem]">{addressVisible ? entry.label : '••••••••'}</span>
                    ) : null}
                    {entry.is_internal ? (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem]">Internal</span>
                    ) : null}
                  </div>
                  <div className="flex items-start gap-1"><pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-[0.65rem] text-text">{addressVisible ? entry.address : '••••••••'}</pre><button type="button" className="text-muted hover:text-text" aria-label={addressVisible ? 'Hide wallet address' : 'Show wallet address'} onClick={() => toggleLocalSecretVisibility(account.id, addressField)}>👁</button></div>
                  {entry.kind === 'onchain' ? (
                    <div><span className="text-text">Balance:</span> {formatSats(entry.balance_sat)}</div>
                  ) : null}
                </div>;
              })
            )}
          </div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderAccountFileSection = (account: TradingAccount) => {
    const backup = account.account_file_backup;
    return (
      <div className="grid gap-1.5 pb-1.5 border-b border-border">
        <div className="grid gap-0.5">
          <span className="text-xs font-semibold text-text">Account file</span>
          <p className="text-[0.65rem] text-muted leading-relaxed">
            Latest backup stored in the database (not the live file in the Bisq container).
          </p>
        </div>
        {backup ? (
          <>
            <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
              <div><span className="text-text">File:</span> {backup.file_name}</div>
              <div><span className="text-text">Size:</span> {formatFileSize(backup.file_size_bytes)}</div>
              <div><span className="text-text">Modified:</span> {formatDate(backup.modified_at ?? backup.created_at)}</div>
              <div><span className="text-text">SHA256:</span> {truncateHash(backup.file_sha256)}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={compactButtonCls}
                disabled={bisqAccountFileDownloading === account.id}
                onClick={() => void (async () => {
                  setBisqAccountFileDownloading(account.id);
                  setBisqAccountFileError(null);
                  try {
                    const blob = await downloadBisqAccountFile(account.id);
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = backup.file_name || 'UserPayload';
                    link.click();
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    setBisqAccountFileError(err instanceof Error ? err.message : 'Failed to download account file');
                  } finally {
                    setBisqAccountFileDownloading(null);
                  }
                })()}
              >
                {bisqAccountFileDownloading === account.id ? 'Preparing…' : 'Download account file'}
              </button>
              {bisqAccountFileError ? <span className="text-[0.65rem] text-red">{bisqAccountFileError}</span> : null}
            </div>
          </>
        ) : (
          <div className="text-[0.65rem] text-muted px-1">No account file backed up yet.</div>
        )}
        <a
          className={`${compactButtonCls} w-fit`}
          href={`/api/trading/accounts/${account.id}/bisq-data-directory`}
        >
          Download complete Bisq data directory
        </a>
        <p className="text-[0.65rem] text-muted leading-relaxed">
          Contains the full <span className="font-mono">Bisq/</span> directory for local Bisq 1 recovery. Close the local GUI before replacing its data directory.
        </p>
      </div>
    );
  };

  const renderSeedsSection = (account: TradingAccount) => {
    const isLndWallet = isLndWalletProvider(account.provider);
    if (isLndWallet || isCexAccount(account) || isBankAccount(account) || account.category === 'Fiat Transmitter' || !showDexIdentitySections(account.provider)) {
      return null;
    }
    const draft = newSeedByAccount[account.id] ?? { seed_phrase: '', wallet_created_at: '' };
    const open = !!openSectionsByAccount[account.id]?.seeds;
    const showNew = !isLndWallet && !!showNewFormByAccount[account.id]?.seeds;
    return (
      <CollapsibleSection
        title={isLndWallet ? 'Aezeed' : 'Seeds'}
        count={account.seeds.length}
        open={open}
        onToggle={() => toggleSection(account.id, 'seeds')}
        actions={
          isLndWallet ? null : (
            <button type="button" className={compactButtonCls} onClick={() => setShowNewForm(account.id, 'seeds', !showNew)}>
              {showNew ? 'Cancel' : 'Add'}
            </button>
          )
        }
      >
        {isLndWallet ? (
          <p className="text-[0.65rem] text-muted leading-relaxed px-1">
            Read-only backup of the aezeed LND generated on first wallet init.
          </p>
        ) : null}
        {account.seeds.map(seed => {
          const edit = !isLndWallet ? editingSeedById[seed.id] : undefined;
          const seedField = `seed:${seed.id}`;
          const revealedSeed = revealedAccountSecretsByAccount[account.id]?.seeds.find(item => item.id === seed.id)?.seed_phrase;
          const seedVisible = visibleAccountSecretsByAccount[account.id]?.[seedField] === true;
          const form = edit ?? { seed_phrase: seed.seed_phrase, wallet_created_at: seed.wallet_created_at ?? '' };
          return (
            <SecretItem
              key={seed.id}
              forceOpen={!!edit}
              title={isLndWallet ? 'Aezeed' : `Seed #${seed.id}`}
              meta={formatDate(seed.created_at)}
              summary={seed.seed_phrase.length > 56 ? `${seed.seed_phrase.slice(0, 56)}…` : seed.seed_phrase}
              actions={
                !isLndWallet && !edit ? (
                  <>
                    <button type="button" className={compactButtonCls} onClick={() => setEditingSeedById(prev => ({ ...prev, [seed.id]: form }))}>Edit</button>
                    <button type="button" className={`${compactButtonCls} text-red`} onClick={() => withReload(async () => { await deleteSeed(seed.id); })}>Del</button>
                  </>
                ) : null
              }
            >
              {edit ? (
                <>
                  <div className="grid gap-1.5">
                    <textarea className={textareaCls} value={form.seed_phrase} onChange={e => setEditingSeedById(prev => ({ ...prev, [seed.id]: { ...form, seed_phrase: e.target.value } }))} />
                    <input className={compactInputCls} value={form.wallet_created_at} onChange={e => setEditingSeedById(prev => ({ ...prev, [seed.id]: { ...form, wallet_created_at: e.target.value } }))} placeholder="Wallet created at (ISO)" />
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button type="button" className={compactButtonCls} onClick={() => withReload(async () => {
                      await updateSeed(seed.id, { seed_phrase: form.seed_phrase, wallet_created_at: form.wallet_created_at || null });
                      setEditingSeedById(prev => { const next = { ...prev }; delete next[seed.id]; return next; });
                    })}>Save</button>
                    <button type="button" className={compactButtonCls} onClick={() => setEditingSeedById(prev => { const next = { ...prev }; delete next[seed.id]; return next; })}>Cancel</button>
                  </div>
                </>
              ) : (
                <div className="grid gap-1">
                  <div className="flex items-start gap-1"><pre className="min-w-0 flex-1 overflow-x-auto rounded border border-border bg-surface p-2 text-[0.65rem] text-text whitespace-pre-wrap break-all">{seedVisible ? revealedSeed : '••••••••'}</pre><button type="button" className="text-muted hover:text-text" aria-label={seedVisible ? 'Hide seed phrase' : 'Show seed phrase'} onClick={() => void toggleAccountSecretReveal(account, seedField)} disabled={revealingCredentialsByAccount[account.id] === true}>👁</button></div>
                  <div className="text-[0.65rem] text-muted">Wallet created: {formatDate(seed.wallet_created_at)}</div>
                </div>
              )}
            </SecretItem>
          );
        })}
        {showNew ? (
          <ResourceCard title="New Seed">
            <div className="grid gap-1.5">
              <textarea className={textareaCls} value={draft.seed_phrase} onChange={e => setNewSeedByAccount(prev => ({ ...prev, [account.id]: { ...draft, seed_phrase: e.target.value } }))} placeholder="Seed phrase" />
              <input className={compactInputCls} value={draft.wallet_created_at} onChange={e => setNewSeedByAccount(prev => ({ ...prev, [account.id]: { ...draft, wallet_created_at: e.target.value } }))} placeholder="Wallet created at (ISO)" />
            </div>
            <div className="mt-1.5 flex justify-end">
              <button type="button" className={compactButtonCls} onClick={() => withReload(async () => {
                await createSeed(account.id, { seed_phrase: draft.seed_phrase, wallet_created_at: draft.wallet_created_at || null });
                setNewSeedByAccount(prev => ({ ...prev, [account.id]: { seed_phrase: '', wallet_created_at: '' } }));
                setShowNewForm(account.id, 'seeds', false);
              })}>Create</button>
            </div>
          </ResourceCard>
        ) : null}
        {account.seeds.length === 0 ? (
          <div className="text-[0.65rem] text-muted px-1">
            {isLndWallet ? 'No aezeed stored yet — set the wallet password and start mm-controller to generate one.' : 'No seeds yet.'}
          </div>
        ) : null}
      </CollapsibleSection>
    );
  };

  // Creating a Bisq account is deliberately split into edit -> review -> confirm. Selecting a
  // method and entering review perform reads/local state changes only; confirm is the sole POST.
  const renderChatPaymentMethodsSection = (account: TradingAccount) => {
    const exchange = chatExchangeForProvider(account.provider);
    if (!exchange) return null;
    const open = !!openSectionsByAccount[account.id]?.chatPaymentMethods;
    const methods = chatPaymentMethods.filter(method => {
      const hasTemplate = chatTemplatesByMethod[method.id]?.some(template => template.exchange === exchange);
      return method.is_active || hasTemplate;
    });

    const toggle = () => {
      const willOpen = !open;
      toggleSection(account.id, 'chatPaymentMethods');
      if (willOpen) void loadChatPaymentMethods();
    };

    return (
      <CollapsibleSection
        title="Chat payment methods"
        count={methods.length}
        open={open}
        onToggle={toggle}
        actions={
          <button type="button" className={compactButtonCls} disabled={chatPaymentMethodsLoading} onClick={() => void loadChatPaymentMethods()}>
            {chatPaymentMethodsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      >
        <div className="grid gap-2">
          <p className="text-[0.65rem] text-muted">
            Add a message template for each payment method you use on {exchange}. These chat-only venues do not create a separate DEX payment account.
          </p>
          {chatPaymentMethodsError ? <p className="text-[0.65rem] text-red">{chatPaymentMethodsError}</p> : null}
          {chatPaymentMethodsLoading ? <p className="text-[0.65rem] text-muted">Loading payment methods…</p> : null}
          {!chatPaymentMethodsLoading && methods.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-2 py-2 text-[0.65rem] text-muted">
              No active payment methods are available. Add or activate one in the Payment Method Catalog first.
            </p>
          ) : null}
          {methods.map(method => {
            const template = chatTemplatesByMethod[method.id]?.find(candidate => candidate.exchange === exchange);
            const draft = chatTemplateDrafts[method.id] ?? {
              template: template?.template ?? '',
              is_active: template?.is_active ?? true,
            };
            const editing = chatTemplateEditingMethods[method.id] === true;
            const saving = chatTemplateSavingMethodID === method.id;
            const openEditor = () => {
              setChatTemplateDrafts(current => ({ ...current, [method.id]: draft }));
              setChatTemplateEditingMethods(current => ({ ...current, [method.id]: true }));
            };
            const closeEditor = () => {
              setChatTemplateEditingMethods(current => ({ ...current, [method.id]: false }));
              setChatTemplateDrafts(current => {
                const next = { ...current };
                delete next[method.id];
                return next;
              });
            };
            const save = async () => {
              if (!draft.template.trim()) return;
              setChatTemplateSavingMethodID(method.id);
              setChatPaymentMethodsError(null);
              try {
                const response = await updatePaymentMethodChatTemplate(method.id, exchange, {
                  template: draft.template.trim(),
                  is_active: draft.is_active,
                });
                setChatTemplatesByMethod(current => ({ ...current, [method.id]: response.chat_templates }));
                closeEditor();
              } catch (err) {
                setChatPaymentMethodsError(err instanceof Error ? err.message : 'Failed to save chat template');
              } finally {
                setChatTemplateSavingMethodID(null);
              }
            };
            const remove = async () => {
              if (!template) return;
              setChatTemplateSavingMethodID(method.id);
              setChatPaymentMethodsError(null);
              try {
                await deletePaymentMethodChatTemplate(method.id, exchange);
                setChatTemplatesByMethod(current => ({
                  ...current,
                  [method.id]: (current[method.id] ?? []).filter(candidate => candidate.exchange !== exchange),
                }));
                closeEditor();
              } catch (err) {
                setChatPaymentMethodsError(err instanceof Error ? err.message : 'Failed to remove chat template');
              } finally {
                setChatTemplateSavingMethodID(null);
              }
            };

            return (
              <div key={method.id} className="rounded-md border border-border bg-surface/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-xs">
                    <span className="font-medium text-text">{method.name}</span>
                    {template ? (
                      <span className={`ml-2 text-[0.62rem] ${template.is_active ? 'text-green' : 'text-muted'}`}>
                        {template.is_active ? 'template active' : 'template inactive'}
                      </span>
                    ) : <span className="ml-2 text-[0.62rem] text-muted">no template</span>}
                  </div>
                  <button type="button" className={compactButtonCls} onClick={editing ? closeEditor : openEditor} disabled={saving}>
                    {editing ? 'Close' : template ? 'Edit template' : 'Add template'}
                  </button>
                </div>
                {editing ? (
                  <div className="mt-2 grid gap-2">
                    <textarea
                      className={`${compactInputCls} min-h-20 resize-y`}
                      value={draft.template}
                      placeholder="Please send {{amount}} {{currency}} via this payment method."
                      onChange={event => setChatTemplateDrafts(current => ({
                        ...current,
                        [method.id]: { ...draft, template: event.target.value },
                      }))}
                    />
                    <label className="inline-flex items-center gap-2 text-[0.65rem] text-muted">
                      <input
                        type="checkbox"
                        checked={draft.is_active}
                        onChange={event => setChatTemplateDrafts(current => ({
                          ...current,
                          [method.id]: { ...draft, is_active: event.target.checked },
                        }))}
                      />
                      Use this template for {exchange}
                    </label>
                    <div className="flex justify-end gap-1.5">
                      {template ? <button type="button" className={`${compactButtonCls} text-red`} onClick={() => void remove()} disabled={saving}>Remove</button> : null}
                      <button type="button" className={compactPrimaryButtonCls} onClick={() => void save()} disabled={saving || !draft.template.trim()}>
                        {saving ? 'Saving…' : 'Save template'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CollapsibleSection>
    );
  };

  const renderSavedPaymentMethodsSection = (account: TradingAccount) => {
    const open = !!openSectionsByAccount[account.id]?.bisqPaymentMethods;
    const bankAccounts = accounts
      .flatMap(acc => acc.bank_accounts)
      .sort((a, b) => a.owner_name.localeCompare(b.owner_name) || a.id - b.id);
    const selectedFiat = filters.fiat.toUpperCase();
    const supportedMethods = bisqSupportedMethods
      .filter((method, index, all) => method.id && all.findIndex(candidate => candidate.id === method.id) === index)
      .filter(method => {
        const row = catalogRowForBisqMethod(method.id, bisqCatalogRows);
        const bank = row?.bank_account_id == null
          ? undefined
          : bankAccounts.find(candidate => candidate.id === row.bank_account_id);
        // A linked bank account's currency is reliable metadata. Methods without reliable
        // currency metadata remain visible rather than being guessed away.
        return !bank?.currency || bank.currency.toUpperCase() === selectedFiat;
      })
      .sort((a, b) => bisqPaymentMethodLabel(a.id).localeCompare(bisqPaymentMethodLabel(b.id)));
    const selectedCatalogRow = bisqSelectedMethodID
      ? catalogRowForBisqMethod(bisqSelectedMethodID, bisqCatalogRows)
      : undefined;
    const formCanReview = !!bisqAccountForm?.supported
      && !!bisqFormValues.accountName?.trim()
      && !bisqFormLoading;
    const creating = bisqPmBusyKey === 'create-confirm';

    const onToggle = () => {
      toggleSection(account.id, 'bisqPaymentMethods');
      if (!bisqPmLoaded && !bisqPmLoading) void loadBisqPaymentMethods();
    };

    return (
      <CollapsibleSection
        title="Saved payment methods"
        count={bisqPmAccounts.length}
        open={open}
        onToggle={onToggle}
        actions={
          <button
            type="button"
            className={compactButtonCls}
            disabled={bisqPmLoading}
            onClick={() => { void loadBisqPaymentMethods(); }}
          >
            {bisqPmLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      >
        {bisqPmError ? <div className="text-[0.65rem] text-red px-1">{bisqPmError}</div> : null}
        {!bisqPmLoaded && bisqPmLoading ? <div className="text-[0.65rem] text-muted px-1">Loading…</div> : null}
        {bisqPmLoaded ? (
          <div className="grid gap-2 rounded-md border border-border bg-surface/40 p-2">
            <label className="grid gap-1 text-[0.65rem] text-muted">
              Bisq 1 payment method for {selectedFiat}
              <select
                aria-label="Bisq 1 payment method"
                className={compactInputCls}
                value={bisqSelectedMethodID}
                disabled={bisqPmLoading || creating}
                onChange={event => { void handleBisqMethodSelection(event.target.value); }}
              >
                <option value="">Select a payment method…</option>
                {supportedMethods.map(method => {
                  const row = catalogRowForBisqMethod(method.id, bisqCatalogRows);
                  const available = !!row?.is_active && !!row?.is_linked;
                  let reason = '';
                  if (!row) reason = ' · unavailable locally';
                  else if (!row.is_active) reason = ' · inactive locally';
                  else if (!row.is_linked) reason = ' · not linked locally';
                  return (
                    <option key={method.id} value={method.id} disabled={!available}>
                      {bisqPaymentMethodLabel(method.id)}{reason}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="text-[0.6rem] text-muted">
              Methods supported by Bisq but unavailable in the local Payment Methods table stay visible in grey.
            </div>
            {bisqFormLoading ? <div className="text-[0.65rem] text-muted">Loading account form…</div> : null}
            {bisqAccountForm && !bisqAccountForm.supported ? (
              <div className="text-[0.65rem] text-yellow">
                This Bisq form cannot be rendered safely: {bisqAccountForm.unsupported_reason || 'unsupported form shape'}
              </div>
            ) : null}
            {bisqAccountForm?.supported && bisqFormStep === 'edit' ? (
              <div className="grid gap-2">
                {selectedCatalogRow ? (
                  <div className="text-[0.6rem] text-muted">
                    Local source: {selectedCatalogRow.name}{selectedCatalogRow.link_label ? ` · ${selectedCatalogRow.link_label}` : ''}. Prefilled values remain editable.
                  </div>
                ) : null}
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {Object.keys(bisqAccountForm.fields).map(field => (
                    <label key={field} className="grid gap-1 text-[0.65rem] text-muted">
                      {bisqFieldLabel(field)}
                      <input
                        className={compactInputCls}
                        value={bisqFormValues[field] ?? ''}
                        readOnly={field === 'paymentMethodId'}
                        placeholder={field === 'salt' ? 'Optional account-age salt (hex)' : bisqAccountForm.fields[field]}
                        onChange={event => setBisqFormValues(current => ({ ...current, [field]: event.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex justify-end gap-1.5">
                  <button type="button" className={compactButtonCls} onClick={resetBisqCreateForm}>Cancel</button>
                  <button
                    type="button"
                    className={compactPrimaryButtonCls}
                    disabled={!formCanReview}
                    onClick={() => {
                      setBisqPmError(null);
                      setBisqFormStep('review');
                    }}
                  >
                    Review payment account
                  </button>
                </div>
              </div>
            ) : null}
            {bisqAccountForm?.supported && bisqFormStep === 'review' ? (
              <div className="grid gap-2 rounded border border-border bg-surface p-2">
                <div className="text-[0.68rem] font-semibold text-text">Review before creating in Bisq</div>
                <dl className="grid gap-1 text-[0.65rem] sm:grid-cols-2">
                  {Object.entries(bisqFormValues).map(([field, value]) => (
                    <div key={field} className="min-w-0">
                      <dt className="text-muted">{bisqFieldLabel(field)}</dt>
                      <dd className="break-all text-text">{field === 'salt' && !value ? 'Generated by Bisq' : value || '—'}</dd>
                    </div>
                  ))}
                </dl>
                <div className="text-[0.6rem] text-yellow">
                  Nothing has been created yet. The next button is the only action that writes to the Bisq daemon.
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <button type="button" className={compactButtonCls} disabled={creating} onClick={() => setBisqFormStep('edit')}>
                    Back to edit
                  </button>
                  <button
                    type="button"
                    className={compactPrimaryButtonCls}
                    disabled={creating}
                    onClick={() => { void confirmBisqPaymentAccount(); }}
                  >
                    {creating ? 'Creating…' : 'Create and link payment account'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {bisqPmAccounts.length > 0 ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {bisqPmAccounts.map(acct => {
              const busyKey = `saved-${acct.id}`;
              const busy = bisqPmBusyKey === busyKey;
              return (
                <ResourceCard key={acct.id} title={acct.account_name} meta={`${bisqPaymentMethodLabel(acct.payment_method_id)}${acct.trade_currency ? ` · ${acct.trade_currency}` : ''}`}>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[0.65rem] text-green">Linked ✓</span>
                    <button
                      type="button"
                      className={`${compactButtonCls} text-red`}
                      disabled={busy || bisqPmLoading || creating}
                      onClick={() => runBisqAction(busyKey, async () => { await deleteBisqPaymentAccount(acct.id); })}
                    >
                      {busy ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </ResourceCard>
              );
            })}
          </div>
        ) : null}
        {bisqPmLoaded && bisqPmAccounts.length === 0 ? (
          <div className="text-[0.65rem] text-muted px-1">No payment accounts saved in Bisq 1 yet.</div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderBankAccountsSection = (account: TradingAccount) => {
    if (!isBankAccount(account)) return null;
    const draft = newBankAccountByAccount[account.id] ?? emptyBankAccountForm();
    const showNew = !!showNewFormByAccount[account.id]?.seeds;
    const draftIbanError = draft.iban.trim() ? ibanFormatError(draft.iban) : null;
    return (
      <CollapsibleSection
        title="Bank Accounts"
        count={account.bank_accounts.length}
        open={!!openSectionsByAccount[account.id]?.seeds}
        onToggle={() => toggleSection(account.id, 'seeds')}
        actions={
          <button type="button" className={compactButtonCls} onClick={() => setShowNewForm(account.id, 'seeds', !showNew)}>
            {showNew ? 'Cancel' : 'Add'}
          </button>
        }
      >
        {account.bank_accounts.map((ba: TradingBankAccount) => {
          const edit = editingBankAccountById[ba.id];
          const ownerField = `bank:${ba.id}:owner`;
          const bankSecrets = revealedAccountSecretsByAccount[account.id]?.bank_accounts.find(item => item.id === ba.id);
          const visibleBankFields = visibleAccountSecretsByAccount[account.id] ?? {};
          const form: BankAccountFormState = edit ?? {
            label: ba.label ?? '',
            owner_name: visibleBankFields[ownerField] ? bankSecrets?.owner_name ?? ba.owner_name : ba.owner_name,
            currency: ba.currency,
            country: ba.country ?? '',
            scheme: ba.scheme,
            iban: ba.details.iban ?? '',
            bic: ba.details.bic ?? '',
            is_active: ba.is_active,
          };
          const ibanError = form.iban.trim() ? ibanFormatError(form.iban) : null;
          return (
            <ResourceCard key={ba.id} title={ba.label ?? `Account #${ba.id}`}>
              {edit ? (
                <div className="grid gap-1.5">
                  <input className={compactInputCls} value={form.label} onChange={e => setEditingBankAccountById(prev => ({ ...prev, [ba.id]: { ...form, label: e.target.value } }))} placeholder="Label (optional)" />
                  <input className={compactInputCls} value={form.owner_name} onChange={e => setEditingBankAccountById(prev => ({ ...prev, [ba.id]: { ...form, owner_name: e.target.value } }))} placeholder="Owner name" />
                  <div className="grid gap-1.5 md:grid-cols-2">
                    <div className="grid gap-1">
                      <input className={compactInputCls} value={form.iban} onChange={e => setEditingBankAccountById(prev => ({ ...prev, [ba.id]: { ...form, iban: e.target.value } }))} placeholder="IBAN" />
                      {ibanError ? <span className="text-[0.65rem] text-red">{ibanError}</span> : null}
                    </div>
                    <input className={compactInputCls} value={form.bic} onChange={e => setEditingBankAccountById(prev => ({ ...prev, [ba.id]: { ...form, bic: e.target.value } }))} placeholder="BIC" />
                    <input className={compactInputCls} value={form.currency} onChange={e => setEditingBankAccountById(prev => ({ ...prev, [ba.id]: { ...form, currency: e.target.value.toUpperCase() } }))} placeholder="Currency (EUR)" />
                    <input className={compactInputCls} value={form.country} onChange={e => setEditingBankAccountById(prev => ({ ...prev, [ba.id]: { ...form, country: e.target.value.toUpperCase() } }))} placeholder="Country (DE)" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" checked={form.is_active} onChange={e => setEditingBankAccountById(prev => ({ ...prev, [ba.id]: { ...form, is_active: e.target.checked } }))} />
                    Active
                  </label>
                  <div className="flex gap-1">
                    <button type="button" className={compactButtonCls} disabled={Boolean(ibanError)} onClick={() => withReload(async () => {
                      await updateBankAccount(ba.id, { ...form, scheme: 'iban_bic', details: { iban: form.iban, bic: form.bic }, label: form.label || null, country: form.country || null });
                      setEditingBankAccountById(prev => { const next = { ...prev }; delete next[ba.id]; return next; });
                    })}>Save</button>
                    <button type="button" className={compactButtonCls} onClick={() => setEditingBankAccountById(prev => { const next = { ...prev }; delete next[ba.id]; return next; })}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                  <div className="flex items-center gap-1"><span><span className="text-text">Owner:</span> {visibleBankFields[ownerField] ? bankSecrets?.owner_name : '••••••••'}</span><button type="button" className="text-muted hover:text-text" aria-label={visibleBankFields[ownerField] ? 'Hide account owner' : 'Show account owner'} onClick={() => void toggleAccountSecretReveal(account, ownerField)} disabled={revealingCredentialsByAccount[account.id] === true}>👁</button></div>
                  {Object.keys(ba.details).map(detailKey => {
                    const detailField = `bank:${ba.id}:${detailKey}`;
                    const visible = visibleBankFields[detailField] === true;
                    return <div key={detailKey} className="flex items-center gap-1"><span><span className="text-text">{detailKey.replace(/_/g, ' ')}:</span> {visible ? bankSecrets?.details[detailKey] : '••••••••'}</span><button type="button" className="text-muted hover:text-text" aria-label={visible ? `Hide ${detailKey}` : `Show ${detailKey}`} onClick={() => void toggleAccountSecretReveal(account, detailField)} disabled={revealingCredentialsByAccount[account.id] === true}>👁</button></div>;
                  })}
                  <div><span className="text-text">Currency:</span> {ba.currency}{ba.country ? ` · ${ba.country}` : ''}</div>
                  <div><span className="text-text">Active:</span> {ba.is_active ? 'Yes' : 'No'}</div>
                  <div className="flex gap-1 mt-1 sm:col-span-2">
                    <button type="button" className={compactButtonCls} onClick={() => setEditingBankAccountById(prev => ({ ...prev, [ba.id]: form }))}>Edit</button>
                    <button type="button" className={`${compactButtonCls} text-red`} onClick={() => withReload(async () => { await deleteBankAccount(ba.id); })}>Del</button>
                  </div>
                </div>
              )}
            </ResourceCard>
          );
        })}
        {showNew ? (
          <ResourceCard title="New Bank Account">
            <div className="grid gap-1.5">
              <input className={compactInputCls} value={draft.label} onChange={e => setNewBankAccountByAccount(prev => ({ ...prev, [account.id]: { ...draft, label: e.target.value } }))} placeholder="Label (optional)" />
              <input className={compactInputCls} value={draft.owner_name} onChange={e => setNewBankAccountByAccount(prev => ({ ...prev, [account.id]: { ...draft, owner_name: e.target.value } }))} placeholder="Owner name" />
              <div className="grid gap-1.5 md:grid-cols-2">
                <div className="grid gap-1">
                  <input className={compactInputCls} value={draft.iban} onChange={e => setNewBankAccountByAccount(prev => ({ ...prev, [account.id]: { ...draft, iban: e.target.value } }))} placeholder="IBAN" />
                  {draftIbanError ? <span className="text-[0.65rem] text-red">{draftIbanError}</span> : null}
                </div>
                <input className={compactInputCls} value={draft.bic} onChange={e => setNewBankAccountByAccount(prev => ({ ...prev, [account.id]: { ...draft, bic: e.target.value } }))} placeholder="BIC" />
                <input className={compactInputCls} value={draft.currency} onChange={e => setNewBankAccountByAccount(prev => ({ ...prev, [account.id]: { ...draft, currency: e.target.value.toUpperCase() } }))} placeholder="Currency (EUR)" />
                <input className={compactInputCls} value={draft.country} onChange={e => setNewBankAccountByAccount(prev => ({ ...prev, [account.id]: { ...draft, country: e.target.value.toUpperCase() } }))} placeholder="Country (DE)" />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={draft.is_active} onChange={e => setNewBankAccountByAccount(prev => ({ ...prev, [account.id]: { ...draft, is_active: e.target.checked } }))} />
                Active
              </label>
            </div>
            <div className="mt-1.5 flex justify-end">
              <button type="button" className={compactButtonCls} disabled={Boolean(draftIbanError)} onClick={() => withReload(async () => {
                await createBankAccount(account.id, {
                  label: draft.label || null,
                  owner_name: draft.owner_name,
                  currency: draft.currency,
                  country: draft.country || null,
                  scheme: 'iban_bic',
                  details: { iban: draft.iban, bic: draft.bic },
                  is_active: draft.is_active,
                });
                setNewBankAccountByAccount(prev => ({ ...prev, [account.id]: emptyBankAccountForm() }));
                setShowNewForm(account.id, 'seeds', false);
              })}>Create</button>
            </div>
          </ResourceCard>
        ) : null}
        {account.bank_accounts.length === 0 && !showNew ? (
          <div className="text-[0.65rem] text-muted px-1">No bank accounts yet.</div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderAPIKeysSection = (account: TradingAccount) => {
    const draft = newAPIKeyByAccount[account.id] ?? { name: '', api_key: '', api_secret: '', passphrase: '', is_active: true };
    const profile = apiKeyFormProfile(account.provider);
    const open = !!openSectionsByAccount[account.id]?.apiKeys;
    const showNew = !!showNewFormByAccount[account.id]?.apiKeys;
    return (
      <CollapsibleSection
        title={profile.sectionTitle}
        count={account.api_keys.length}
        open={open}
        onToggle={() => toggleSection(account.id, 'apiKeys')}
        actions={
          <button type="button" className={compactButtonCls} onClick={() => setShowNewForm(account.id, 'apiKeys', !showNew)}>
            {showNew ? 'Cancel' : 'Add'}
          </button>
        }
      >
        {profile.helpText ? (
          <p className="text-[0.65rem] text-muted leading-relaxed px-1">{profile.helpText}</p>
        ) : null}
        {isCexAccount(account) ? <AggregatedPermissionsRow apiKeys={account.api_keys} /> : null}
        {account.api_keys.map(key => {
          const edit = editingAPIKeyById[key.id];
          const secretKey = `api-key:${key.id}:key`;
          const secretSecret = `api-key:${key.id}:secret`;
          const secretPassphrase = `api-key:${key.id}:passphrase`;
          const revealedKey = revealedAccountSecretsByAccount[account.id]?.api_keys.find(item => item.id === key.id);
          const visibleSecrets = visibleAccountSecretsByAccount[account.id] ?? {};
          const form = edit ?? {
            name: key.name,
            api_key: key.api_key,
            api_secret: key.api_secret ?? '',
            passphrase: key.passphrase ?? '',
            is_active: key.is_active,
          };
          const itemTitle = profile.showName ? key.name : (key.name.trim() || profile.itemTitleFallback);
          return (
            <SecretItem
              key={key.id}
              forceOpen={!!edit}
              title={itemTitle}
              meta={key.is_active ? 'Active' : 'Inactive'}
              footer={(key.permissions && Object.keys(key.permissions).length > 0) || key.permission_check_error ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[0.65rem] text-text whitespace-nowrap">
                    Validation
                    {key.permissions_checked_at ? ` · checked ${formatDate(key.permissions_checked_at)}` : ''}
                  </span>
                  <APIKeyPermissionChips permissions={key.permissions ?? {}} />
                  {key.permission_check_error ? <span className="basis-full text-[0.65rem] text-red">{key.permission_check_error}</span> : null}
                </div>
              ) : null}
              flat
              actions={
                !edit ? (
                  <>
                    <button type="button" className={compactButtonCls} onClick={() => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: form }))}>Edit</button>
                    <button type="button" className={`${compactButtonCls} text-red`} onClick={() => withReload(async () => { await deleteAPIKey(key.id); })}>Del</button>
                  </>
                ) : null
              }
            >
              {edit ? (
                <>
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {profile.showName ? (
                      <input className={compactInputCls} value={form.name} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, name: e.target.value } }))} placeholder="Name" />
                    ) : null}
                    <label className={`flex items-center gap-2 text-xs text-muted ${!profile.showName ? 'md:col-span-2' : ''}`}>
                      <input type="checkbox" checked={form.is_active} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, is_active: e.target.checked } }))} />
                      Active
                    </label>
                    <label className="grid gap-1 text-xs text-muted md:col-span-2">
                      <span>{profile.keyLabel}</span>
                      <textarea className={textareaCls} value={form.api_key} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, api_key: e.target.value } }))} placeholder={profile.keyPlaceholder} />
                    </label>
                    {profile.showSecret ? (
                      <label className="grid gap-1 text-xs text-muted md:col-span-2">
                        <span>{profile.secretLabel}</span>
                        <textarea className={textareaCls} value={form.api_secret} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, api_secret: e.target.value } }))} placeholder={profile.secretPlaceholder ?? undefined} />
                      </label>
                    ) : null}
                    {profile.showPassphrase ? (
                      <input className={`${compactInputCls} md:col-span-2`} value={form.passphrase} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, passphrase: e.target.value } }))} placeholder="Passphrase" />
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button type="button" className={compactButtonCls} onClick={() => withReload(async () => {
                      await updateAPIKey(key.id, {
                        name: form.name,
                        api_key: form.api_key,
                        ...apiKeyPayloadExtras(profile, form),
                        is_active: form.is_active,
                      });
                      setEditingAPIKeyById(prev => { const next = { ...prev }; delete next[key.id]; return next; });
                    })}>Save</button>
                    <button type="button" className={compactButtonCls} onClick={() => setEditingAPIKeyById(prev => { const next = { ...prev }; delete next[key.id]; return next; })}>Cancel</button>
                  </div>
                </>
              ) : (
                <div className="grid gap-1 text-[0.65rem] text-muted">
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <SecretRevealValue
                        label={profile.keyLabel}
                        value={revealedKey?.api_key}
                        visible={visibleSecrets[secretKey] === true}
                        onToggle={() => void toggleAccountSecretReveal(account, secretKey)}
                        disabled={revealingCredentialsByAccount[account.id] === true}
                        revealLabel="API key"
                      />
                    </div>
                    {profile.showSecret && key.api_secret ? (
                      <SecretRevealValue
                        label={profile.secretLabel ?? 'API secret'}
                        value={revealedKey?.api_secret}
                        visible={visibleSecrets[secretSecret] === true}
                        onToggle={() => void toggleAccountSecretReveal(account, secretSecret)}
                        disabled={revealingCredentialsByAccount[account.id] === true}
                        revealLabel="API secret"
                      />
                    ) : null}
                    {profile.showPassphrase && key.passphrase ? (
                      <SecretRevealValue
                        label="Passphrase"
                        value={revealedKey?.passphrase}
                        visible={visibleSecrets[secretPassphrase] === true}
                        onToggle={() => void toggleAccountSecretReveal(account, secretPassphrase)}
                        disabled={revealingCredentialsByAccount[account.id] === true}
                        revealLabel="passphrase"
                      />
                    ) : null}
                  </div>
                  <div>Created {formatDate(key.created_at)} · Updated {formatDate(key.updated_at)}</div>
                </div>
              )}
            </SecretItem>
          );
        })}
        {showNew ? (
          <div className="grid gap-2 border-t border-border pt-2">
            <div className="text-xs font-semibold text-text">{profile.newTitle}</div>
            <div className="grid gap-1.5 md:grid-cols-2">
              {profile.showName ? (
                <input className={compactInputCls} value={draft.name} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, name: e.target.value } }))} placeholder="Name" />
              ) : null}
              <label className={`flex items-center gap-2 text-xs text-muted ${!profile.showName ? 'md:col-span-2' : ''}`}>
                <input type="checkbox" checked={draft.is_active} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, is_active: e.target.checked } }))} />
                Active
              </label>
              <label className="grid gap-1 text-xs text-muted md:col-span-2">
                <span>{profile.keyLabel}</span>
                <textarea className={textareaCls} value={draft.api_key} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, api_key: e.target.value } }))} placeholder={profile.keyPlaceholder} />
              </label>
              {profile.showSecret ? (
                <label className="grid gap-1 text-xs text-muted md:col-span-2">
                  <span>{profile.secretLabel}</span>
                  <textarea className={textareaCls} value={draft.api_secret} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, api_secret: e.target.value } }))} placeholder={profile.secretPlaceholder ?? undefined} />
                </label>
              ) : null}
              {profile.showPassphrase ? (
                <input className={`${compactInputCls} md:col-span-2`} value={draft.passphrase} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, passphrase: e.target.value } }))} placeholder="Passphrase" />
              ) : null}
            </div>
            <div className="mt-1.5 flex justify-end">
              <button type="button" className={compactButtonCls} onClick={() => withReload(async () => {
                await createAPIKey(account.id, {
                  name: draft.name,
                  api_key: draft.api_key,
                  ...apiKeyPayloadExtras(profile, draft),
                  is_active: draft.is_active,
                });
                setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { name: '', api_key: '', api_secret: '', passphrase: '', is_active: true } }));
                setShowNewForm(account.id, 'apiKeys', false);
              })}>{profile.createLabel.replace('Create ', '')}</button>
            </div>
          </div>
        ) : null}
        {!showNew && account.api_keys.length === 0 ? (
          <div className="text-[0.65rem] text-muted px-1">{profile.emptyMessage}</div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderCexHedgingSection = (account: TradingAccount) => {
    const slice = cexDataByAccount[account.id]?.hedgePositions;
    const open = !!openSectionsByAccount[account.id]?.cexHedging;
    const positions = slice?.data;
    const activeCount = positions?.active.length ?? 0;
    const pastCount = positions?.past.length ?? 0;
    return (
      <CollapsibleSection
        title="Hedging"
        count={activeCount + pastCount || undefined}
        open={open}
        onToggle={() => toggleCexSection(account, 'cexHedging')}
        actions={
          <button type="button" className={compactButtonCls} disabled={slice?.loading} onClick={() => void loadCexSection(account.id, 'cexHedging')}>
            {slice?.loading ? '…' : 'Refresh'}
          </button>
        }
      >
        <p className="text-[0.65rem] text-muted leading-relaxed px-1">
          Hedge positions linked to MM transactions for this exchange.
        </p>
        {renderCexSectionMessage(
          slice?.loading ?? false,
          slice?.error ?? null,
          'No hedge positions recorded yet.',
          !!positions && (positions.active.length > 0 || positions.past.length > 0),
        )}
        {positions ? (
          <div className="grid gap-2">
            <div className="text-xs font-semibold text-text px-1">Active ({positions.active.length})</div>
            {positions.active.length > 0 ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {positions.active.map(position => renderHedgePositionCard(position, 'Active'))}
              </div>
            ) : (
              <div className="text-[0.65rem] text-muted px-1">No active hedge positions.</div>
            )}
            <div className="text-xs font-semibold text-text px-1 pt-1">Past ({positions.past.length})</div>
            {positions.past.length > 0 ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {positions.past.map(position => renderHedgePositionCard(position, 'Past'))}
              </div>
            ) : (
              <div className="text-[0.65rem] text-muted px-1">No past hedge positions.</div>
            )}
          </div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderCexSpotTradesSection = (account: TradingAccount) => {
    const slice = cexDataByAccount[account.id]?.spotTrades;
    const open = !!openSectionsByAccount[account.id]?.cexSpotTrades;
    const trades = slice?.data ?? [];
    return (
      <CollapsibleSection
        title="Spot Market Transactions"
        count={trades.length || undefined}
        open={open}
        onToggle={() => toggleCexSection(account, 'cexSpotTrades')}
        actions={
          <button type="button" className={compactButtonCls} disabled={slice?.loading} onClick={() => void loadCexSection(account.id, 'cexSpotTrades')}>
            {slice?.loading ? '…' : 'Refresh'}
          </button>
        }
      >
        {renderCexSectionMessage(slice?.loading ?? false, slice?.error ?? null, 'No spot trades returned yet.', trades.length > 0)}
        {trades.length > 0 ? (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {trades.map(trade => (
              <ResourceCard key={trade.trade_id} title={`${trade.trade_type} ${trade.trading_pair}`} meta={formatDate(trade.timestamp)}>
                <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                  <div><span className="text-text">Price:</span> {formatTokenAmount(trade.price, 2)}</div>
                  <div><span className="text-text">Amount:</span> {formatTokenAmount(trade.amount)}</div>
                  <div><span className="text-text">Fee:</span> {formatTokenAmount(trade.fee, 8)}{trade.fee_asset ? ` ${trade.fee_asset}` : ''}</div>
                  <div><span className="text-text">Trade ID:</span> {trade.trade_id}</div>
                </div>
              </ResourceCard>
            ))}
          </div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const renderCexWithdrawalAddressesSection = (account: TradingAccount) => {
    const slice = cexDataByAccount[account.id]?.withdrawalAddresses;
    const open = !!openSectionsByAccount[account.id]?.cexWithdrawalAddresses;
    const addresses = slice?.data ?? [];
    return (
      <CollapsibleSection
        title="Withdrawal addresses"
        count={addresses.length || undefined}
        open={open}
        onToggle={() => toggleCexSection(account, 'cexWithdrawalAddresses')}
        actions={
          <button type="button" className={compactButtonCls} disabled={slice?.loading} onClick={() => void loadCexSection(account.id, 'cexWithdrawalAddresses')}>
            {slice?.loading ? '…' : 'Refresh'}
          </button>
        }
      >
        <p className="text-[0.65rem] text-muted leading-relaxed px-1">
          Whitelisted BTC withdrawal addresses saved on the exchange, fetched with the account API keys.
        </p>
        {renderCexSectionMessage(slice?.loading ?? false, slice?.error ?? null, 'No whitelisted withdrawal addresses returned.', addresses.length > 0)}
        {addresses.length > 0 ? (
          <div className="grid">
            {addresses.map((entry, idx) => {
              const addressField = `cex-withdrawal:${entry.address}:${idx}`;
              const addressVisible = visibleAccountSecretsByAccount[account.id]?.[addressField] === true;
              return <div
                key={`${entry.address}-${idx}`}
                className="flex flex-wrap items-baseline gap-x-1.5 px-1 py-0.5 text-[0.65rem] leading-tight border-b border-border/40 last:border-0"
              >
                {entry.label?.trim() ? (
                  <span className="max-w-[40%] truncate text-text" title={addressVisible ? entry.label : undefined}>{addressVisible ? entry.label : '••••••••'}</span>
                ) : null}
                <span className="inline-flex items-center gap-1 font-mono break-all text-muted"><span>{addressVisible ? entry.address : '••••••••'}</span><button type="button" className="text-muted hover:text-text" aria-label={addressVisible ? 'Hide withdrawal address' : 'Show withdrawal address'} onClick={() => toggleLocalSecretVisibility(account.id, addressField)}>👁</button></span>
                {entry.network ? <span className="text-muted/60">{entry.network}</span> : null}
                {entry.tag ? <span className="text-muted/60">tag:{addressVisible ? entry.tag : '••••••••'}</span> : null}
                {entry.whitelisted === false ? <span className="text-yellow">unverified</span> : null}
              </div>;
            })}
          </div>
        ) : null}
      </CollapsibleSection>
    );
  };

  const handleToggleNewAccountForm = () => {
    if (showNewAccountForm) {
      resetNewAccountForm();
    }
    setShowNewAccountForm(prev => !prev);
  };

  const handleSubtabSelect = (tab: AccountsSubview) => {
    setActiveTab(tab);
    if (showNewAccountForm && newAccount.category && tab !== 'communication') {
      const catIsPayment = isPaymentCategory(newAccount.category);
      if ((tab === 'payment') !== catIsPayment) {
        resetNewAccountForm();
      }
    }
  };

  const renderSelectedAccountDetail = (account: TradingAccount) => {
    const isEditingAccount = editingAccountId === account.id;
    const isLocalWallet = isLocalWalletProvider(account.provider);
    const accountHealthMessage = healthMessageByAccount[account.id];
    const cexDepositSlice = cexDataByAccount[account.id]?.depositAddresses;
    const cexBalancesSlice = cexDataByAccount[account.id]?.balances;
    const cexMainnetDeposit = pickMainnetDepositAddress(cexDepositSlice?.data ?? []);
    const cexDepositField = cexMainnetDeposit ? `cex-deposit:${cexMainnetDeposit.address}` : '';
    const cexBalanceSummary = formatCexBalanceSummary(cexBalancesSlice?.data);
    const summaryView = buildAccountSummaryViewModel(account);
    const revealedCredentials = revealedCredentialsByAccount[account.id];
    const visibleCredentialFields = visibleCredentialFieldsByAccount[account.id] ?? {};
    const credentialsRevealing = revealingCredentialsByAccount[account.id] === true;

    return (
      <AccountDetailPane
        account={account}
        summaryView={summaryView}
        healthMessage={isPaymentCategory(account.category || 'Uncategorized') ? undefined : accountHealthMessage}
        onDismissHealthMessage={isPaymentCategory(account.category || 'Uncategorized') ? undefined : () => dismissHealthMessage(account.id)}
        onToggleActive={() => withReload(async () => {
          await updateAccount(account.id, {
            provider: account.provider,
            category: account.category,
            // The account list masks secrets. Keep them unchanged while updating
            // only the activation flag.
            email: '***',
            password: '***',
            phone: '***',
            payment_tag: '***',
            is_active: !account.is_active,
          });
        })}
        actions={
          <>
            {!isPaymentCategory(account.category || 'Uncategorized') ? (
              <button
                type="button"
                className={`${compactButtonCls} disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={!!checkingHealthByAccount[account.id]}
                onClick={() => void triggerHealthCheck(account)}
              >
                {checkingHealthByAccount[account.id] ? 'Checking…' : 'Healthcheck'}
              </button>
            ) : null}
            {!isEditingAccount && (showDexIdentitySections(account.provider) || isLndWalletProvider(account.provider)) ? (
              <button type="button" className={compactButtonCls} onClick={() => startAccountEdit(account)}>
                Edit
              </button>
            ) : null}
            {!isLocalWalletProvider(account.provider) ? (
              <button
                type="button"
                className={`${compactButtonCls} text-red`}
                onClick={() => withReload(async () => { await deleteAccount(account.id); })}
              >
                Delete
              </button>
            ) : null}
          </>
        }
        overview={
          isEditingAccount ? (
            <AccountEditor
              value={editingAccount}
              onChange={setEditingAccount}
              submitLabel="Save"
              compact
              submitDisabled={isLndWalletProvider(account.provider) && !editingAccount.password.trim()}
              showContactFields={showDexIdentitySections(account.provider)}
              showWalletPasswordOnly={isLndWalletProvider(account.provider)}
              onCancel={() => setEditingAccountId(null)}
              onSubmit={() =>
                withReload(async () => {
                  if (account.id > 0) {
                    await updateAccount(account.id, editingAccount);
                  } else {
                    await createAccount(editingAccount);
                  }
                  setEditingAccountId(null);
                })
              }
            />
          ) : (
            <div className="grid gap-3">
              {summaryView.capabilityBadges.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {summaryView.capabilityBadges.map(badge => (
                    <span key={badge} className="rounded-full border border-border px-2 py-0.5 text-[0.68rem] text-muted">
                      {badge}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="grid gap-2 text-xs text-muted sm:grid-cols-2 xl:grid-cols-3">
                {isPaymentCategory(account.category || 'Uncategorized') ? (
                  <fieldset
                    className="grid gap-1 sm:col-span-2 xl:col-span-3"
                    disabled={savingNotificationChannelsByAccount[account.id]}
                  >
                    <legend className="mb-1 text-text">Incoming payment notification channels</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {([
                        ['push', 'Push endpoint'],
                        ['email', 'Email'],
                      ] as const).map(([channel, label]) => (
                        <label key={channel} className="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={account.notification_channels?.includes(channel) ?? false}
                            onChange={event => void setNotificationChannel(account, channel, event.target.checked)}
                          />
                          <span>{label} confirmed</span>
                        </label>
                      ))}
                      {savingNotificationChannelsByAccount[account.id] ? (
                        <span className="text-muted">Saving…</span>
                      ) : null}
                    </div>
                    <span className="text-[0.65rem] text-muted">
                      Confirm each channel that can report an incoming payment for this account.
                    </span>
                  </fieldset>
                ) : null}
                {!isPaymentCategory(account.category || 'Uncategorized') ? (
                  <div>
                    <span className="text-text">Last check:</span> {formatDate(account.last_health_check)}
                  </div>
                ) : null}
                <div className="sm:col-span-2 xl:col-span-2">
                  <span className="text-text">Credentials:</span> {accountCredentialSummary(account)}
                </div>
                {isBisq1Provider(account.provider) ? <div><span className="text-text">Bisq 1:</span> {serviceVersions?.bisq1 || 'Unavailable'}</div> : null}
                {isBisq2Provider(account.provider) ? <div><span className="text-text">Bisq 2:</span> {serviceVersions?.bisq2 || 'Unavailable'}</div> : null}
                {isLndWalletProvider(account.provider) ? <div><span className="text-text">LND:</span> {serviceVersions?.lnd || 'Unavailable'}</div> : null}
                {!isCexAccount(account) && !isLndWalletProvider(account.provider) && (account.email || account.password || account.phone || account.payment_tag) ? (
                  <>
                    <div className="flex items-center gap-1">
                      <span><span className="text-text">Email:</span> {visibleCredentialFields.email ? revealedCredentials?.email : (account.email ? '••••••••' : '—')}</span>
                      {account.email ? <button type="button" className="text-muted hover:text-text" aria-label={visibleCredentialFields.email ? 'Hide email' : 'Show email'} onClick={() => void toggleCredentialReveal(account, 'email')} disabled={credentialsRevealing}>👁</button> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <span><span className="text-text">Password:</span> {visibleCredentialFields.password ? revealedCredentials?.password : (account.password ? '••••••••' : '—')}</span>
                      {account.password ? <button type="button" className="text-muted hover:text-text" aria-label={visibleCredentialFields.password ? 'Hide password' : 'Show password'} onClick={() => void toggleCredentialReveal(account, 'password')} disabled={credentialsRevealing}>👁</button> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <span><span className="text-text">Phone:</span> {visibleCredentialFields.phone ? revealedCredentials?.phone : (account.phone ? '••••••••' : '—')}</span>
                      {account.phone ? <button type="button" className="text-muted hover:text-text" aria-label={visibleCredentialFields.phone ? 'Hide phone' : 'Show phone'} onClick={() => void toggleCredentialReveal(account, 'phone')} disabled={credentialsRevealing}>👁</button> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <span><span className="text-text">Payment Tag:</span> {visibleCredentialFields.payment_tag ? revealedCredentials?.payment_tag : (account.payment_tag ? '••••••••' : '—')}</span>
                      {account.payment_tag ? <button type="button" className="text-muted hover:text-text" aria-label={visibleCredentialFields.payment_tag ? 'Hide payment tag' : 'Show payment tag'} onClick={() => void toggleCredentialReveal(account, 'payment_tag')} disabled={credentialsRevealing}>👁</button> : null}
                    </div>
                  </>
                ) : null}
                {isCexAccount(account) ? (
                  <>
                    <div className="sm:col-span-2 xl:col-span-3">
                      <span className="text-text">Deposit address:</span>{' '}
                      {cexDepositSlice?.loading && !cexMainnetDeposit ? (
                        <span>Loading…</span>
                      ) : cexDepositSlice?.error && !cexMainnetDeposit ? (
                        <span className="text-red">{cexDepositSlice.error}</span>
                      ) : cexMainnetDeposit ? (
                        <span className="inline-flex items-center gap-1"><span className="font-mono break-all text-text">{visibleAccountSecretsByAccount[account.id]?.[cexDepositField] ? cexMainnetDeposit.address : '••••••••'}</span><button type="button" className="text-muted hover:text-text" aria-label={visibleAccountSecretsByAccount[account.id]?.[cexDepositField] ? 'Hide deposit address' : 'Show deposit address'} onClick={() => toggleLocalSecretVisibility(account.id, cexDepositField)}>👁</button></span>
                      ) : cexDepositSlice && !cexDepositSlice.loading ? (
                        <span className="text-muted">No BTC deposit address on this account yet.</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                    <div className="sm:col-span-2 xl:col-span-3">
                      <span className="text-text">Balances:</span>{' '}
                      {cexBalancesSlice?.loading && !cexBalanceSummary ? (
                        <span>Loading…</span>
                      ) : cexBalancesSlice?.error && !cexBalanceSummary ? (
                        <span className="text-red">{cexBalancesSlice.error}</span>
                      ) : cexBalanceSummary ? (
                        <span className="text-text">{cexBalanceSummary}</span>
                      ) : cexBalancesSlice && !cexBalancesSlice.loading ? (
                        <span className="text-muted">No balances returned.</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )
        }
      >
        {isBisqProvider(account.provider) ? renderAccountFileSection(account) : null}
        {isBisq1Provider(account.provider) ? renderSavedPaymentMethodsSection(account) : null}
        {chatExchangeForProvider(account.provider) ? renderChatPaymentMethodsSection(account) : null}
        {showDexIdentitySections(account.provider) ? renderTOTPSection(account) : null}
        {showDexIdentitySections(account.provider) ? renderPasskeysSection(account) : null}
        {renderSeedsSection(account)}
        {isLndWalletProvider(account.provider) ? renderLNDBackupSection(account) : null}
        {isLndWalletProvider(account.provider) ? renderLightningManagementSection(account) : null}
        {isLndWalletProvider(account.provider) ? renderWalletAddressesSection(account) : null}
        {isCexAccount(account) ? renderCexWithdrawalAddressesSection(account) : null}
        {isCexAccount(account) ? renderCexHedgingSection(account) : null}
        {isCexAccount(account) ? renderCexSpotTradesSection(account) : null}
        {renderBankAccountsSection(account)}
        {!isLocalWallet && !isBankAccount(account) && account.category !== 'Fiat Transmitter' ? renderAPIKeysSection(account) : null}
      </AccountDetailPane>
    );
  };

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div
        data-testid="trading-accounts-panel"
        className="h-full min-h-0 rounded-lg border border-border bg-surface p-3 flex flex-col gap-3 overflow-hidden"
      >
        <AccountsToolbar
          activeTab={activeTab}
          paymentAccountCount={paymentAccountCount}
          tradingAccountCount={tradingAccountCount}
          onSelectTab={handleSubtabSelect}
          showActions={activeTab !== 'communication'}
          showNewAccountForm={showNewAccountForm}
          onToggleNewAccount={handleToggleNewAccountForm}
          onRefresh={() => void load()}
        />

        {activeTab === 'communication' ? (
          <div className="grid min-h-0 flex-1 items-start gap-4 overflow-y-auto pr-1 xl:grid-cols-2">
            <TelegramBotSection />
            <PhonePushSetupSection />
          </div>
        ) : showNewAccountForm ? (
          <div className="grid gap-2 rounded-lg border border-border bg-bg p-3">
            <div className={`grid items-start gap-2 ${newAccount.category ? 'sm:grid-cols-[12rem_minmax(0,1fr)]' : ''}`}>
              <label className="grid min-w-0 gap-1 text-xs text-muted">
                <span>Category</span>
                <select
                  className={compactInputCls}
                  value={newAccount.category}
                  onChange={e => setNewAccount({ ...emptyAccountForm(), category: e.target.value })}
                >
                  <option value="" disabled hidden>Choose a category</option>
                  {activeTab === 'payment' ? (
                    <>
                      <option value="Fiat Transmitter">Fiat Transmitter</option>
                      <option value="Bank">Bank</option>
                      <option value="Wallet addresses">Wallet addresses</option>
                    </>
                  ) : (
                    <>
                      <option value="DEX">DEX</option>
                      <option value="CEX">CEX</option>
                    </>
                  )}
                </select>
              </label>
              {newAccount.category ? (
                <AccountEditor
                  value={newAccount}
                  onChange={next => {
                    if (next.provider !== newAccount.provider) {
                      setNewAccountAPIKey(emptyAPIKeyForm());
                    }
                    setNewAccount({ ...next, category: newAccount.category });
                  }}
                  submitLabel="Add New Account"
                  compact
                  groupedProviders
                  providerCategory={newAccount.category}
                  freeFormProvider={newAccount.category === 'Bank' || newAccount.category === 'Wallet addresses'}
                  showContactFields={newAccount.category === 'Bank' || showContactFieldsForProvider(newAccount.provider)}
                  submitDisabled={
                    !newAccount.provider
                    || (usesAPIKeysAtCreate(newAccount.provider) && (
                      !newAccountAPIKey.api_key.trim()
                      || (apiKeyFormProfile(newAccount.provider).showSecret && !newAccountAPIKey.api_secret.trim())
                    ))
                  }
                  extraContent={
                    usesAPIKeysAtCreate(newAccount.provider) ? (
                      <APIKeyDraftFields
                        provider={newAccount.provider}
                        value={newAccountAPIKey}
                        onChange={setNewAccountAPIKey}
                      />
                    ) : null
                  }
                  onSubmit={() =>
                    withReload(async () => {
                      const usesAPIKeys = usesAPIKeysAtCreate(newAccount.provider);
                      const created = await createAccount({
                        provider: newAccount.provider,
                        category: newAccount.category || undefined,
                        email: newAccount.email,
                        password: newAccount.password,
                        phone: newAccount.phone,
                        payment_tag: newAccount.payment_tag,
                      });
                      if (usesAPIKeys && newAccountAPIKey.api_key.trim()) {
                        const profile = apiKeyFormProfile(newAccount.provider);
                        await createAPIKey(created.id, {
                          name: newAccountAPIKey.name,
                          api_key: newAccountAPIKey.api_key,
                          ...apiKeyPayloadExtras(profile, newAccountAPIKey),
                          is_active: newAccountAPIKey.is_active,
                        });
                      }
                      resetNewAccountForm();
                      setShowNewAccountForm(false);
                    })
                  }
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab !== 'communication' && error ? (
          <div className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</div>
        ) : null}

        {activeTab === 'communication' ? null : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 xl:overflow-hidden">
            {loading ? (
              <div className="rounded-lg border border-border bg-bg p-4 text-sm text-muted">Loading trading accounts…</div>
            ) : null}
            {!loading && accounts.length === 0 ? (
              <div className="rounded-lg border border-border bg-bg p-4 text-sm text-muted">No accounts yet.</div>
            ) : null}
            {!loading && accounts.length > 0 && activeGroups.length === 0 ? (
              <div className="rounded-lg border border-border bg-bg p-4 text-sm text-muted">
                {activeTab === 'payment' ? 'No payment accounts yet.' : 'No trading accounts yet.'}
              </div>
            ) : null}
            {!loading && activeGroups.length > 0 ? (
              <div className="grid min-h-full content-start gap-3 xl:h-full xl:grid-cols-[minmax(19rem,24rem)_minmax(0,1fr)] xl:gap-4">
                <div className="grid content-start gap-3 xl:min-h-0 xl:overflow-y-auto xl:pr-1">
                  <AccountsList
                    groups={activeGroups}
                    selectedAccountId={expandedId}
                    onSelectAccount={accountId => setExpandedId(accountId)}
                    onReorderPaymentAccounts={activeTab === 'payment' ? reorderPaymentAccountList : undefined}
                    serviceVersions={serviceVersions}
                    showCategoryDividers={activeTab !== 'payment'}
                  />
                  {selectedAccount ? (
                    <div className="xl:hidden">
                      {renderSelectedAccountDetail(selectedAccount)}
                    </div>
                  ) : null}
                </div>
                <div className="hidden xl:block xl:min-h-0 xl:overflow-y-auto xl:pl-1">
                  {selectedAccount ? (
                    renderSelectedAccountDetail(selectedAccount)
                  ) : (
                    <div className="rounded-lg border border-border bg-bg p-6 text-sm text-muted">
                      Select an account to inspect its details.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
