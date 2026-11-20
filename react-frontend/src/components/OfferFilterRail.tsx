import { useState, type ReactNode } from 'react';
import { useFilters } from '../hooks/useFilters';
import { useTimezone } from '../hooks/useTimezone';
import { formatFiat } from '../utils/currency';
import { formatTimeOnly } from '../utils/formatters';
import {
  FiatSelect,
  FilterLabel,
  LivePremiumSelect,
  LiveProfitRange,
  PaymentMethodScopeDropdown,
  ReferenceSourceSelect,
} from './ControlPanel';

export type OfferFilterRailScope = 'live' | 'past' | 'all';
export type DirectionFilter = 'both' | 'bid' | 'ask';

function exchangeFilterLabel(name: string): string {
  if (name === 'bisq') return 'Bisq v1';
  if (name === 'bisq2') return 'Bisq v2';
  if (name === 'hodlhodl') return 'HodlHodl';
  if (name === 'robosats') return 'RoboSats';
  if (name === 'peachbitcoin') return 'Peach';
  if (name === 'mostro') return 'Mostro';
  if (name === 'noones') return 'Noones';
  return name;
}

interface PillGroupProps {
  label: string;
  description: string;
  options: { value: string; label: string; disabled?: boolean; title?: string }[];
  selected: string;
  onChange: (v: string) => void;
}

