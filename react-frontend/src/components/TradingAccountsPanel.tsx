import { useEffect, useMemo, useState } from 'react';
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
  { value: 'kraken', label: 'Kraken' },
  { value: 'coinbase', label: 'Coinbase' },
  { value: 'binance', label: 'Binance' },
  { value: 'hodlhodl', label: 'HodlHodl' },
  { value: 'bisq', label: 'Bisq' },
  { value: 'robosats', label: 'RoboSats' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'revolut', label: 'Revolut' },
  { value: 'wise', label: 'Wise' },
];

const inputCls =
  'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent';
const textareaCls =
  'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent min-h-24';
const buttonCls =
  'rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-text transition hover:bg-surface';
const primaryButtonCls =
  'rounded-md border border-accent bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20';
const dangerButtonCls =
  'rounded-md border border-red/40 bg-red/10 px-3 py-2 text-sm font-medium text-red transition hover:bg-red/20';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function providerLabel(value: string) {
  const match = PROVIDER_OPTIONS.find(option => option.value === value);
  return match?.label ?? value;
}

function providerOptionsForValue(value: string): ProviderOption[] {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || PROVIDER_OPTIONS.some(option => option.value === trimmed)) {
    return PROVIDER_OPTIONS;
  }
  return [...PROVIDER_OPTIONS, { value: trimmed, label: value }];
}

interface AccountFormState {
  provider: string;
  email: string;
  password: string;
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
  return { provider: '', email: '', password: '' };
}

