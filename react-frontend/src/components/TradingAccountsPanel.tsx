import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode, type SetStateAction } from 'react';
import {
  createAccount,
  createAPIKey,
  closeLNDChannel,
  createLNDWalletAddress,
  createPasskey,
  createSeed,
  createTOTPSecret,
  deleteAccount,
  deleteAPIKey,
  deletePasskey,
  deleteSeed,
  deleteTOTPSecret,
  fetchCexBalances,
  fetchCexDepositAddresses,
  fetchCexHedgePositions,
  fetchCexSpotTrades,
  fetchCexWithdrawalAddresses,
  fetchLNDWalletState,
  fetchLNDWalletStatus,
  fetchTradingAccounts,
  initLNDWallet,
  openLNDChannel,
  runAccountHealthCheck,
  updateAccount,
  updateAPIKey,
  updatePasskey,
  updateSeed,
  updateTOTPSecret,
} from '../utils/api';
import type {
  CexBalancesResponse,
  CexDepositAddress,
  CexHedgePosition,
  CexHedgePositionsResponse,
  CexSpotTrade,
  CexWithdrawalAddress,
  LNDWalletState,
  LNDWalletStatus,
  TradingAccount,
  TradingAccountKeyPermissionResult,
} from '../types';

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

const CREATABLE_PROVIDER_CATEGORIES = ['Fiat Transmitter', 'DEX', 'CEX'] as const;

const CATEGORY_ORDER = ['Fiat Transmitter', 'DEX', 'CEX', 'Internal Infrastructure', 'Uncategorized'];

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

function groupedCreatableProviders() {
  return CREATABLE_PROVIDER_CATEGORIES.map(category => ({
    category,
    providers: PROVIDER_DEFINITIONS.filter(provider => provider.creatable && provider.category === category),
  })).filter(group => group.providers.length > 0);
}

function createPlaceholderAccount(provider: string, category: string, id: number): TradingAccount {
  return {
    id,
    provider,
    category,
    email: null,
    password: null,
    phone: null,
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
  };
}

