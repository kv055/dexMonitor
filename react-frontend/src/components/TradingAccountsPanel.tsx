import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode, type SetStateAction } from 'react';
import {
  createAccount,
  createAPIKey,
  createPasskey,
  createSeed,
  createTOTPSecret,
  deleteAccount,
  deleteAPIKey,
  deletePasskey,
  deleteSeed,
  deleteTOTPSecret,
  fetchTradingAccounts,
  runAccountHealthCheck,
  updateAccount,
  updateAPIKey,
  updatePasskey,
  updateSeed,
  updateTOTPSecret,
} from '../utils/api';
import type {
  TradingAccount,
} from '../types';

type ProviderOption = { value: string; label: string };

const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: '', label: 'Please select provider' },
  { value: 'Kraken', label: 'Kraken' },
  { value: 'Coinbase', label: 'Coinbase' },
  { value: 'Bitstamp', label: 'Bitstamp' },
  { value: 'Binance', label: 'Binance' },
  { value: 'ByBit', label: 'ByBit' },
  { value: 'KuCoin', label: 'KuCoin' },
  { value: 'Huobi', label: 'Huobi' },
  { value: 'HodlHodl', label: 'HodlHodl' },
  { value: 'Bisq', label: 'Bisq' },
  { value: 'Bisq2', label: 'Bisq2' },
  { value: 'Robosats', label: 'RoboSats' },
  { value: 'PayPal', label: 'PayPal' },
  { value: 'Revolut', label: 'Revolut' },
  { value: 'WISE', label: 'WISE' },
  { value: 'N26', label: 'N26' },
  { value: 'LND wallet', label: 'LND wallet' },
];

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
  const match = PROVIDER_OPTIONS.find(option => option.value.toLowerCase() === normalized);
  return match?.label ?? value;
}

