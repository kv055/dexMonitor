import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PaymentMethodRow,
  PaymentMethodUpdatePayload,
  TradingAccount,
  TradingBankAccount,
  TradingWalletAddress,
} from '../types';
import {
  degradePaymentMethodToAlias,
  deletePaymentMethod,
  fetchPaymentMethods,
  fetchTradingAccounts,
  fetchTradingWalletAddresses,
  promotePaymentMethodAlias,
  updatePaymentMethod,
} from '../utils/api';

// The six catalog categories — must match the payment_methods.category CHECK
// constraint and commons/paymentmethods byte-for-byte.
const CATEGORIES = ['Cash', 'Bank Transfer', 'Fiat Transmitter', 'Gift Cards', 'Crypto', 'Others'] as const;

// Which categories link to which payment solution. Cash, Gift Cards and
// Others are structurally unlinkable (DB CHECK).
const LINKABLE: Record<string, 'bank' | 'account' | 'wallet' | null> = {
  'Bank Transfer': 'bank',
  'Fiat Transmitter': 'account',
  Crypto: 'wallet',
  Cash: null,
  'Gift Cards': null,
  Others: null,
};

const compactInputCls =
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent';
const compactButtonCls =
  'rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-text transition hover:bg-surface';
const compactPrimaryButtonCls =
  'rounded-md border border-accent bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/20';

interface Draft {
  category: string;
  merge_regex: string;
  alias_list: string[];
  link_id: number | null;
}

function draftFromRow(row: PaymentMethodRow): Draft {
  return {
    category: row.category,
    merge_regex: row.merge_regex ?? '',
    alias_list: row.alias_list ?? [],
    link_id: row.bank_account_id ?? row.account_id ?? row.wallet_address_id,
  };
}

function payloadFromDraft(draft: Draft, priority: number): PaymentMethodUpdatePayload {
  const link = LINKABLE[draft.category] ?? null;
  return {
    merge_regex: draft.merge_regex.trim() === '' ? null : draft.merge_regex.trim(),
    alias_list: draft.alias_list
      .map(alias => alias.trim())
      .filter(alias => alias.length > 0),
    category: draft.category,
    bank_account_id: link === 'bank' ? draft.link_id : null,
    account_id: link === 'account' ? draft.link_id : null,
    wallet_address_id: link === 'wallet' ? draft.link_id : null,
    priority,
  };
}

function draftHasChanges(draft: Draft, row: PaymentMethodRow) {
  const initial = draftFromRow(row);
  return draft.category !== initial.category
    || draft.merge_regex !== initial.merge_regex
    || draft.link_id !== initial.link_id
    || draft.alias_list.length !== initial.alias_list.length
    || draft.alias_list.some((alias, index) => alias !== initial.alias_list[index]);
}

function bankAccountLabel(ba: TradingBankAccount, owner: TradingAccount | undefined) {
  const iban = ba.details?.iban ?? '';
  const tail = iban.length > 4 ? ` …${iban.slice(-4)}` : '';
  const base = ba.label?.trim() || `${ba.owner_name}${tail}`;
  return owner ? `${base} (${owner.provider})` : base;
}