function AccountEditor({
  value,
  onChange,
  onSubmit,
  submitLabel,
}: {
  value: AccountFormState;
  onChange: (next: AccountFormState) => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  const options = useMemo(() => providerOptionsForValue(value.provider), [value.provider]);

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <label className="grid gap-1 text-sm text-muted">
        <span>Provider</span>
        <select
          className={inputCls}
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
      <label className="grid gap-1 text-sm text-muted">
        <span>Email</span>
        <input
          className={inputCls}
          value={value.email}
          onChange={e => onChange({ ...value, email: e.target.value })}
          placeholder="Optional"
        />
      </label>
      <label className="grid gap-1 text-sm text-muted">
        <span>Password</span>
        <input
          className={inputCls}
          type="password"
          value={value.password}
          onChange={e => onChange({ ...value, password: e.target.value })}
          placeholder="Optional"
        />
      </label>
      <div className="md:col-span-3 flex justify-end">
        <button type="button" className={primaryButtonCls} onClick={onSubmit}>
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [newAccount, setNewAccount] = useState<AccountFormState>(emptyAccountForm());
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editingAccount, setEditingAccount] = useState<AccountFormState>(emptyAccountForm());

  const [newTOTPByAccount, setNewTOTPByAccount] = useState<Record<number, TOTPFormState>>({});
  const [editingTOTPById, setEditingTOTPById] = useState<Record<number, TOTPFormState>>({});
  const [newPasskeyByAccount, setNewPasskeyByAccount] = useState<Record<number, PasskeyFormState>>({});
  const [editingPasskeyById, setEditingPasskeyById] = useState<Record<number, PasskeyFormState>>({});
  const [newSeedByAccount, setNewSeedByAccount] = useState<Record<number, SeedFormState>>({});
  const [editingSeedById, setEditingSeedById] = useState<Record<number, SeedFormState>>({});
  const [newAPIKeyByAccount, setNewAPIKeyByAccount] = useState<Record<number, APIKeyFormState>>({});
  const [editingAPIKeyById, setEditingAPIKeyById] = useState<Record<number, APIKeyFormState>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchTradingAccounts();
      setAccounts(next);
      if (expandedId != null && !next.some(account => account.id === expandedId)) {
        setExpandedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trading accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const withReload = async (fn: () => Promise<void>) => {
    try {
      setError(null);
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trading accounts request failed');
    }
  };

  const startAccountEdit = (account: TradingAccount) => {
    setEditingAccountId(account.id);
    setEditingAccount({
      provider: account.provider,
      email: account.email ?? '',
      password: account.password ?? '',
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
    return (
      <div className="grid gap-3">
        <h4 className="text-sm font-semibold text-text">API Keys</h4>
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
                  <textarea className={`${textareaCls} md:col-span-2`} value={form.api_key} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, api_key: e.target.value } }))} placeholder="API key" disabled={!edit} />
                  <textarea className={`${textareaCls} md:col-span-2`} value={form.api_secret} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, api_secret: e.target.value } }))} placeholder="API secret" disabled={!edit} />
                  <input className={`${inputCls} md:col-span-2`} value={form.passphrase} onChange={e => setEditingAPIKeyById(prev => ({ ...prev, [key.id]: { ...form, passphrase: e.target.value } }))} placeholder="Passphrase" disabled={!edit} />
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
                              api_secret: form.api_secret || null,
                              passphrase: form.passphrase || null,
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
          <ResourceCard title="New API Key">
            <div className="grid gap-3 md:grid-cols-2">
              <input className={inputCls} value={draft.name} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, name: e.target.value } }))} placeholder="Name" />
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={draft.is_active} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, is_active: e.target.checked } }))} />
                Active
              </label>
              <textarea className={`${textareaCls} md:col-span-2`} value={draft.api_key} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, api_key: e.target.value } }))} placeholder="API key" />
              <textarea className={`${textareaCls} md:col-span-2`} value={draft.api_secret} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, api_secret: e.target.value } }))} placeholder="API secret" />
              <input className={`${inputCls} md:col-span-2`} value={draft.passphrase} onChange={e => setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { ...draft, passphrase: e.target.value } }))} placeholder="Passphrase" />
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
                      api_secret: draft.api_secret || null,
                      passphrase: draft.passphrase || null,
                      is_active: draft.is_active,
                    });
                    setNewAPIKeyByAccount(prev => ({ ...prev, [account.id]: { name: '', api_key: '', api_secret: '', passphrase: '', is_active: true } }));
                  })
                }
              >
                Create API Key
              </button>
            </div>
          </ResourceCard>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Accounts Management</h3>
            <p className="mt-1 text-sm text-muted">Manage accounts plus linked TOTP secrets, passkeys, seeds, and API keys.</p>
          </div>
          <button type="button" className={buttonCls} onClick={() => void load()}>
            Refresh
          </button>
        </div>

        <AccountEditor
          value={newAccount}
          onChange={setNewAccount}
          submitLabel="Add New Account"
          onSubmit={() =>
            withReload(async () => {
              await createAccount(newAccount);
              setNewAccount(emptyAccountForm());
            })
          }
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</div>
      ) : null}

      <div className="grid gap-3">
        {loading ? (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">Loading trading accounts…</div>
        ) : null}
        {!loading && accounts.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">No accounts yet.</div>
        ) : null}
        {accounts.map(account => {
          const expanded = expandedId === account.id;
          const isEditingAccount = editingAccountId === account.id;
          return (
            <div key={account.id} className="rounded-lg border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="text-base font-semibold text-text">{providerLabel(account.provider)}</div>
                  <div className="text-xs text-muted">
                    account #{account.id} • created {formatDate(account.created_at)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-border px-2 py-1 text-xs text-muted">
                    {account.totp_secrets.length} TOTP
                  </span>
                  <span className="rounded-full border border-border px-2 py-1 text-xs text-muted">
                    {account.passkey_credentials.length} Passkeys
                  </span>
                  <span className="rounded-full border border-border px-2 py-1 text-xs text-muted">
                    {account.seeds.length} Seeds
                  </span>
                  <span className="rounded-full border border-border px-2 py-1 text-xs text-muted">
                    {account.api_keys.length} API Keys
                  </span>
                  <button type="button" className={buttonCls} onClick={() => setExpandedId(expanded ? null : account.id)}>
                    {expanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>
              </div>
              {expanded ? (
                <div className="border-t border-border px-4 py-4">
                  <div className="mb-4 rounded-lg border border-border bg-bg p-3">
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
                      <div className="grid gap-2 text-sm text-muted md:grid-cols-3">
                        <div><span className="text-text">Provider:</span> {providerLabel(account.provider)}</div>
                        <div><span className="text-text">Email:</span> {account.email || '—'}</div>
                        <div><span className="text-text">Password:</span> {account.password ? '••••••••' : '—'}</div>
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
    </div>
  );
}
