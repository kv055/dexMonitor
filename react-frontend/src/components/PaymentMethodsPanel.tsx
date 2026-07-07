import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PaymentMethodChatTemplate,
  PaymentMethodRow,
  PaymentMethodUpdatePayload,
  TradingAccount,
  TradingBankAccount,
  TradingWalletAddress,
} from '../types';
import {
  deletePaymentMethod,
  deletePaymentMethodChatTemplate,
  fetchPaymentMethodChatTemplates,
  fetchPaymentMethods,
  fetchTradingAccounts,
  fetchTradingWalletAddresses,
  updatePaymentMethod,
  updatePaymentMethodChatTemplate,
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

// Chat-style DEX venues that exchange payment details via the trade chat.
// Must stay in sync with payment_method_chat_templates.exchange_allowed_check.
const CHAT_EXCHANGES = ['RoboSats', 'Bisq2'] as const;

const compactInputCls =
  'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text outline-none focus:border-accent';
const compactButtonCls =
  'rounded-md border border-border bg-bg px-2 py-1 text-xs font-medium text-text transition hover:bg-surface';
const compactPrimaryButtonCls =
  'rounded-md border border-accent bg-accent/10 px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/20';

interface Draft {
  category: string;
  merge_regex: string;
  link_id: number | null;
  is_active: boolean;
  priority: string;
}

function draftFromRow(row: PaymentMethodRow): Draft {
  return {
    category: row.category,
    merge_regex: row.merge_regex ?? '',
    link_id: row.bank_account_id ?? row.account_id ?? row.wallet_address_id,
    is_active: row.is_active,
    priority: String(row.priority),
  };
}

function payloadFromDraft(draft: Draft): PaymentMethodUpdatePayload {
  const link = LINKABLE[draft.category] ?? null;
  return {
    merge_regex: draft.merge_regex.trim() === '' ? null : draft.merge_regex.trim(),
    category: draft.category,
    bank_account_id: link === 'bank' ? draft.link_id : null,
    account_id: link === 'account' ? draft.link_id : null,
    wallet_address_id: link === 'wallet' ? draft.link_id : null,
    is_active: draft.is_active,
    priority: Number.parseInt(draft.priority, 10) || 0,
  };
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
  const [chatTemplateDrafts, setChatTemplateDrafts] = useState<Record<string, string>>({});
  const [chatTemplateActive, setChatTemplateActive] = useState<Record<string, boolean>>({});
  const [chatTemplateLoading, setChatTemplateLoading] = useState(false);
  const [chatTemplateError, setChatTemplateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pm, accts, wallets] = await Promise.all([
        fetchPaymentMethods(),
        fetchTradingAccounts(),
        fetchTradingWalletAddresses(),
      ]);
      setRows(pm.payment_methods);
      setAccounts(accts);
      setWalletAddresses(wallets.wallet_addresses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChatTemplates = useCallback(async (id: number) => {
    setChatTemplateLoading(true);
    setChatTemplateError(null);
    try {
      const res = await fetchPaymentMethodChatTemplates(id);
      const drafts: Record<string, string> = {};
      const active: Record<string, boolean> = {};
      for (const ex of CHAT_EXCHANGES) {
        const t = res.chat_templates.find((t: PaymentMethodChatTemplate) => t.exchange === ex);
        drafts[ex] = t?.template ?? '';
        active[ex] = t?.is_active ?? true;
      }
      setChatTemplateDrafts(drafts);
      setChatTemplateActive(active);
    } catch (err) {
      setChatTemplateError(err instanceof Error ? err.message : 'Failed to load chat templates');
    } finally {
      setChatTemplateLoading(false);
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

  function startEdit(row: PaymentMethodRow) {
    setEditingId(row.id);
    setDraft(draftFromRow(row));
    setRowError(null);
    setChatTemplateError(null);
    void loadChatTemplates(row.id);
  }

  async function saveDraft(id: number) {
    if (!draft) return;
    setSaving(true);
    setRowError(null);
    try {
      const res = await updatePaymentMethod(id, payloadFromDraft(draft));
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

  async function saveChatTemplate(id: number, exchange: string) {
    setChatTemplateLoading(true);
    setChatTemplateError(null);
    try {
      const template = chatTemplateDrafts[exchange]?.trim() ?? '';
      if (template === '') {
        // Empty template means the user wants to fall back to the default.
        await deletePaymentMethodChatTemplate(id, exchange);
      } else {
        await updatePaymentMethodChatTemplate(id, exchange, {
          template,
          is_active: chatTemplateActive[exchange] ?? true,
        });
      }
      await loadChatTemplates(id);
    } catch (err) {
      setChatTemplateError(err instanceof Error ? err.message : 'Failed to save chat template');
    } finally {
      setChatTemplateLoading(false);
    }
  }

  async function resetChatTemplate(id: number, exchange: string) {
    setChatTemplateLoading(true);
    setChatTemplateError(null);
    try {
      await deletePaymentMethodChatTemplate(id, exchange);
      setChatTemplateDrafts(prev => ({ ...prev, [exchange]: '' }));
      setChatTemplateActive(prev => ({ ...prev, [exchange]: true }));
      await loadChatTemplates(id);
    } catch (err) {
      setChatTemplateError(err instanceof Error ? err.message : 'Failed to reset chat template');
    } finally {
      setChatTemplateLoading(false);
    }
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

  function renderChatTemplates(id: number) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-2">
        <p className="text-[0.68rem] font-medium text-muted">Chat request templates</p>
        <p className="text-[0.62rem] text-muted">
          Customize the message sent to the counterparty on chat-venue DEXes. Use{' '}
          <code className="text-accent">{'{{amount}}'}</code> and{' '}
          <code className="text-accent">{'{{currency}}'}</code> as placeholders. Leave empty to use the default template.
        </p>
        {chatTemplateError && <p className="text-[0.68rem] text-red">{chatTemplateError}</p>}
        {CHAT_EXCHANGES.map(exchange => (
          <div key={exchange} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[0.68rem] text-muted">{exchange}</span>
              <label className="flex items-center gap-1 text-[0.62rem] text-muted">
                <input
                  type="checkbox"
                  checked={chatTemplateActive[exchange] ?? true}
                  onChange={e => setChatTemplateActive(prev => ({ ...prev, [exchange]: e.target.checked }))}
                  disabled={chatTemplateLoading}
                />
                Active
              </label>
            </div>
            <textarea
              className={`${compactInputCls} font-mono min-h-[5rem]`}
              value={chatTemplateDrafts[exchange] ?? ''}
              onChange={e => setChatTemplateDrafts(prev => ({ ...prev, [exchange]: e.target.value }))}
              placeholder={`Default template for ${exchange}`}
              disabled={chatTemplateLoading}
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={compactPrimaryButtonCls}
                onClick={() => void saveChatTemplate(id, exchange)}
                disabled={chatTemplateLoading}
              >
                {chatTemplateLoading ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className={compactButtonCls}
                onClick={() => void resetChatTemplate(id, exchange)}
                disabled={chatTemplateLoading}
              >
                Reset
              </button>
            </div>
          </div>
        ))}
      </div>
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
            Categorize payment methods and link them to your saved payment solutions. Offers are taken with the
            highest-priority linked method they accept. New methods from offers land in Others as inactive.
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
                          {row.priority !== 0 && (
                            <span className="text-[0.62rem] text-muted">prio {row.priority}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={compactButtonCls}
                          onClick={() => (editingId === row.id ? setEditingId(null) : startEdit(row))}
                        >
                          {editingId === row.id ? 'Close' : 'Edit'}
                        </button>
                      </div>

                      {editingId === row.id && draft && (
                        <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-surface p-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                              Priority (higher wins on multi-method offers)
                              <input
                                type="number"
                                className={compactInputCls}
                                value={draft.priority}
                                onChange={e => setDraft({ ...draft, priority: e.target.value })}
                              />
                            </label>
                          </div>
                          <label className="flex flex-col gap-1 text-[0.68rem] text-muted">
                            Merge regex (raw offer labels matching this become “{row.name}”)
                            <input
                              className={`${compactInputCls} font-mono`}
                              value={draft.merge_regex}
                              onChange={e => setDraft({ ...draft, merge_regex: e.target.value })}
                              placeholder="(?i)^(?:paypal|pay pal)$"
                            />
                          </label>
                          {renderLinkSelect(draft)}
                          {renderChatTemplates(row.id)}
                          <label className="flex items-center gap-2 text-[0.68rem] text-muted">
                            <input
                              type="checkbox"
                              checked={draft.is_active}
                              onChange={e => setDraft({ ...draft, is_active: e.target.checked })}
                            />
                            Active (usable for taking offers)
                          </label>
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
