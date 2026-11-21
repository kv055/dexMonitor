import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PaymentMethodRow,
  PaymentMethodUpdatePayload,
} from '../types';
import {
  degradePaymentMethodToAlias,
  deletePaymentMethod,
  fetchPaymentMethods,
  promotePaymentMethodAlias,
  updatePaymentMethod,
} from '../utils/api';

// The six catalog categories — must match the payment_methods.category CHECK
// constraint and commons/paymentmethods byte-for-byte.
const CATEGORIES = ['Cash', 'Bank', 'Fiat Transmitter', 'Gift Cards', 'Crypto', 'Others'] as const;

// DEX offer slugs for payment_methods.sources — must match offers.exchange /
// payment_methods_sources_allowed_check.
const DEX_SOURCES = ['bisq', 'bisq2', 'hodlhodl', 'robosats', 'peachbitcoin', 'mostro'] as const;

// Enabled fiat codes for payment_methods.currencies — mirrors commons/fiat.Enabled.
const FIAT_CURRENCIES = ['EUR', 'USD', 'GBP', 'AUD', 'CHF', 'SEK', 'NOK', 'CAD'] as const;

const SOURCE_LABELS: Record<(typeof DEX_SOURCES)[number], string> = {
  bisq: 'Bisq',
  bisq2: 'Bisq 2',
  hodlhodl: 'HodlHodl',
  robosats: 'RoboSats',
  peachbitcoin: 'Peach',
  mostro: 'Mostro',
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
}

function draftFromRow(row: PaymentMethodRow): Draft {
  return {
    category: row.category,
    merge_regex: row.merge_regex ?? '',
    alias_list: row.alias_list ?? [],
  };
}

// Linking is edited on the Accounts Management payment tab. Categorization
// edits preserve existing FKs, and clear them only when the category changes
// (a Bank FK is invalid on a Fiat Transmitter row, etc.). Observed sources and
// currencies are owned by the snapshot service — always pass through the row.
function payloadFromDraft(draft: Draft, row: PaymentMethodRow): PaymentMethodUpdatePayload {
  const categoryChanged = draft.category !== row.category;
  return {
    merge_regex: draft.merge_regex.trim() === '' ? null : draft.merge_regex.trim(),
    alias_list: draft.alias_list
      .map(alias => alias.trim())
      .filter(alias => alias.length > 0),
    sources: row.sources ?? [],
    currencies: row.currencies ?? [],
    category: draft.category,
    account_id: categoryChanged ? null : row.account_id,
    priority: row.priority,
  };
}

function draftHasChanges(draft: Draft, row: PaymentMethodRow) {
  const initial = draftFromRow(row);
  return draft.category !== initial.category
    || draft.merge_regex !== initial.merge_regex
    || draft.alias_list.length !== initial.alias_list.length
    || draft.alias_list.some((alias, index) => alias !== initial.alias_list[index]);
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] ?? source;
}