function isRobosatsProvider(value: string) {
  return value.trim().toLowerCase() === 'robosats';
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateHash(sha256: string) {
  if (sha256.length <= 8) return sha256;
  return `${sha256.slice(0, 8)}…`;
}

function providerOptionsForValue(value: string): ProviderOption[] {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || PROVIDER_OPTIONS.some(option => option.value.toLowerCase() === trimmed)) {
    return PROVIDER_OPTIONS;
  }
  return [...PROVIDER_OPTIONS, { value: value.trim(), label: value }];
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

type AccountSectionKey = 'totp' | 'passkeys' | 'seeds' | 'apiKeys' | 'channelBackups';
type NewFormKey = 'totp' | 'passkeys' | 'seeds' | 'apiKeys';

interface TradingPanelUiState {
  expandedId: number | null;
  showNewAccountForm: boolean;
  newAccount: AccountFormState;
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
  healthMessageByAccount: Record<number, { message: string; healthy: boolean | null }>;
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
      <div className={`grid items-end gap-2 ${showContactFields ? 'md:grid-cols-[minmax(9rem,1.1fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_auto]' : showWalletPasswordOnly ? 'md:grid-cols-[minmax(9rem,1.1fr)_minmax(9rem,1fr)_auto]' : 'md:grid-cols-[minmax(9rem,1.1fr)_auto]'}`}>
        <label className={labelCls}>
          <span>Provider</span>
          <select
            className={fieldCls}
            value={value.provider}
            onChange={e => onChange({ ...value, provider: e.target.value })}
          >
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
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
          {options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
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

function SecretItem({
  title,
  meta,
  summary,
  children,
  actions,
  forceOpen = false,
}: {
  title: string;
  meta?: string;
  summary?: string;
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
  const [uiState, dispatchUi] = useReducer(tradingPanelUiReducer, undefined, () => ({
    expandedId: null,
    showNewAccountForm: false,
    newAccount: emptyAccountForm(),
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
  const setEditingAccountId = useCallback((value: SetStateAction<number | null>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingAccountId: resolveState(value, state.editingAccountId) }) });
  }, []);
  const setEditingAccount = useCallback((value: SetStateAction<AccountFormState>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, editingAccount: resolveState(value, state.editingAccount) }) });
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
      const next = await fetchTradingAccounts();
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

  const withReload = async (fn: () => Promise<void>) => {
    try {
      setError(null);
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trading accounts request failed');
    }
  };

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
            [account.id]: { message: result.message, healthy: result.healthy },
          },
        }),
      });
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

  const renderChannelBackupSection = (account: TradingAccount) => {
    const backup = account.lnd_channel_backup;
    const open = openSectionsByAccount[account.id]?.channelBackups ?? !!backup;
    return (
      <CollapsibleSection
        title="Channel backups"
        count={backup?.channel_count ?? 0}
        open={open}
        onToggle={() => toggleSection(account.id, 'channelBackups')}
      >
        <p className="text-[0.65rem] text-muted leading-relaxed px-1">
          Read-only metadata for the latest Lightning static channel backup stored in the database.
        </p>
        {backup ? (
          <div className="rounded border border-border bg-bg px-2 py-1.5 grid gap-1 text-xs text-muted sm:grid-cols-2">
            <div><span className="text-text">Backup ID:</span> {backup.id}</div>
            <div><span className="text-text">Channels:</span> {backup.channel_count}</div>
            <div><span className="text-text">Size:</span> {formatFileSize(backup.backup_size_bytes)}</div>
            <div><span className="text-text">Backed up:</span> {formatDate(backup.created_at)}</div>
            <div className="sm:col-span-2"><span className="text-text">SHA256:</span> {backup.backup_sha256}</div>
          </div>
        ) : (
          <div className="text-[0.65rem] text-muted px-1">
            No channel backup stored yet — mm-controller exports backups after LND starts and on a periodic interval.
          </div>
        )}
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
    const isRobosats = isRobosatsProvider(account.provider);
    const sectionTitle = isRobosats ? 'Robot Token' : 'API Keys';
    const newTitle = isRobosats ? 'New Robot Token' : 'New API Key';
    const keyPlaceholder = isRobosats ? 'Robot token' : 'API key';
    const createLabel = isRobosats ? 'Create Robot Token' : 'Create API Key';
    const open = !!openSectionsByAccount[account.id]?.apiKeys;
    const showNew = !!showNewFormByAccount[account.id]?.apiKeys;
    return (
      <CollapsibleSection
        title={sectionTitle}
        count={account.api_keys.length}
        open={open}
        onToggle={() => toggleSection(account.id, 'apiKeys')}
        actions={
          <button type="button" className={compactButtonCls} onClick={() => setShowNewForm(account.id, 'apiKeys', !showNew)}>
            {showNew ? 'Cancel' : 'Add'}
          </button>
        }
      >
        {account.api_keys.map(key => {
          const edit = editingAPIKeyById[key.id];
          const form = edit ?? {
            name: key.name,
            api_key: key.api_key,
            api_secret: key.api_secret ?? '',
            passphrase: key.passphrase ?? '',
            is_active: key.is_active,
          };
          return (
            <SecretItem
              key={key.id}
              forceOpen={!!edit}
              title={key.name}
              meta={key.is_active ? 'Active' : 'Inactive'}
              summary={key.api_key.length > 40 ? `${key.api_key.slice(0, 40)}…` : key.api_key}
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
                    <input className={compactInputCls} value={form.name} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, name: e.target.value } }))} placeholder="Name" />
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input type="checkbox" checked={form.is_active} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, is_active: e.target.checked } }))} />
                      Active
                    </label>
                    <textarea className={`${textareaCls} md:col-span-2`} value={form.api_key} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, api_key: e.target.value } }))} placeholder={keyPlaceholder} />
                    {!isRobosats ? (
                      <>
                        <textarea className={`${textareaCls} md:col-span-2`} value={form.api_secret} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, api_secret: e.target.value } }))} placeholder="API secret" />
                        <input className={`${compactInputCls} md:col-span-2`} value={form.passphrase} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, passphrase: e.target.value } }))} placeholder="Passphrase" />
                      </>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button type="button" className={compactButtonCls} onClick={() => withReload(async () => {
                      await updateAPIKey(key.id, {
                        name: form.name,
                        api_key: form.api_key,
                        api_secret: isRobosats ? null : form.api_secret || null,
                        passphrase: isRobosats ? null : form.passphrase || null,
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
                  {!isRobosats && key.api_secret ? <div><span className="text-text">Secret:</span> ••••••••</div> : null}
                  {!isRobosats && key.passphrase ? <div><span className="text-text">Passphrase:</span> ••••••••</div> : null}
                  <div>Updated {formatDate(key.updated_at)}</div>
                </div>
              )}
            </SecretItem>
          );
        })}
        {showNew ? (
          <ResourceCard title={newTitle}>
            <div className="grid gap-1.5 md:grid-cols-2">
              <input className={compactInputCls} value={draft.name} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, name: e.target.value } }))} placeholder="Name" />
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={draft.is_active} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, is_active: e.target.checked } }))} />
                Active
              </label>
              <textarea className={`${textareaCls} md:col-span-2`} value={draft.api_key} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, api_key: e.target.value } }))} placeholder={keyPlaceholder} />
              {!isRobosats ? (
                <>
                  <textarea className={`${textareaCls} md:col-span-2`} value={draft.api_secret} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, api_secret: e.target.value } }))} placeholder="API secret" />
                  <input className={`${compactInputCls} md:col-span-2`} value={draft.passphrase} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, passphrase: e.target.value } }))} placeholder="Passphrase" />
                </>
              ) : null}
            </div>
            <div className="mt-1.5 flex justify-end">
              <button type="button" className={compactButtonCls} onClick={() => withReload(async () => {
                await createAPIKey(account.id, {
                  name: draft.name,
                  api_key: draft.api_key,
                  api_secret: isRobosats ? null : draft.api_secret || null,
                  passphrase: isRobosats ? null : draft.passphrase || null,
                  is_active: draft.is_active,
                });
                setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { name: '', api_key: '', api_secret: '', passphrase: '', is_active: true } }));
                setShowNewForm(account.id, 'apiKeys', false);
              })}>{createLabel.replace('Create ', '')}</button>
            </div>
          </ResourceCard>
        ) : null}
        {!showNew && account.api_keys.length === 0 ? (
          <div className="text-[0.65rem] text-muted px-1">No {isRobosats ? 'robot tokens' : 'API keys'} yet.</div>
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
            <button type="button" className={compactPrimaryButtonCls} onClick={() => setShowNewAccountForm(prev => !prev)}>
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
            onChange={setNewAccount}
            submitLabel="Add New Account"
            compact
            submitDisabled={!newAccount.provider}
            onSubmit={() =>
              withReload(async () => {
                await createAccount(newAccount);
                setNewAccount(emptyAccountForm());
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
              <div className="flex items-center gap-2 py-0.5">
                <div className="h-px flex-1 bg-border" />
                <div className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted">
                  {group.category}
                </div>
                <div className="h-px flex-1 bg-border" />
              </div>
              {group.accounts.map(account => {
                const expanded = expandedId === account.id;
                const isEditingAccount = editingAccountId === account.id;
                const isLocalWallet = isLocalWalletProvider(account.provider);
                const accountHealthMessage = healthMessageByAccount[account.id];
                const healthMessageHealthy = accountHealthMessage?.healthy === true;
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
                          {checkingHealthByAccount[account.id] ? '…' : 'Health'}
                        </button>
                        {!isLocalWallet ? (
                          <>
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                              {account.totp_secrets.length} TOTP
                            </span>
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                              {account.passkey_credentials.length} Passkeys
                            </span>
                          </>
                        ) : null}
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                          {isLndWalletProvider(account.provider)
                            ? `${account.seeds.length} Aezeed`
                            : `${account.seeds.length} Seeds`}
                        </span>
                        {isBisqProvider(account.provider) ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                            {account.account_file_backup ? 'Account file' : 'No file'}
                          </span>
                        ) : null}
                        {isLndWalletProvider(account.provider) ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                            {account.lnd_channel_backup
                              ? `${account.lnd_channel_backup.channel_count} ch backup`
                              : 'No ch backup'}
                          </span>
                        ) : null}
                        {!isLocalWallet ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted whitespace-nowrap">
                            {account.api_keys.length} {isRobosatsProvider(account.provider) ? 'Tokens' : 'API Keys'}
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
                        <p className={`flex-1 text-xs leading-relaxed break-words ${healthMessageHealthy ? 'text-green' : 'text-red'}`}>
                          {accountHealthMessage.message}
                        </p>
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
                              {!isEditingAccount ? (
                                <button type="button" className={compactButtonCls} onClick={() => startAccountEdit(account)}>
                                  Edit
                                </button>
                              ) : null}
                              <button type="button" className={`${compactButtonCls} text-red`} onClick={() => withReload(async () => { await deleteAccount(account.id); })}>
                                Delete
                              </button>
                            </div>
                          </div>
                          {isEditingAccount ? (
                            <AccountEditor
                              value={editingAccount}
                              onChange={setEditingAccount}
                              submitLabel="Save"
                              compact
                              showContactFields={!isLocalWallet && !isLndWalletProvider(account.provider)}
                              showWalletPasswordOnly={isLndWalletProvider(account.provider)}
                              onCancel={() => setEditingAccountId(null)}
                              onSubmit={() =>
                                withReload(async () => {
                                  await updateAccount(account.id, editingAccount);
                                  setEditingAccountId(null);
                                })
                              }
                            />
                          ) : (
                            <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                              <div><span className="text-text">Provider:</span> {providerLabel(account.provider)}</div>
                              <div><span className="text-text">Category:</span> {account.category}</div>
                              <div><span className="text-text">Health:</span> <span className={account.is_healthy ? 'text-green' : 'text-red'}>{account.is_healthy ? 'Healthy' : 'Unhealthy'}</span></div>
                              <div><span className="text-text">Last check:</span> {formatDate(account.last_health_check)}</div>
                              {!isLocalWallet ? (
                                <>
                                  <div><span className="text-text">Email:</span> {account.email || '—'}</div>
                                  <div><span className="text-text">Password:</span> {account.password ? '••••••••' : '—'}</div>
                                  <div className="sm:col-span-2"><span className="text-text">Phone:</span> {account.phone || '—'}</div>
                                </>
                              ) : null}
                              {isLndWalletProvider(account.provider) ? (
                                <div className="sm:col-span-2"><span className="text-text">Wallet password:</span> {account.password ? '••••••••' : '—'}</div>
                              ) : null}
                            </div>
                          )}
                        </div>

                        {isBisqProvider(account.provider) ? renderAccountFileSection(account) : null}
                        {!isLocalWallet ? renderTOTPSection(account) : null}
                        {!isLocalWallet ? renderPasskeysSection(account) : null}
                        {renderSeedsSection(account)}
                        {isLndWalletProvider(account.provider) ? renderChannelBackupSection(account) : null}
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
