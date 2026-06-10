import { useCallback, useEffect, useMemo, useReducer, useState, type SetStateAction } from 'react';
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
  'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent min-h-24';
const buttonCls =
  'rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-text transition hover:bg-surface';
const compactButtonCls =
  'rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-text transition hover:bg-surface';
const primaryButtonCls =
  'rounded-md border border-accent bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20';
const dangerButtonCls =
  'rounded-md border border-red/40 bg-red/10 px-3 py-2 text-sm font-medium text-red transition hover:bg-red/20';

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

interface TradingPanelUiState {
  expandedId: number | null;
  showNewAccountForm: boolean;
  newAccount: AccountFormState;
  editingAccountId: number | null;
  editingAccount: AccountFormState;
  newTOTPByAccount: Record<number, TOTPFormState>;
  editingTOTPById: Record<number, TOTPFormState>;
  newPasskeyByAccount: Record<number, PasskeyFormState>;
  editingPasskeyById: Record<number, PasskeyFormState>;
  newSeedByAccount: Record<number, SeedFormState>;
  editingSeedById: Record<number, SeedFormState>;
  newAPIKeyByAccount: Record<number, APIKeyFormState>;
  editingAPIKeyById: Record<number, APIKeyFormState>;
  checkingHealthByAccount: Record<number, boolean>;
  healthMessage: string | null;
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
  submitLabel,
  compact = false,
  submitDisabled = false,
}: {
  value: AccountFormState;
  onChange: (next: AccountFormState) => void;
  onSubmit: () => void;
  submitLabel: string;
  compact?: boolean;
  submitDisabled?: boolean;
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
      <div className="grid items-end gap-2 md:grid-cols-[minmax(9rem,1.1fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_auto]">
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
        <button type="button" className={submitCls} disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </button>
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
      <div className="md:col-span-4 flex justify-end">
        <button type="button" className={submitCls} disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </button>
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
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-text">{title}</div>
          {meta ? <div className="text-xs text-muted">{meta}</div> : null}
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
    newTOTPByAccount: {},
    editingTOTPById: {},
    newPasskeyByAccount: {},
    editingPasskeyById: {},
    newSeedByAccount: {},
    editingSeedById: {},
    newAPIKeyByAccount: {},
    editingAPIKeyById: {},
    checkingHealthByAccount: {},
    healthMessage: null,
  }));
  const {
    expandedId,
    showNewAccountForm,
    newAccount,
    editingAccountId,
    editingAccount,
    newTOTPByAccount,
    editingTOTPById,
    newPasskeyByAccount,
    editingPasskeyById,
    newSeedByAccount,
    editingSeedById,
    newAPIKeyByAccount,
    editingAPIKeyById,
    checkingHealthByAccount,
    healthMessage,
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
  const setHealthMessage = useCallback((value: SetStateAction<string | null>) => {
    dispatchUi({ type: 'UPDATE', update: state => ({ ...state, healthMessage: resolveState(value, state.healthMessage) }) });
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
    setHealthMessage(null);
    try {
      const result = await runAccountHealthCheck(account.id);
      setAccounts(prev => prev.map(item => (item.id === result.account.id ? result.account : item)));
      setHealthMessage(`${providerLabel(account.provider)}: ${result.message}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
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
    return (
      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-text">TOTP Secrets</h4>
          <button
            type="button"
            className={buttonCls}
            onClick={() =>
              setNewTOTPByAccount(prev => ({
                ...prev,
                [account.id]: draft,
              }))
            }
          >
            Add TOTP
          </button>
        </div>
        <div className="grid gap-3">
          {account.totp_secrets.map(secret => {
            const edit = editingTOTPById[secret.id];
            return (
              <ResourceCard
                key={secret.id}
                title={`Secret #${secret.id}`}
                meta={`Created ${formatDate(secret.created_at)}${secret.rotated_at ? ` • Rotated ${formatDate(secret.rotated_at)}` : ''}`}
              >
                {edit ? (
                  <div className="grid gap-3">
                    <textarea
                      className={textareaCls}
                      value={edit.secret}
                      onChange={e => setEditingTOTPById(prev => ({ ...prev, [secret.id]: { ...edit, secret: e.target.value } }))}
                    />
                    <label className="flex items-center gap-2 text-sm text-muted">
                      <input
                        type="checkbox"
                        checked={edit.is_active}
                        onChange={e => setEditingTOTPById(prev => ({ ...prev, [secret.id]: { ...edit, is_active: e.target.checked } }))}
                      />
                      Active
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={primaryButtonCls}
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
                        className={buttonCls}
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
                      <button
                        type="button"
                        className={dangerButtonCls}
                        onClick={() => withReload(async () => { await deleteTOTPSecret(secret.id); })}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    <pre className="overflow-x-auto rounded-md border border-border bg-surface p-3 text-xs text-text whitespace-pre-wrap break-all">{secret.secret}</pre>
                    <div className="text-xs text-muted">{secret.is_active ? 'Active' : 'Inactive'}</div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={buttonCls}
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
                        className={dangerButtonCls}
                        onClick={() => withReload(async () => { await deleteTOTPSecret(secret.id); })}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </ResourceCard>
            );
          })}
          <ResourceCard title="New TOTP Secret">
            <div className="grid gap-3">
              <textarea
                className={textareaCls}
                value={draft.secret}
                onChange={e => setNewTOTPByAccount(prev => ({ ...prev, [account.id]: { ...draft, secret: e.target.value } }))}
                placeholder="TOTP secret"
              />
              <label className="flex items-center gap-2 text-sm text-muted">
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
                  className={primaryButtonCls}
                  onClick={() =>
                    withReload(async () => {
                      await createTOTPSecret(account.id, draft);
                      setNewTOTPByAccount(prev => ({ ...prev, [account.id]: { secret: '', is_active: true } }));
                    })
                  }
                >
                  Create TOTP
                </button>
              </div>
            </div>
          </ResourceCard>
        </div>
      </div>
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
    return (
      <div className="grid gap-3">
        <h4 className="text-sm font-semibold text-text">Passkeys</h4>
        <div className="grid gap-3">
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
              <ResourceCard
                key={cred.id}
                title={cred.rp_id}
                meta={`Created ${formatDate(cred.created_at)} • Last used ${formatDate(cred.last_used_at)}`}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <input className={inputCls} value={form.credential_id} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, credential_id: e.target.value } }))} placeholder="Credential ID" disabled={!edit} />
                  <input className={inputCls} value={form.rp_id} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, rp_id: e.target.value } }))} placeholder="RP ID" disabled={!edit} />
                  <input className={inputCls} value={form.user_handle} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, user_handle: e.target.value } }))} placeholder="User handle" disabled={!edit} />
                  <input className={inputCls} value={form.sign_count} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, sign_count: e.target.value } }))} placeholder="Sign count" disabled={!edit} />
                  <input className={inputCls} value={form.last_used_at} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, last_used_at: e.target.value } }))} placeholder="Last used at (ISO timestamp)" disabled={!edit} />
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" checked={form.is_active} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, is_active: e.target.checked } }))} disabled={!edit} />
                    Active
                  </label>
                  <textarea className={`${textareaCls} md:col-span-2`} value={form.private_key_pkcs8} onChange={e => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: { ...form, private_key_pkcs8: e.target.value } }))} placeholder="Private key PKCS8" disabled={!edit} />
                </div>
                <div className="mt-3 flex gap-2">
                  {edit ? (
                    <>
                      <button
                        type="button"
                        className={primaryButtonCls}
                        onClick={() =>
                          withReload(async () => {
                            await updatePasskey(cred.id, {
                              credential_id: form.credential_id,
                              rp_id: form.rp_id,
                              private_key_pkcs8: form.private_key_pkcs8,
                              user_handle: form.user_handle,
                              sign_count: Number(form.sign_count || 0),
                              is_active: form.is_active,
                              last_used_at: form.last_used_at || null,
                            });
                            setEditingPasskeyById(prev => {
                              const next = { ...prev };
                              delete next[cred.id];
                              return next;
                            });
                          })
                        }
                      >
                        Save
                      </button>
                      <button type="button" className={buttonCls} onClick={() => setEditingPasskeyById(prev => { const next = { ...prev }; delete next[cred.id]; return next; })}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={buttonCls}
                      onClick={() => setEditingPasskeyById(prev => ({ ...prev, [cred.id]: form }))}
                    >
                      Edit
                    </button>
                  )}
                  <button type="button" className={dangerButtonCls} onClick={() => withReload(async () => { await deletePasskey(cred.id); })}>
                    Delete
                  </button>
                </div>
              </ResourceCard>
            );
          })}
          <ResourceCard title="New Passkey">
            <div className="grid gap-3 md:grid-cols-2">
              <input className={inputCls} value={draft.credential_id} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, credential_id: e.target.value } }))} placeholder="Credential ID" />
              <input className={inputCls} value={draft.rp_id} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, rp_id: e.target.value } }))} placeholder="RP ID" />
              <input className={inputCls} value={draft.user_handle} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, user_handle: e.target.value } }))} placeholder="User handle" />
              <input className={inputCls} value={draft.sign_count} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, sign_count: e.target.value } }))} placeholder="Sign count" />
              <input className={inputCls} value={draft.last_used_at} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, last_used_at: e.target.value } }))} placeholder="Last used at (ISO timestamp)" />
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={draft.is_active} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, is_active: e.target.checked } }))} />
                Active
              </label>
              <textarea className={`${textareaCls} md:col-span-2`} value={draft.private_key_pkcs8} onChange={e => setNewPasskeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, private_key_pkcs8: e.target.value } }))} placeholder="Private key PKCS8" />
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className={primaryButtonCls}
                onClick={() =>
                  withReload(async () => {
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
                      [account.id]: {
                        credential_id: '',
                        rp_id: '',
                        private_key_pkcs8: '',
                        user_handle: '',
                        sign_count: '0',
                        is_active: true,
                        last_used_at: '',
                      },
                    }));
                  })
                }
              >
                Create Passkey
              </button>
            </div>
          </ResourceCard>
        </div>
      </div>
    );
  };

  const renderSeedsSection = (account: TradingAccount) => {
    const draft = newSeedByAccount[account.id] ?? { seed_phrase: '', wallet_created_at: '' };
    return (
      <div className="grid gap-3">
        <h4 className="text-sm font-semibold text-text">Seeds</h4>
        <div className="grid gap-3">
          {account.seeds.map(seed => {
            const edit = editingSeedById[seed.id];
            const form = edit ?? { seed_phrase: seed.seed_phrase, wallet_created_at: seed.wallet_created_at ?? '' };
            return (
              <ResourceCard key={seed.id} title={`Seed #${seed.id}`} meta={`Created ${formatDate(seed.created_at)}`}>
                <div className="grid gap-3">
                  <textarea className={textareaCls} value={form.seed_phrase} onChange={e => setEditingSeedById(prev => ({ ...prev, [seed.id]: { ...form, seed_phrase: e.target.value } }))} disabled={!edit} />
                  <input className={inputCls} value={form.wallet_created_at} onChange={e => setEditingSeedById(prev => ({ ...prev, [seed.id]: { ...form, wallet_created_at: e.target.value } }))} placeholder="Wallet created at (ISO timestamp)" disabled={!edit} />
                </div>
                <div className="mt-3 flex gap-2">
                  {edit ? (
                    <>
                      <button
                        type="button"
                        className={primaryButtonCls}
                        onClick={() =>
                          withReload(async () => {
                            await updateSeed(seed.id, {
                              seed_phrase: form.seed_phrase,
                              wallet_created_at: form.wallet_created_at || null,
                            });
                            setEditingSeedById(prev => {
                              const next = { ...prev };
                              delete next[seed.id];
                              return next;
                            });
                          })
                        }
                      >
                        Save
                      </button>
                      <button type="button" className={buttonCls} onClick={() => setEditingSeedById(prev => { const next = { ...prev }; delete next[seed.id]; return next; })}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className={buttonCls} onClick={() => setEditingSeedById(prev => ({ ...prev, [seed.id]: form }))}>
                      Edit
                    </button>
                  )}
                  <button type="button" className={dangerButtonCls} onClick={() => withReload(async () => { await deleteSeed(seed.id); })}>
                    Delete
                  </button>
                </div>
              </ResourceCard>
            );
          })}
          <ResourceCard title="New Seed">
            <div className="grid gap-3">
              <textarea className={textareaCls} value={draft.seed_phrase} onChange={e => setNewSeedByAccount(prev => ({ ...prev, [account.id]: { ...draft, seed_phrase: e.target.value } }))} placeholder="Seed phrase" />
              <input className={inputCls} value={draft.wallet_created_at} onChange={e => setNewSeedByAccount(prev => ({ ...prev, [account.id]: { ...draft, wallet_created_at: e.target.value } }))} placeholder="Wallet created at (ISO timestamp)" />
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className={primaryButtonCls}
                onClick={() =>
                  withReload(async () => {
                    await createSeed(account.id, {
                      seed_phrase: draft.seed_phrase,
                      wallet_created_at: draft.wallet_created_at || null,
                    });
                    setNewSeedByAccount(prev => ({ ...prev, [account.id]: { seed_phrase: '', wallet_created_at: '' } }));
                  })
                }
              >
                Create Seed
              </button>
            </div>
          </ResourceCard>
        </div>
      </div>
    );
  };

  const renderAPIKeysSection = (account: TradingAccount) => {
    const draft = newAPIKeyByAccount[account.id] ?? { name: '', api_key: '', api_secret: '', passphrase: '', is_active: true };
    const isRobosats = isRobosatsProvider(account.provider);
    const sectionTitle = isRobosats ? 'Robot Token' : 'API Keys';
    const newTitle = isRobosats ? 'New Robot Token' : 'New API Key';
    const keyPlaceholder = isRobosats ? 'Robot token' : 'API key';
    const createLabel = isRobosats ? 'Create Robot Token' : 'Create API Key';
    return (
      <div className="grid gap-3">
        <h4 className="text-sm font-semibold text-text">{sectionTitle}</h4>
        <div className="grid gap-3">
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
              <ResourceCard key={key.id} title={key.name} meta={`Created ${formatDate(key.created_at)} • Updated ${formatDate(key.updated_at)}`}>
                <div className="grid gap-3 md:grid-cols-2">
                  <input className={inputCls} value={form.name} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, name: e.target.value } }))} placeholder="Name" disabled={!edit} />
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" checked={form.is_active} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, is_active: e.target.checked } }))} disabled={!edit} />
                    Active
                  </label>
                  <textarea className={`${textareaCls} md:col-span-2`} value={form.api_key} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, api_key: e.target.value } }))} placeholder={keyPlaceholder} disabled={!edit} />
                  {!isRobosats ? (
                    <>
                      <textarea className={`${textareaCls} md:col-span-2`} value={form.api_secret} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, api_secret: e.target.value } }))} placeholder="API secret" disabled={!edit} />
                      <input className={`${inputCls} md:col-span-2`} value={form.passphrase} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, passphrase: e.target.value } }))} placeholder="Passphrase" disabled={!edit} />
                    </>
                  ) : null}
                </div>
                <div className="mt-3 flex gap-2">
                  {edit ? (
                    <>
                      <button
                        type="button"
                        className={primaryButtonCls}
                        onClick={() =>
                          withReload(async () => {
                            await updateAPIKey(key.id, {
                              name: form.name,
                              api_key: form.api_key,
                              api_secret: isRobosats ? null : form.api_secret || null,
                              passphrase: isRobosats ? null : form.passphrase || null,
                              is_active: form.is_active,
                            });
                            setEditingAPIKeyById(prev => {
                              const next = { ...prev };
                              delete next[key.id];
                              return next;
                            });
                          })
                        }
                      >
                        Save
                      </button>
                      <button type="button" className={buttonCls} onClick={() => setEditingAPIKeyById(prev => { const next = { ...prev }; delete next[key.id]; return next; })}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className={buttonCls} onClick={() => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: form }))}>
                      Edit
                    </button>
                  )}
                  <button type="button" className={dangerButtonCls} onClick={() => withReload(async () => { await deleteAPIKey(key.id); })}>
                    Delete
                  </button>
                </div>
              </ResourceCard>
            );
          })}
          <ResourceCard title={newTitle}>
            <div className="grid gap-3 md:grid-cols-2">
              <input className={inputCls} value={draft.name} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, name: e.target.value } }))} placeholder="Name" />
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={draft.is_active} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, is_active: e.target.checked } }))} />
                Active
              </label>
              <textarea className={`${textareaCls} md:col-span-2`} value={draft.api_key} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, api_key: e.target.value } }))} placeholder={keyPlaceholder} />
              {!isRobosats ? (
                <>
                  <textarea className={`${textareaCls} md:col-span-2`} value={draft.api_secret} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, api_secret: e.target.value } }))} placeholder="API secret" />
                  <input className={`${inputCls} md:col-span-2`} value={draft.passphrase} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, passphrase: e.target.value } }))} placeholder="Passphrase" />
                </>
              ) : null}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className={primaryButtonCls}
                onClick={() =>
                  withReload(async () => {
                    await createAPIKey(account.id, {
                      name: draft.name,
                      api_key: draft.api_key,
                      api_secret: isRobosats ? null : draft.api_secret || null,
                      passphrase: isRobosats ? null : draft.passphrase || null,
                      is_active: draft.is_active,
                    });
                    setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { name: '', api_key: '', api_secret: '', passphrase: '', is_active: true } }));
                  })
                }
              >
                {createLabel}
              </button>
            </div>
          </ResourceCard>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className="h-full min-h-0 rounded-lg border border-border bg-surface p-3 flex flex-col gap-3 overflow-hidden">
        <div className={`flex items-center justify-between gap-3 ${showNewAccountForm ? 'mb-3' : ''}`}>
          <div>
            <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Accounts Management</h3>
            <p className="mt-1 text-sm text-muted">Manage accounts plus linked TOTP secrets, passkeys, seeds, and API keys.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={primaryButtonCls} onClick={() => setShowNewAccountForm(prev => !prev)}>
              {showNewAccountForm ? 'Cancel' : 'Add Account'}
            </button>
            <button type="button" className={buttonCls} onClick={() => void load()}>
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
        {healthMessage ? (
          <div className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-muted">{healthMessage}</div>
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
                return (
                  <div key={account.id} className="rounded-lg border border-border bg-bg">
                    <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5">
                      <div className="flex min-w-44 items-baseline gap-1.5">
                        <div className="text-sm font-semibold text-text">{providerLabel(account.provider)}</div>
                        <div className="text-[0.68rem] text-muted">
                          • created {formatAccountHeaderDate(account.created_at)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <HealthBadge account={account} compact />
                        <button
                          type="button"
                          className={compactButtonCls}
                          disabled={!!checkingHealthByAccount[account.id]}
                          onClick={() => void triggerHealthCheck(account)}
                        >
                          {checkingHealthByAccount[account.id] ? 'Checking…' : 'Check Health'}
                        </button>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted">
                          {account.totp_secrets.length} TOTP
                        </span>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted">
                          {account.passkey_credentials.length} Passkeys
                        </span>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted">
                          {account.seeds.length} Seeds
                        </span>
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[0.65rem] text-muted">
                          {account.api_keys.length} {isRobosatsProvider(account.provider) ? 'Robot Tokens' : 'API Keys'}
                        </span>
                        <button type="button" className={compactButtonCls} onClick={() => setExpandedId(expanded ? null : account.id)}>
                          {expanded ? 'Collapse' : 'Expand'}
                        </button>
                      </div>
                    </div>
                    {expanded ? (
                      <div className="border-t border-border px-4 py-4">
                        <div className="mb-4 rounded-lg border border-border bg-surface p-3">
                          <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-text">Account</h4>
                            <div className="flex gap-2">
                              {!isEditingAccount ? (
                                <button type="button" className={buttonCls} onClick={() => startAccountEdit(account)}>
                                  Edit Account
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={dangerButtonCls}
                                onClick={() => withReload(async () => { await deleteAccount(account.id); })}
                              >
                                Delete Account
                              </button>
                            </div>
                          </div>
                          {isEditingAccount ? (
                            <AccountEditor
                              value={editingAccount}
                              onChange={setEditingAccount}
                              submitLabel="Save Account"
                              onSubmit={() =>
                                withReload(async () => {
                                  await updateAccount(account.id, editingAccount);
                                  setEditingAccountId(null);
                                })
                              }
                            />
                          ) : (
                            <div className="grid gap-2 text-sm text-muted md:grid-cols-4">
                              <div><span className="text-text">Provider:</span> {providerLabel(account.provider)}</div>
                              <div><span className="text-text">Category:</span> {account.category}</div>
                              <div><span className="text-text">Health:</span> <span className={account.is_healthy ? 'text-green' : 'text-red'}>{account.is_healthy ? 'Healthy' : 'Unhealthy'}</span></div>
                              <div><span className="text-text">Last check:</span> {formatDate(account.last_health_check)}</div>
                              <div><span className="text-text">Email:</span> {account.email || '—'}</div>
                              <div><span className="text-text">Password:</span> {account.password ? '••••••••' : '—'}</div>
                              <div><span className="text-text">Phone:</span> {account.phone || '—'}</div>
                            </div>
                          )}
                        </div>

                        <div className="grid gap-4 xl:grid-cols-2">
                          {renderTOTPSection(account)}
                          {renderPasskeysSection(account)}
                          {renderSeedsSection(account)}
                          {renderAPIKeysSection(account)}
                        </div>
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