function PillGroup({ label, description, options, selected, onChange }: PillGroupProps) {
  const base = 'rounded border px-2 py-0.5 text-[0.7rem] font-medium transition-colors';
  const active = 'border-accent/60 bg-accent/10 text-accent';
  const inactive = 'border-border bg-bg/40 text-muted hover:text-text';
  const disabledCls = 'border-border bg-bg/40 text-muted opacity-40 cursor-not-allowed';
  return (
    <div className="flex flex-col gap-1">
      <FilterLabel>{label}</FilterLabel>
      <div className="flex flex-wrap items-center gap-1">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            title={o.title ?? description}
            disabled={o.disabled}
            onClick={() => { if (!o.disabled) onChange(o.value); }}
            className={`${base} ${o.disabled ? disabledCls : selected === o.value ? active : inactive}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ExchangeFilterGroupProps {
  label: string;
  description: string;
  exchanges: string[];
  counts: Record<string, number>;
  disabled: Set<string>;
  onToggle: (exchange: string) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
}

function ExchangeFilterGroup({
  label,
  description,
  exchanges,
  counts,
  disabled,
  onToggle,
  onEnableAll,
  onDisableAll,
}: ExchangeFilterGroupProps) {
  const base = 'rounded border px-2 py-0.5 text-[0.7rem] font-medium transition-colors';
  const enabledCls = 'border-accent/60 bg-accent/10 text-accent';
  const disabledCls = 'border-border bg-bg/40 text-muted line-through opacity-60 hover:opacity-80';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <FilterLabel>{label}</FilterLabel>
        {exchanges.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onEnableAll} className="text-[0.6rem] font-medium text-muted hover:text-accent">
              All
            </button>
            <button type="button" onClick={onDisableAll} className="text-[0.6rem] font-medium text-muted hover:text-accent">
              None
            </button>
          </div>
        )}
      </div>
      {exchanges.length === 0 ? (
        <span className="text-[0.7rem] text-muted">No exchanges in this window</span>
      ) : (
        <div className="flex flex-wrap items-center gap-1" title={description}>
          {exchanges.map(exchange => {
            const isEnabled = !disabled.has(exchange);
            return (
              <button
                key={exchange}
                type="button"
                onClick={() => onToggle(exchange)}
                className={`${base} ${isEnabled ? enabledCls : disabledCls}`}
              >
                {exchangeFilterLabel(exchange)}
                <span className="ml-1 text-[0.65rem] opacity-70">{counts[exchange] ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface OfferFilterRailProps {
  scope: OfferFilterRailScope;
  directionFilter: DirectionFilter;
  onDirectionChange: (value: DirectionFilter) => void;
  exchanges: string[];
  exchangeCounts: Record<string, number>;
  disabledExchanges: string[];
  onToggleExchange: (exchange: string) => void;
  onEnableAllExchanges: () => void;
  onDisableAllExchanges: () => void;
  onRefresh: () => void;
  lastUpdatedAt: string;
  onReset: () => void;
  /**
   * Premium selector. Defaults to the live selector (bound to FiltersContext)
   * for the live and combined scopes; past views pass their own.
   */
  premium?: ReactNode;
  /** Range slider. Defaults to the live range for the live and combined scopes. */
  range?: ReactNode;
  /** Mode-specific controls rendered after the shared ones (timeframe, duration…). */
  extra?: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
  showReferenceSource?: boolean;
  /** Shown in the live "Net Capped" option label. */
  maxFiatLimit?: number | null;
}

/**
 * Offer filter rail shared by Live and Past mode. Every mode renders the same
 * sections in the same order; only the mode-specific block differs:
 *
 *   Reference price · Direction · Exchanges · Fiat · Payment methods ·
 *   Premium · Range · [mode-specific] · [Refresh — live] · Reset · [footer]
 */
export function OfferFilterRail({
  scope,
  directionFilter,
  onDirectionChange,
  exchanges,
  exchangeCounts,
  disabledExchanges,
  onToggleExchange,
  onEnableAllExchanges,
  onDisableAllExchanges,
  onRefresh,
  lastUpdatedAt,
  onReset,
  premium,
  range,
  extra,
  footer,
  ariaLabel = 'Insights filters',
  showReferenceSource = true,
  maxFiatLimit,
}: OfferFilterRailProps) {
  const { filters, refPrice } = useFilters();
  const { timezone } = useTimezone();
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const disabledExchangeSet = new Set(disabledExchanges);
  const includesLive = scope === 'live' || scope === 'all';
  const premiumControl = premium ?? (includesLive ? <LivePremiumSelect maxFiatLimit={maxFiatLimit} /> : null);
  const rangeControl = range ?? (includesLive ? <LiveProfitRange /> : null);
  const lastUpdated = lastUpdatedAt ? `Updated ${formatTimeOnly(lastUpdatedAt, timezone)}` : '';

  if (filtersCollapsed) {
    return (
      <button
        type="button"
        aria-label={`Show ${ariaLabel}`}
        aria-expanded={false}
        onClick={() => setFiltersCollapsed(false)}
        className="shrink-0 rounded-lg border border-border bg-bg/20 px-2 py-3 text-[0.68rem] font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-surface hover:text-text lg:w-9 lg:[writing-mode:vertical-rl] lg:rotate-180"
      >
        Filters ▸
      </button>
    );
  }

  return (
    <aside aria-label={ariaLabel} className="flex shrink-0 flex-col gap-3 rounded-lg border border-border bg-bg/20 p-3 lg:w-48 xl:w-56 lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <FilterLabel>Filters</FilterLabel>
        <button
          type="button"
          aria-label={`Hide ${ariaLabel}`}
          aria-expanded={true}
          onClick={() => setFiltersCollapsed(true)}
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-[0.75rem] leading-none text-muted transition-colors hover:text-text"
          title="Hide filters"
        >
          ◂
        </button>
      </div>
      {showReferenceSource && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5"
          title="Current CEX reference price"
        >
          <span className="text-[0.65rem] uppercase tracking-wide text-muted">
            BTC/{filters.fiat} — {filters.cex.charAt(0).toUpperCase() + filters.cex.slice(1)}
          </span>
          <span className={`text-[0.8rem] font-semibold tabular-nums mono-nums ${refPrice != null ? 'text-text' : 'text-muted'}`}>
            {refPrice != null ? formatFiat(refPrice, filters.fiat) : '—'}
          </span>
        </div>
      )}
      <PillGroup
        label="Direction"
        description="Filter the offers list by offer side (applies to live and past offers)"
        options={[
          { value: 'both', label: 'Both' },
          { value: 'bid', label: 'Bid' },
          { value: 'ask', label: 'Ask' },
        ]}
        selected={directionFilter}
        onChange={v => onDirectionChange(v as DirectionFilter)}
      />
      <ExchangeFilterGroup
        label="Exchanges"
        description="Click to include or exclude DEX exchanges from the offers list (applies to live and past offers)"
        exchanges={exchanges}
        counts={exchangeCounts}
        disabled={disabledExchangeSet}
        onToggle={onToggleExchange}
        onEnableAll={onEnableAllExchanges}
        onDisableAll={onDisableAllExchanges}
      />
      <FiatSelect />
      <PaymentMethodScopeDropdown />
      {premiumControl}
      {rangeControl}
      {(extra || (includesLive && showReferenceSource)) && (
        <div className="flex flex-col gap-3 border-t border-border/70 pt-3">
          {includesLive && showReferenceSource && <ReferenceSourceSelect />}
          {extra}
        </div>
      )}

      {includesLive && (
        <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2">
          <span className="text-[0.68rem] text-muted truncate">{lastUpdated}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="shrink-0 rounded border border-accent bg-accent px-2.5 py-1 text-[0.72rem] font-semibold text-black transition-opacity hover:opacity-85"
          >
            ↻ Refresh
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onReset}
        className="w-full rounded-md border-none bg-red px-2.5 py-1.5 text-[0.72rem] font-semibold text-black transition-opacity hover:opacity-85"
      >
        ↺ Reset filters
      </button>

      {footer}
    </aside>
  );
}