function withInfrastructureAccounts(accounts: TradingAccount[]): TradingAccount[] {
  const result = [...accounts];
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

function APIKeyPermissionChips({ permissions }: { permissions: Record<string, boolean> }) {
  const entries = Object.entries(permissions).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([name, granted]) => (
        <span
          key={name}
          className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] whitespace-nowrap ${
            granted
              ? 'border-green/40 bg-green/10 text-green'
              : 'border-red/40 bg-red/10 text-red'
          }`}
        >
          {formatPermissionLabel(name)} {granted ? '✓' : '✗'}
        </span>
      ))}
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

function providerOptionsForValue(value: string): ProviderOption[] {
  const options: ProviderOption[] = [
    { value: '', label: 'Please select provider' },
    ...PROVIDER_DEFINITIONS.map(provider => ({ value: provider.value, label: provider.label })),
  ];
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || options.some(option => option.value.toLowerCase() === trimmed)) {
    return options;
  }
  return [...options, { value: value.trim(), label: value }];
}

function renderProviderSelectOptions(grouped: boolean, flatOptions: ProviderOption[]) {
  if (grouped) {
    return (
      <>
        <option value="" disabled hidden>
          Please select provider
        </option>
        {groupedCreatableProviders().map(group => (
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
  email: string;
  password: string;
  phone: string;
}

type AccountSectionKey =
  | 'totp'
  | 'passkeys'
  | 'seeds'
  | 'apiKeys'
  | 'lndBackup'
  | 'lightningManagement'
  | 'walletAddresses'
  | 'cexHedging'
  | 'cexSpotTrades'
  | 'cexWithdrawalAddresses';

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
  return { provider: '', email: '', password: '', phone: '' };
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
  extraContent?: ReactNode;
}) {
  const options = useMemo(() => providerOptionsForValue(value.provider), [value.provider]);
  const fieldCls = compact
    ? 'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent'
    : inputCls;
  const labelCls = compact ? 'grid min-w-0 gap-1 text-xs text-muted' : 'grid gap-1 text-sm text-muted';
  const submitCls = submitDisabled
    ? `${primaryButtonCls} cursor-not-allowed opacity-50`
    : primaryButtonCls;

  if (compact) {
    return (
      <div className="grid gap-2">
        <div className={`grid items-end gap-2 ${showContactFields ? 'md:grid-cols-[minmax(9rem,1.1fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_auto]' : showWalletPasswordOnly ? 'md:grid-cols-[minmax(9rem,1.1fr)_minmax(9rem,1fr)_auto]' : 'md:grid-cols-[minmax(9rem,1.1fr)_auto]'}`}>
          <label className={labelCls}>
            <span>Provider</span>
            <select
              className={fieldCls}
              value={value.provider}
              onChange={e => onChange({ ...value, provider: e.target.value })}
            >
              {renderProviderSelectOptions(groupedProviders, options)}
            </select>
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
            <button type="button" className={submitCls} disabled={submitDisabled} onClick={onSubmit}>
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
        <select
          className={fieldCls}
          value={value.provider}
          onChange={e => onChange({ ...value, provider: e.target.value })}
        >
          {renderProviderSelectOptions(groupedProviders, options)}
        </select>
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
        <button type="button" className={submitCls} disabled={submitDisabled} onClick={onSubmit}>
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
        {actions ? <div className="flex shrink-0 items-center gap-1" onClick={e => e.stopPropagation()}>{actions}</div> : null}
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
}: {
  title: string;
  meta?: string;
  summary?: string;
  footer?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
  return (
    <div className="rounded border border-border bg-bg">
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

export function TradingAccountsPanel() {
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lndWalletStatus, setLndWalletStatus] = useState<LNDWalletStatus | null>(null);
  const [lndWalletLoading, setLndWalletLoading] = useState(false);
  const [lndWalletError, setLndWalletError] = useState<string | null>(null);
  const [lndWalletNotice, setLndWalletNotice] = useState<string | null>(null);
  const [lndWalletState, setLndWalletState] = useState<LNDWalletState | null>(null);
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

  const expandedAccount = useMemo(
    () => accounts.find(account => account.id === expandedId) ?? null,
    [accounts, expandedId],
  );

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
    if (!expandedAccount || !isLndWalletProvider(expandedAccount.provider)) {
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
  }, [expandedAccount, loadLndWalletState, loadLndWalletStatus]);

  useEffect(() => {
    if (!expandedAccount || !isCexAccount(expandedAccount)) {
      return;
    }
    void loadCexSection(expandedAccount.id, 'cexDepositAddresses');
    void loadCexSection(expandedAccount.id, 'cexBalances');
  }, [expandedAccount, loadCexSection]);

  const withReload = async (fn: () => Promise<void>) => {
    try {
      setError(null);
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trading accounts request failed');
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

  const startAccountEdit = (account: TradingAccount) => {
    setEditingAccountId(account.id);
    setEditingAccount({
      provider: account.provider,
      email: account.email ?? '',
      password: account.password ?? '',
      phone: account.phone ?? '',
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
                  <pre className="overflow-x-auto rounded border border-border bg-surface p-2 text-[0.65rem] text-text whitespace-pre-wrap break-all">{secret.secret}</pre>
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
              summary={cred.credential_id.length > 40 ? `${cred.credential_id.slice(0, 40)}…` : cred.credential_id}
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
                <div className="grid gap-1 text-[0.65rem] text-muted">
                  <div><span className="text-text">Credential:</span> {cred.credential_id}</div>
                  <div><span className="text-text">User handle:</span> {cred.user_handle || '—'}</div>
                  <div><span className="text-text">Sign count:</span> {cred.sign_count}</div>
                  <div><span className="text-text">Last used:</span> {formatDate(cred.last_used_at)}</div>
                  <div><span className="text-text">Created:</span> {formatDate(cred.created_at)}</div>
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
              <pre className="overflow-x-auto rounded border border-border bg-surface p-2 text-[0.65rem] text-text whitespace-pre-wrap break-all">
                {account.password}
              </pre>
            ) : (
              <div className="text-[0.65rem] text-muted">Set the wallet password in Account → Edit before starting mm-controller.</div>
            )}
          </BackupField>

          <BackupField title="Aezeed seed" meta={seed ? formatDate(seed.created_at) : undefined}>
            {seed ? (
              <pre className="overflow-x-auto rounded border border-border bg-surface p-2 text-[0.65rem] text-text whitespace-pre-wrap break-all">
                {seed.seed_phrase}
              </pre>
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
            A wallet already exists but mm-controller couldn&apos;t unlock it — the saved
            password may not match the wallet. Update it under Account → Edit, then restart
            mm-controller.
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
                {lndWalletStatus.pending_channels.map((pending, index) => (
                  <div key={`${pending.remote_pubkey}-${pending.state}-${index}`} className="rounded border border-border bg-bg px-2 py-1.5 text-xs text-muted">
                    <div><span className="text-text">Hub:</span> {pending.remote_alias || truncatePubkey(pending.remote_pubkey)}</div>
                    <div><span className="text-text">State:</span> {pending.state}</div>
                    <div><span className="text-text">Capacity:</span> {formatSats(pending.capacity_sat)}</div>
                  </div>
                ))}
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
              lndWalletStatus.addresses.map(entry => (
                <div key={`${entry.kind}-${entry.address}`} className="rounded border border-border bg-bg px-2 py-1.5 grid gap-1 text-xs text-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-text font-medium">
                      {entry.kind === 'lightning' ? 'Lightning node' : 'On-chain'}
                    </span>
                    {entry.label ? (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem]">{entry.label}</span>
                    ) : null}
                    {entry.is_internal ? (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem]">Internal</span>
                    ) : null}
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[0.65rem] text-text">{entry.address}</pre>
                  {entry.kind === 'onchain' ? (
                    <div><span className="text-text">Balance:</span> {formatSats(entry.balance_sat)}</div>
                  ) : null}
                </div>
              ))
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
          <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
            <div><span className="text-text">File:</span> {backup.file_name}</div>
            <div><span className="text-text">Size:</span> {formatFileSize(backup.file_size_bytes)}</div>
            <div><span className="text-text">Modified:</span> {formatDate(backup.modified_at ?? backup.created_at)}</div>
            <div><span className="text-text">SHA256:</span> {truncateHash(backup.file_sha256)}</div>
          </div>
        ) : (
          <div className="text-[0.65rem] text-muted px-1">No account file backed up yet.</div>
        )}
      </div>
    );
  };

  const renderSeedsSection = (account: TradingAccount) => {
    const isLndWallet = isLndWalletProvider(account.provider);
    if (isLndWallet || isCexAccount(account) || !showDexIdentitySections(account.provider)) {
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
                  <pre className="overflow-x-auto rounded border border-border bg-surface p-2 text-[0.65rem] text-text whitespace-pre-wrap break-all">{seed.seed_phrase}</pre>
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
        {account.api_keys.map(key => {
          const edit = editingAPIKeyById[key.id];
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
              summary={key.api_key.length > 40 ? `${key.api_key.slice(0, 40)}…` : key.api_key}
              footer={key.permissions && Object.keys(key.permissions).length > 0 ? (
                <div className="grid gap-1">
                  <div className="text-[0.65rem] text-text">
                    Validation
                    {key.permissions_checked_at ? ` · checked ${formatDate(key.permissions_checked_at)}` : ''}
                  </div>
                  <APIKeyPermissionChips permissions={key.permissions} />
                </div>
              ) : null}
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
                  <pre className="overflow-x-auto rounded border border-border bg-surface p-2 text-text whitespace-pre-wrap break-all">{key.api_key}</pre>
                  {profile.showSecret && key.api_secret ? <div><span className="text-text">{profile.secretLabel}:</span> ••••••••</div> : null}
                  {profile.showPassphrase && key.passphrase ? <div><span className="text-text">Passphrase:</span> ••••••••</div> : null}
                  <div>Updated {formatDate(key.updated_at)}</div>
                </div>
              )}
            </SecretItem>
          );
        })}
        {showNew ? (
          <ResourceCard title={profile.newTitle}>
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
          </ResourceCard>
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
            {positions.active.length > 0
              ? positions.active.map(position => renderHedgePositionCard(position, 'Active'))
              : <div className="text-[0.65rem] text-muted px-1">No active hedge positions.</div>}
            <div className="text-xs font-semibold text-text px-1 pt-1">Past ({positions.past.length})</div>
            {positions.past.length > 0
              ? positions.past.map(position => renderHedgePositionCard(position, 'Past'))
              : <div className="text-[0.65rem] text-muted px-1">No past hedge positions.</div>}
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
            {addresses.map((entry, idx) => (
              <div
                key={`${entry.address}-${idx}`}
                className="flex flex-wrap items-baseline gap-x-1.5 px-1 py-0.5 text-[0.65rem] leading-tight border-b border-border/40 last:border-0"
              >
                {entry.label?.trim() ? (
                  <span className="max-w-[40%] truncate text-text" title={entry.label}>{entry.label}</span>
                ) : null}
                <span className="font-mono break-all text-muted">{entry.address}</span>
                {entry.network ? <span className="text-muted/60">{entry.network}</span> : null}
                {entry.tag ? <span className="text-muted/60">tag:{entry.tag}</span> : null}
                {entry.whitelisted === false ? <span className="text-yellow">unverified</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </CollapsibleSection>
    );
  };

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className="h-full min-h-0 rounded-lg border border-border bg-surface p-3 flex flex-col gap-3 overflow-hidden">
        <div className={`flex items-center justify-between gap-3 ${showNewAccountForm ? 'mb-3' : ''}`}>
          <div>
            <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Accounts Management</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={compactPrimaryButtonCls}
              onClick={() => {
                if (showNewAccountForm) {
                  resetNewAccountForm();
                }
                setShowNewAccountForm(prev => !prev);
              }}
            >
              {showNewAccountForm ? 'Cancel' : 'Add Account'}
            </button>
            <button type="button" className={compactButtonCls} onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>

        {showNewAccountForm ? (
          <AccountEditor
            value={newAccount}
            onChange={next => {
              if (next.provider !== newAccount.provider) {
                setNewAccountAPIKey(emptyAPIKeyForm());
              }
              setNewAccount(next);
            }}
            submitLabel="Add New Account"
            compact
            groupedProviders
            showContactFields={showContactFieldsForProvider(newAccount.provider)}
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
                  email: showContactFieldsForProvider(newAccount.provider) ? newAccount.email : '',
                  password: showContactFieldsForProvider(newAccount.provider) ? newAccount.password : '',
                  phone: showContactFieldsForProvider(newAccount.provider) ? newAccount.phone : '',
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

        {error ? (
          <div className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 grid content-start gap-1.5">
          {loading ? (
            <div className="rounded-lg border border-border bg-bg p-4 text-sm text-muted">Loading trading accounts…</div>
          ) : null}
          {!loading && accounts.length === 0 ? (
            <div className="rounded-lg border border-border bg-bg p-4 text-sm text-muted">No accounts yet.</div>
          ) : null}
          {groupedAccounts.map(group => (
            <div key={group.category} className="grid gap-1.5">
              {group.category !== 'Uncategorized' ? (
                <div className="flex items-center gap-2 py-0.5">
                  <div className="h-px flex-1 bg-border" />
                  <div className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted">
                    {group.category}
                  </div>
                  <div className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              {group.accounts.map(account => {
                const expanded = expandedId === account.id;
                const isEditingAccount = editingAccountId === account.id;
                const isLocalWallet = isLocalWalletProvider(account.provider);
                const accountHealthMessage = healthMessageByAccount[account.id];
                const healthMessageHealthy = accountHealthMessage?.healthy === true;
                const cexDepositSlice = cexDataByAccount[account.id]?.depositAddresses;
                const cexBalancesSlice = cexDataByAccount[account.id]?.balances;
                const cexMainnetDeposit = pickMainnetDepositAddress(cexDepositSlice?.data ?? []);
                const cexBalanceSummary = formatCexBalanceSummary(cexBalancesSlice?.data);
                return (
                  <div key={account.id} className="rounded-lg border border-border bg-bg">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
                      <div className="flex min-w-0 items-baseline gap-1.5 truncate">
                        <div className="truncate text-sm font-semibold text-text">{providerLabel(account.provider)}</div>
                        <div className="shrink-0 text-[0.68rem] text-muted whitespace-nowrap">
                          {formatAccountHeaderDate(account.created_at)}
                        </div>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-1 overflow-x-auto">
                        <HealthBadge account={account} compact />
                        <button
                          type="button"
                          className={compactButtonCls}
                          disabled={!!checkingHealthByAccount[account.id]}
                          onClick={() => void triggerHealthCheck(account)}
                        >
                          {checkingHealthByAccount[account.id] ? '…' : 'Healthcheck'}
                        </button>
                        {showDexIdentitySections(account.provider) ? (
                          <>
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                              {account.totp_secrets.length} TOTP
                            </span>
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                              {account.passkey_credentials.length} Passkeys
                            </span>
                          </>
                        ) : null}
                        {showDexIdentitySections(account.provider) ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                            {`${account.seeds.length} Seeds`}
                          </span>
                        ) : null}
                        {isBisqProvider(account.provider) ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                            {account.account_file_backup ? 'Account file' : 'No file'}
                          </span>
                        ) : null}
                        {isLndWalletProvider(account.provider) ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                            Backup
                          </span>
                        ) : null}
                        {!isLocalWallet ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                            {account.api_keys.length} {apiKeyFormProfile(account.provider).countLabel}
                          </span>
                        ) : null}
                        <button type="button" className={compactButtonCls} onClick={() => setExpandedId(expanded ? null : account.id)}>
                          {expanded ? '−' : '+'}
                        </button>
                      </div>
                    </div>
                    {accountHealthMessage ? (
                      <div
                        className={`border-t px-2.5 py-2 flex items-start gap-2 ${
                          healthMessageHealthy
                            ? 'border-green/30 bg-green/5'
                            : 'border-red/30 bg-red/5'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-relaxed break-words ${healthMessageHealthy ? 'text-green' : 'text-red'}`}>
                            {healthCheckDisplayMessage(accountHealthMessage.message, accountHealthMessage.keys, account.api_keys)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className={`${compactButtonCls} shrink-0 px-1.5 ${healthMessageHealthy ? 'text-green' : 'text-red'}`}
                          aria-label="Dismiss health check message"
                          onClick={() => dismissHealthMessage(account.id)}
                        >
                          ✕
                        </button>
                      </div>
                    ) : null}
                    {expanded ? (
                      <div className="border-t border-border px-2 py-2 grid gap-1.5">
                        <div className="grid gap-1.5 pb-1.5 border-b border-border">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-text">Account</span>
                            <div className="flex gap-1">
                              {!isEditingAccount && (showDexIdentitySections(account.provider) || isLndWalletProvider(account.provider)) ? (
                                <button type="button" className={compactButtonCls} onClick={() => startAccountEdit(account)}>
                                  Edit
                                </button>
                              ) : null}
                              {!isLocalWalletProvider(account.provider) ? (
                                <button type="button" className={`${compactButtonCls} text-red`} onClick={() => withReload(async () => { await deleteAccount(account.id); })}>
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {isEditingAccount ? (
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
                            <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                              <div><span className="text-text">Health:</span> <span className={account.is_healthy ? 'text-green' : 'text-red'}>{account.is_healthy ? 'Healthy' : 'Unhealthy'}</span></div>
                              <div><span className="text-text">Last check:</span> {formatDate(account.last_health_check)}</div>
                              {isCexAccount(account) ? (
                                <>
                                  <div className="sm:col-span-2">
                                    <span className="text-text">Deposit address:</span>{' '}
                                    {cexDepositSlice?.loading && !cexMainnetDeposit ? (
                                      <span>Loading…</span>
                                    ) : cexDepositSlice?.error && !cexMainnetDeposit ? (
                                      <span className="text-red">{cexDepositSlice.error}</span>
                                    ) : cexMainnetDeposit ? (
                                      <span className="font-mono text-[0.65rem] break-all text-text">{cexMainnetDeposit.address}</span>
                                    ) : (
                                      '—'
                                    )}
                                  </div>
                                  <div className="sm:col-span-2">
                                    <span className="text-text">Balance:</span>{' '}
                                    {cexBalancesSlice?.loading && !cexBalanceSummary ? (
                                      <span>Loading…</span>
                                    ) : cexBalancesSlice?.error && !cexBalanceSummary ? (
                                      <span className="text-red">{cexBalancesSlice.error}</span>
                                    ) : cexBalanceSummary ? (
                                      <span className="text-text">{cexBalanceSummary}</span>
                                    ) : (
                                      '—'
                                    )}
                                  </div>
                                </>
                              ) : null}
                              {showDexIdentitySections(account.provider) ? (
                                <>
                                  <div><span className="text-text">Email:</span> {account.email || '—'}</div>
                                  <div><span className="text-text">Password:</span> {account.password ? '••••••••' : '—'}</div>
                                  <div className="sm:col-span-2"><span className="text-text">Phone:</span> {account.phone || '—'}</div>
                                </>
                              ) : null}
                              {isLndWalletProvider(account.provider) ? (
                                <div>
                                  <span className="text-text">Wallet password:</span>{' '}
                                  {account.password ? '••••••••' : <span className="text-red">Not set</span>}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>

                        {isBisqProvider(account.provider) ? renderAccountFileSection(account) : null}
                        {showDexIdentitySections(account.provider) ? renderTOTPSection(account) : null}
                        {showDexIdentitySections(account.provider) ? renderPasskeysSection(account) : null}
                        {renderSeedsSection(account)}
                        {isLndWalletProvider(account.provider) ? renderLNDBackupSection(account) : null}
                        {isLndWalletProvider(account.provider) ? renderLightningManagementSection(account) : null}
                        {isLndWalletProvider(account.provider) ? renderWalletAddressesSection(account) : null}
                        {isCexAccount(account) ? renderCexWithdrawalAddressesSection(account) : null}
                        {isCexAccount(account) ? renderCexHedgingSection(account) : null}
                        {isCexAccount(account) ? renderCexSpotTradesSection(account) : null}
                        {!isLocalWallet ? renderAPIKeysSection(account) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