export function PaymentMethodsPanel() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PaymentMethodRow[]>([]);
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
  // Empty string = no filter; "__unset__" = methods with an empty array for that column.
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pm = await fetchPaymentMethods();
      setRows(pm.payment_methods);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
    return rows.filter(row => {
      if (normalizedSearch !== '') {
        const searchableText = [row.name, ...(row.alias_list ?? [])].join(' ').toLocaleLowerCase();
        if (!searchableText.includes(normalizedSearch)) return false;
      }
      if (categoryFilter !== '' && row.category !== categoryFilter) return false;
      if (sourceFilter === '__unset__') {
        if ((row.sources?.length ?? 0) > 0) return false;
      } else if (sourceFilter !== '' && !(row.sources ?? []).includes(sourceFilter)) {
        return false;
      }
      if (currencyFilter === '__unset__') {
        if ((row.currencies?.length ?? 0) > 0) return false;
      } else if (currencyFilter !== '' && !(row.currencies ?? []).includes(currencyFilter)) {
        return false;
      }
      return true;
    });
  }, [rows, searchQuery, categoryFilter, sourceFilter, currencyFilter]);

  const filtersActive = searchQuery.trim() !== ''
    || categoryFilter !== ''
    || sourceFilter !== ''
    || currencyFilter !== '';

  const grouped = useMemo(() => {
    const byCategory = new Map<string, PaymentMethodRow[]>();
    for (const row of filteredRows) {
      const list = byCategory.get(row.category) ?? [];
      list.push(row);
      byCategory.set(row.category, list);
    }
    return CATEGORIES.map(cat => ({ category: cat, rows: byCategory.get(cat) ?? [] }));
  }, [filteredRows]);

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
      const res = await updatePaymentMethod(id, payloadFromDraft(draft, row));
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
      const res = await updatePaymentMethod(row.id, payloadFromDraft({ ...draft, category }, row));
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
            Categorize payment methods and aliases. Observed DEX sources and currencies are filled
            by the snapshot service. Link catalog methods to payment solutions under Accounts
            Management → payment accounts. Offer-method priority lives in the Payments tab account
            list. New methods from offers land in Others as unlinked.
          </p>
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-bg px-2.5 py-2">
            <label className="flex min-w-[12rem] flex-[1.5] flex-col gap-1 text-[0.68rem] text-muted">
              Search
              <input
                type="search"
                className={compactInputCls}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search methods or aliases"
                aria-label="Search payment methods"
              />
            </label>
            <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-[0.68rem] text-muted">
              Category
              <select
                className={compactInputCls}
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {CATEGORIES.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-[0.68rem] text-muted">
              Source
              <select
                className={compactInputCls}
                value={sourceFilter}
                onChange={e => setSourceFilter(e.target.value)}
                aria-label="Filter by source"
              >
                <option value="">All sources</option>
                <option value="__unset__">Unset</option>
                {DEX_SOURCES.map(source => (
                  <option key={source} value={source}>{SOURCE_LABELS[source]}</option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-[0.68rem] text-muted">
              Currency
              <select
                className={compactInputCls}
                value={currencyFilter}
                onChange={e => setCurrencyFilter(e.target.value)}
                aria-label="Filter by currency"
              >
                <option value="">All currencies</option>
                <option value="__unset__">Unset</option>
                {FIAT_CURRENCIES.map(currency => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
            {filtersActive && (
              <button
                type="button"
                className={compactButtonCls}
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('');
                  setSourceFilter('');
                  setCurrencyFilter('');
                }}
              >
                Clear filters
              </button>
            )}
            <span className="ml-auto text-[0.62rem] text-muted">
              {filteredRows.length}/{rows.length} methods
            </span>
          </div>
          {filtersActive && filteredRows.length === 0 && (
            <p className="text-[0.68rem] text-muted">No payment methods match the selected filters.</p>
          )}
          {grouped.map(({ category, rows: catRows }) => (
            filtersActive && catRows.length === 0 ? null : (
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
                    <li key={row.id} className={`px-2.5 py-1.5 text-xs ${row.is_linked ? 'bg-green/10' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-text font-medium truncate">{row.name}</span>
                          {row.is_linked && row.link_label && (
                            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[0.62rem] text-accent truncate">
                              → {row.link_label}
                            </span>
                          )}
                          {row.is_linked ? (
                            <span className="rounded bg-green/10 px-1.5 py-0.5 text-[0.62rem] text-green">linked</span>
                          ) : (
                            <span className="rounded bg-border/50 px-1.5 py-0.5 text-[0.62rem] text-muted">unlinked</span>
                          )}
                          {(row.alias_list?.length ?? 0) > 0 && (
                            <span className="text-[0.62rem] text-muted">
                              {row.alias_list.length} {row.alias_list.length === 1 ? 'alias' : 'aliases'}
                            </span>
                          )}
                          {(row.sources?.length ?? 0) > 0 && (
                            <span className="text-[0.62rem] text-muted" title={row.sources.join(', ')}>
                              {row.sources.length} {row.sources.length === 1 ? 'source' : 'sources'}
                            </span>
                          )}
                          {(row.currencies?.length ?? 0) > 0 && (
                            <span className="text-[0.62rem] text-muted" title={row.currencies.join(', ')}>
                              {row.currencies.join(', ')}
                            </span>
                          )}
                          {row.popularity > 0 && (
                            <span className="text-[0.62rem] text-muted" title="New-offer sightings">
                              pop {row.popularity}
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
                          <button
                            type="button"
                            className={`${compactButtonCls} inline-flex items-center gap-1`}
                            onClick={() => (editingId === row.id ? setEditingId(null) : startEdit(row))}
                            aria-expanded={editingId === row.id}
                          >
                            <span className={`text-[0.55rem] transition-transform ${editingId === row.id ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
                            {editingId === row.id ? 'Collapse' : 'Expand'}
                          </button>
                        </div>
                      </div>

                      {categoryPickerId === row.id && (
                        <div className="mt-2 flex max-w-sm items-end gap-1.5">
                          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[0.68rem] text-muted">
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

                      {aliasPickerId === row.id && (
                        <div className="mt-2 flex max-w-md items-end gap-1.5">
                          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[0.68rem] text-muted">
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
                        <div className="mt-2 grid grid-cols-1 gap-2.5 rounded-md border border-border bg-surface p-2.5 md:grid-cols-6">
                          <label className="flex min-w-0 flex-col gap-1 text-[0.68rem] text-muted md:col-span-2">
                            Category
                            <select
                              className={compactInputCls}
                              value={draft.category}
                              onChange={e => setDraft({ ...draft, category: e.target.value })}
                            >
                              {CATEGORIES.map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </label>
                          <label className="flex min-w-0 flex-col gap-1 text-[0.68rem] text-muted md:col-span-4">
                            Merge regex (raw offer labels matching this become “{row.name}”)
                            <input
                              className={`${compactInputCls} font-mono`}
                              value={draft.merge_regex}
                              onChange={e => setDraft({ ...draft, merge_regex: e.target.value })}
                              placeholder="(?i)^(?:paypal|pay pal)$"
                            />
                          </label>
                          <div className="flex min-w-0 flex-col gap-1 text-[0.68rem] text-muted md:col-span-2">
                            <span>Sources (DEXes)</span>
                            <p className="text-[0.62rem] text-muted">
                              Observed DEX venues. Snapshot-owned — not editable here.
                            </p>
                            <div className="flex min-h-10 flex-wrap content-start gap-1.5 rounded-md border border-border bg-bg px-2 py-1.5">
                              {(row.sources?.length ?? 0) > 0 ? (
                                row.sources.map(source => (
                                  <span
                                    key={source}
                                    className="rounded border border-border bg-surface px-1.5 py-0.5 text-[0.68rem] text-text"
                                  >
                                    {sourceLabel(source)}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[0.68rem] text-muted">None observed yet</span>
                              )}
                            </div>
                          </div>
                          <div className="flex min-w-0 flex-col gap-1 text-[0.68rem] text-muted md:col-span-2">
                            <span>Currencies</span>
                            <p className="text-[0.62rem] text-muted">
                              Observed fiat. Snapshot-owned — not editable here.
                            </p>
                            <div className="flex min-h-10 flex-wrap content-start gap-1.5 rounded-md border border-border bg-bg px-2 py-1.5">
                              {(row.currencies?.length ?? 0) > 0 ? (
                                row.currencies.map(currency => (
                                  <span
                                    key={currency}
                                    className="rounded border border-border bg-surface px-1.5 py-0.5 text-[0.68rem] text-text"
                                  >
                                    {currency}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[0.68rem] text-muted">None observed yet</span>
                              )}
                            </div>
                          </div>
                          <div className="flex min-w-0 flex-col gap-1 text-[0.68rem] text-muted md:col-span-2">
                            <span>Aliases</span>
                            <p className="text-[0.62rem] text-muted">
                              Exact offer labels treated as “{row.name}”. Save before promoting an alias.
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
                                className={`${compactPrimaryButtonCls} shrink-0`}
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
                                        Promote
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
                          <div className="flex flex-col gap-1.5 md:col-span-6 md:flex-row md:items-center md:justify-between">
                            <div className="min-w-0">
                              {rowError && <p className="text-[0.68rem] text-red">{rowError}</p>}
                              {!row.is_linked && (
                                <p className="text-[0.62rem] text-muted">
                                  Not linked — assign a payment solution under Accounts Management → payment accounts.
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
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
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )))}
        </div>
      )}
    </div>
  );
}