export function PaymentMethodsPanel() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PaymentMethodRow[]>([]);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [walletAddresses, setWalletAddresses] = useState<TradingWalletAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [categoryPickerId, setCategoryPickerId] = useState<number | null>(null);
  const [categoryPickerError, setCategoryPickerError] = useState<string | null>(null);
  const [aliasPickerId, setAliasPickerId] = useState<number | null>(null);
  const [aliasPickerError, setAliasPickerError] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pm, accts, wallets] = await Promise.allSettled([
        fetchPaymentMethods(),
        fetchTradingAccounts(),
        fetchTradingWalletAddresses(),
      ]);

      if (pm.status !== 'fulfilled') {
        throw pm.reason;
      }

      setRows(pm.value.payment_methods);
      setAccounts(accts.status === 'fulfilled' ? accts.value : []);
      setWalletAddresses(wallets.status === 'fulfilled' ? wallets.value.wallet_addresses : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const fiatAccounts = useMemo(
    () => accounts.filter(a => a.category === 'Fiat Transmitter'),
    [accounts],
  );
  const bankAccounts = useMemo(() => {
    const out: { ba: TradingBankAccount; owner: TradingAccount }[] = [];
    for (const a of accounts) {
      for (const ba of a.bank_accounts ?? []) {
        out.push({ ba, owner: a });
      }
    }
    return out;
  }, [accounts]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, PaymentMethodRow[]>();
    for (const row of rows) {
      const list = byCategory.get(row.category) ?? [];
      list.push(row);
      byCategory.set(row.category, list);
    }
    return CATEGORIES.map(cat => ({ category: cat, rows: byCategory.get(cat) ?? [] }));
  }, [rows]);

  const aliasProvidersByCategory = useMemo(
    () => CATEGORIES
      .filter(category => category !== 'Others')
      .map(category => ({
        category,
        providers: rows
          .filter(provider => provider.category === category)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter(group => group.providers.length > 0),
    [rows],
  );

  function startEdit(row: PaymentMethodRow) {
    setEditingId(row.id);
    setDraft(draftFromRow(row));
    setAliasInput('');
    setRowError(null);
  }

  async function saveDraft(id: number) {
    if (!draft) return;
    const row = rows.find(candidate => candidate.id === id);
    if (!row) return;
    setSaving(true);
    setRowError(null);
    try {
      const res = await updatePaymentMethod(id, payloadFromDraft(draft, row.priority));
      setRows(res.payment_methods);
      setEditingId(null);
      setDraft(null);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(id: number) {
    setSaving(true);
    setRowError(null);
    try {
      await deletePaymentMethod(id);
      setRows(prev => prev.filter(r => r.id !== id));
      setEditingId(null);
      setDraft(null);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  async function assignCategory(row: PaymentMethodRow, category: string) {
    if (category === row.category) {
      setCategoryPickerId(null);
      return;
    }

    setSaving(true);
    setCategoryPickerError(null);
    try {
      const draft = draftFromRow(row);
      const res = await updatePaymentMethod(row.id, payloadFromDraft({ ...draft, category, link_id: null }, row.priority));
      setRows(res.payment_methods);
      setCategoryPickerId(null);
      if (editingId === row.id) {
        setEditingId(null);
        setDraft(null);
      }
    } catch (err) {
      setCategoryPickerError(err instanceof Error ? err.message : 'Category update failed');
    } finally {
      setSaving(false);
    }
  }

  async function degradeToAlias(row: PaymentMethodRow, providerId: number) {
    const provider = rows.find(candidate => candidate.id === providerId);
    if (!provider) return;

    setSaving(true);
    setAliasPickerError(null);
    try {
      const res = await degradePaymentMethodToAlias(row.id, provider.id);
      setRows(res.payment_methods);
      setAliasPickerId(null);
    } catch (err) {
      setAliasPickerError(err instanceof Error ? err.message : 'Alias update failed');
    } finally {
      setSaving(false);
    }
  }

  async function promoteAlias(row: PaymentMethodRow, alias: string) {
    setSaving(true);
    setRowError(null);
    try {
      const res = await promotePaymentMethodAlias(row.id, alias);
      setRows(res.payment_methods);
      setEditingId(null);
      setDraft(null);
      setAliasInput('');
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not create a payment method from this alias');
    } finally {
      setSaving(false);
    }
  }

  function addAlias() {
    if (!draft) return;
    const alias = aliasInput.trim();
    if (alias === '') return;
    if (draft.alias_list.some(candidate => candidate.localeCompare(alias, undefined, { sensitivity: 'accent' }) === 0)) {
      setRowError('This alias is already in the list.');
      return;
    }
    setDraft({ ...draft, alias_list: [...draft.alias_list, alias] });
    setAliasInput('');
    setRowError(null);
  }

  function removeAlias(alias: string) {
    if (!draft) return;
    setDraft({ ...draft, alias_list: draft.alias_list.filter(candidate => candidate !== alias) });
  }

  function renderLinkSelect(d: Draft) {
    const link = LINKABLE[d.category] ?? null;
    if (link === null) {
      return <p className="text-[0.68rem] text-muted">{d.category} methods cannot be linked to a payment solution.</p>;
    }
    let options: { id: number; label: string }[] = [];
    if (link === 'bank') {
      options = bankAccounts.map(({ ba, owner }) => ({ id: ba.id, label: bankAccountLabel(ba, owner) }));
    } else if (link === 'account') {
      options = fiatAccounts.map(a => ({ id: a.id, label: a.provider }));
    } else {
      options = walletAddresses.map(w => ({ id: w.id, label: `${w.label} (${w.address.slice(0, 12)}…)` }));
    }
    const emptyHint =
      link === 'bank' ? 'no bank accounts — add one under Accounts Management'
      : link === 'account' ? 'no Fiat Transmitter accounts — add one under Accounts Management'
      : 'no wallet addresses — create one in the LND wallet section';
    return (
      <label className="flex flex-col gap-1 text-[0.68rem] text-muted">
        Linked payment solution
        <select
          className={compactInputCls}
          value={d.link_id ?? ''}
          onChange={e => setDraft({ ...d, link_id: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">— not linked —</option>
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        {options.length === 0 && <span className="text-amber-400">{emptyHint}</span>}
      </label>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Payment Methods</h3>
        <div className="flex items-center gap-1.5">
          {open && (
            <button type="button" className={compactButtonCls} onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading…' : 'Reload'}
            </button>
          )}
          <button type="button" className={compactPrimaryButtonCls} onClick={() => setOpen(prev => !prev)}>
            {open ? 'Hide' : 'Manage'}
          </button>
        </div>
      </div>

      {open && (
        <div className="max-h-[50vh] overflow-y-auto flex flex-col gap-2 pr-1">
          {error && <p className="text-xs text-red">{error}</p>}
          <p className="text-[0.68rem] text-muted">
            Categorize payment methods and link them to your saved payment solutions. Offer-method priority now lives
            in the Payments tab account list. New methods from offers land in Others as inactive.
          </p>
          {grouped.map(({ category, rows: catRows }) => (
            <div key={category} className="rounded-md border border-border bg-bg">
              <button
                type="button"
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-medium text-text"
                onClick={() =>
                  setCollapsed(prev => {
                    const next = new Set(prev);
                    if (next.has(category)) next.delete(category);
                    else next.add(category);
                    return next;
                  })
                }
              >
                <span>{category}</span>
                <span className="text-muted">{catRows.length} {collapsed.has(category) ? '▸' : '▾'}</span>
              </button>
              {!collapsed.has(category) && catRows.length > 0 && (
                <ul className="border-t border-border divide-y divide-border">
                  {catRows.map(row => (
                    <li key={row.id} className="px-2.5 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-text font-medium truncate">{row.name}</span>
                          {row.is_linked && row.link_label && (
                            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[0.62rem] text-accent truncate">
                              → {row.link_label}
                            </span>
                          )}
                          {row.is_active ? (
                            <span className="rounded bg-green/10 px-1.5 py-0.5 text-[0.62rem] text-green">active</span>
                          ) : (
                            <span className="rounded bg-border/50 px-1.5 py-0.5 text-[0.62rem] text-muted">inactive</span>
                          )}
                          {(row.alias_list?.length ?? 0) > 0 && (
                            <span className="text-[0.62rem] text-muted">
                              {row.alias_list.length} {row.alias_list.length === 1 ? 'alias' : 'aliases'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            className={compactButtonCls}
                            onClick={() => {
                              setCategoryPickerError(null);
                              setCategoryPickerId(prev => (prev === row.id ? null : row.id));
                            }}
                          >
                            Change category
                          </button>
                          {!row.is_linked && (
                            <button
                              type="button"
                              className={compactButtonCls}
                              onClick={() => {
                                setAliasPickerError(null);
                                setAliasPickerId(prev => (prev === row.id ? null : row.id));
                              }}
                            >
                              Degrade to alias
                            </button>
                          )}
                          <button
                            type="button"
                            className={compactButtonCls}
                            onClick={() => (editingId === row.id ? setEditingId(null) : startEdit(row))}
                          >
                            {editingId === row.id ? 'Close' : 'Edit'}
                          </button>
                        </div>
                      </div>

                      {categoryPickerId === row.id && (
                        <div className="mt-2 flex items-end gap-1.5">
                          <label className="flex flex-1 flex-col gap-1 text-[0.68rem] text-muted">
                            Assign category
                            <select
                              className={compactInputCls}
                              value={row.category}
                              onChange={e => void assignCategory(row, e.target.value)}
                              disabled={saving}
                            >
                              {CATEGORIES.map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </label>
                          {categoryPickerError && <p className="text-[0.68rem] text-red">{categoryPickerError}</p>}
                        </div>
                      )}

                      {aliasPickerId === row.id && !row.is_linked && (
                        <div className="mt-2 flex items-end gap-1.5">
                          <label className="flex flex-1 flex-col gap-1 text-[0.68rem] text-muted">
                            Add to provider
                            <select
                              className={compactInputCls}
                              defaultValue=""
                              onChange={e => {
                                if (e.target.value !== '') void degradeToAlias(row, Number(e.target.value));
                              }}
                              disabled={saving}
                            >
                              <option value="">— select provider —</option>
                              {aliasProvidersByCategory.map(group => {
                                const providers = group.providers.filter(provider => provider.id !== row.id);
                                return providers.length > 0 ? (
                                  <optgroup key={group.category} label={group.category}>
                                    {providers.map(provider => (
                                      <option key={provider.id} value={provider.id}>{provider.name}</option>
                                    ))}
                                  </optgroup>
                                ) : null;
                              })}
                            </select>
                          </label>
                          {aliasPickerError && <p className="text-[0.68rem] text-red">{aliasPickerError}</p>}
                        </div>
                      )}

                      {editingId === row.id && draft && (
                        <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-surface p-2">
                          <label className="flex flex-col gap-1 text-[0.68rem] text-muted">
                            Category
                            <select
                              className={compactInputCls}
                              value={draft.category}
                              onChange={e => setDraft({ ...draft, category: e.target.value, link_id: null })}
                            >
                              {CATEGORIES.map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex flex-col gap-1 text-[0.68rem] text-muted">
                            Merge regex (raw offer labels matching this become “{row.name}”)
                            <input
                              className={`${compactInputCls} font-mono`}
                              value={draft.merge_regex}
                              onChange={e => setDraft({ ...draft, merge_regex: e.target.value })}
                              placeholder="(?i)^(?:paypal|pay pal)$"
                            />
                          </label>
                          <div className="flex flex-col gap-1 text-[0.68rem] text-muted">
                            <span>Aliases</span>
                            <p className="text-[0.62rem] text-muted">
                              Exact offer labels that should be treated as “{row.name}”. Save changes before making an alias a payment method.
                            </p>
                            <div className="flex gap-1.5">
                              <input
                                className={compactInputCls}
                                value={aliasInput}
                                onChange={e => setAliasInput(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addAlias();
                                  }
                                }}
                                placeholder="Add an alias"
                              />
                              <button
                                type="button"
                                className={compactPrimaryButtonCls}
                                onClick={addAlias}
                                disabled={aliasInput.trim() === ''}
                              >
                                Add
                              </button>
                            </div>
                            {draft.alias_list.length > 0 ? (
                              <ul className="overflow-hidden rounded-md border border-border divide-y divide-border">
                                {draft.alias_list.map(alias => (
                                  <li key={alias} className="flex items-center justify-between gap-2 bg-bg px-2 py-1.5">
                                    <span className="min-w-0 truncate text-xs text-text" title={alias}>{alias}</span>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <button
                                        type="button"
                                        className={compactButtonCls}
                                        onClick={() => void promoteAlias(row, alias)}
                                        disabled={saving || draftHasChanges(draft, row)}
                                        title={draftHasChanges(draft, row)
                                          ? 'Save your changes before creating a payment method from an alias'
                                          : 'Create a separate payment method from this alias'}
                                      >
                                        Promote to payment method
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-md border border-red/40 px-2 py-1 text-xs font-medium text-red transition hover:bg-red/10"
                                        onClick={() => removeAlias(alias)}
                                        disabled={saving}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="rounded-md border border-dashed border-border px-2 py-2 text-[0.68rem] text-muted">
                                No aliases assigned.
                              </p>
                            )}
                          </div>
                          {renderLinkSelect(draft)}
                          {rowError && <p className="text-[0.68rem] text-red">{rowError}</p>}
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className={compactPrimaryButtonCls}
                              onClick={() => void saveDraft(row.id)}
                              disabled={saving}
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            {row.category === 'Others' && !row.is_active && (
                              <button
                                type="button"
                                className={compactButtonCls}
                                onClick={() => void removeRow(row.id)}
                                disabled={saving}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
