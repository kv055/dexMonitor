import { useState, useRef, useEffect, useMemo, type ReactNode, type RefObject } from 'react';
import { useFilters } from '../hooks/useFilters';
import { useLiveFiatRawPremiumCounts } from '../hooks/useLiveOffers';
import type { Offer, PremiumFilterMode } from '../types';
import { formatFiat } from '../utils/currency';
import { premiumModeLabel } from '../utils/premiumModes';
import {
  getEstimatedProfitFiat,
  getPremiumMetricValue,
  hasCappedScenario,
  isOfferLive,
  profitScenarioForPremiumMode,
} from '../utils/offerAccess';

/*
 * Building blocks for the offer filter rail. Live and Past mode render the
 * same primitives (labels, dropdowns, toggles, range sliders) so the two
 * panels look and behave alike; only the data each control is wired to
 * differs between modes.
 */

// ── Shared styling ─────────────────────────────────────────────────────────

const labelCls = 'text-[0.65rem] font-semibold uppercase tracking-wide text-muted';
const controlCls = 'w-full rounded border border-border bg-bg/60 px-2 py-1.5 text-[0.75rem] font-medium text-text outline-none transition-colors hover:border-accent/50 focus:border-accent';
const menuCls = 'absolute left-0 top-full z-50 mt-1 w-full min-w-44 overflow-hidden rounded-md border border-border bg-surface shadow-lg';

function menuItemCls(active: boolean, disabled = false): string {
  const base = 'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors';
  if (disabled) return `${base} cursor-not-allowed text-muted/45`;
  return `${base} ${active ? 'bg-accent/15 text-accent hover:bg-accent/20' : 'text-text hover:bg-bg'}`;
}

/** Closes a popover on outside click or Escape. */
function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, open, close]);
}

export function FilterLabel({ children, title }: { children: ReactNode; title?: string }) {
  return <span className={labelCls} title={title}>{children}</span>;
}

// ── FilterSelect: the one labelled dropdown used across the rail ───────────

export interface FilterSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
  /** Draws a divider above this option. */
  separated?: boolean;
  /** Optional count badge shown at the right edge of the option. */
  count?: number;
  countTitle?: string;
  countTestId?: string;
}

export function FilterSelect({
  label,
  description,
  options,
  selected,
  onChange,
}: {
  label: string;
  description: string;
  options: FilterSelectOption[];
  selected: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(ref, open, close);
  const activeOption = options.find(option => option.value === selected) ?? options[0];

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <FilterLabel>{label}</FilterLabel>
      <button
        type="button"
        title={description}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`${controlCls} flex items-center gap-1.5 text-left`}
      >
        <span className="truncate">{activeOption?.label ?? selected}</span>
        <span className="ml-auto text-[0.65rem] text-muted">▾</span>
      </button>
      {open && (
        <div className={menuCls} role="menu">
          {options.map(option => {
            const active = option.value === selected;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                aria-label={option.label}
                disabled={option.disabled}
                title={option.title}
                className={`${menuItemCls(active, option.disabled)} ${option.separated ? 'border-t border-border/60' : ''}`}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span aria-hidden="true" className="w-3 text-center">{active ? '✓' : ''}</span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.count != null && (
                  <span
                    data-testid={option.countTestId}
                    aria-hidden="true"
                    title={option.countTitle}
                    className={`rounded-full border px-1.5 py-0.5 text-[0.62rem] font-semibold tabular-nums mono-nums ${
                      option.count > 0
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-border bg-bg/40 text-muted'
                    }`}
                  >
                    {option.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SegmentedToggle: unit switches (EUR / %, BTC / EUR) ────────────────────

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <span role="group" aria-label={ariaLabel} className="inline-flex shrink-0 items-center rounded border border-border bg-bg/70 p-0.5 text-[0.65rem]">
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-sm px-1.5 py-0.5 normal-case leading-none transition-colors ${active ? 'bg-accent/15 text-accent font-semibold' : 'text-muted hover:text-text'}`}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

// ── Range sliders ──────────────────────────────────────────────────────────

export function CustomDateRangeFilter({
  startDate,
  endDate,
  maxDate,
  loading,
  onStartDateChange,
  onEndDateChange,
}: {
  startDate: string;
  endDate: string;
  maxDate: string;
  loading: boolean;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}) {
  const dateInputCls = 'w-full rounded border border-border bg-bg/60 px-2 py-1 text-[0.75rem] text-text outline-none transition-colors hover:border-accent/50 focus:border-accent';
  return (
    <fieldset className="flex flex-col gap-1" title="Show offers closed within an inclusive custom date range">
      <legend className={labelCls}>Custom date range{loading ? ' · Loading…' : ''}</legend>
      <label className="flex flex-col gap-0.5 text-[0.65rem] text-muted">
        Start date
        <input
          type="date"
          aria-label="Start date"
          value={startDate}
          max={endDate || maxDate}
          onChange={event => onStartDateChange(event.target.value)}
          className={dateInputCls}
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[0.65rem] text-muted">
        End date
        <input
          type="date"
          aria-label="End date"
          value={endDate}
          min={startDate || undefined}
          max={maxDate}
          onChange={event => onEndDateChange(event.target.value)}
          className={dateInputCls}
        />
      </label>
    </fieldset>
  );
}

interface DualRangeFilterProps {
  label: string;
  description: string;
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  formatValue: (value: number) => string;
  disabled?: boolean;
  disabledMessage?: string;
  step?: number;
}

export function DualRangeFilter({
  label,
  description,
  min,
  max,
  value,
  onChange,
  formatValue,
  disabled,
  disabledMessage = 'No data in this window',
  step = 1,
}: DualRangeFilterProps) {
  const [lo, hi] = value;
  const span = Math.max(max - min, step);
  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;
  const rangeInputClass =
    'pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent [&::-moz-range-thumb]:bg-bg [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-bg [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent';

  if (disabled) {
    return (
      <div className="flex flex-col gap-1">
        <span className={labelCls}>{label}</span>
        <span className="text-[0.7rem] text-muted">{disabledMessage}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" title={description}>
      <span className={labelCls}>{label}</span>
      <div className="flex justify-between gap-2 text-[0.65rem] text-muted mono-nums tabular-nums">
        <span>{formatValue(lo)}</span>
        <span>{formatValue(hi)}</span>
      </div>
      <div className="relative mx-0.5 h-6">
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded bg-border" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-accent/60" style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }} />
        <input aria-label={`${label} minimum`} type="range" min={min} max={max} step={step} value={lo} onChange={event => onChange([Math.min(Number(event.target.value), hi), hi])} className={rangeInputClass} style={{ zIndex: lo > max - step * 10 ? 5 : 3 }} />
        <input aria-label={`${label} maximum`} type="range" min={min} max={max} step={step} value={hi} onChange={event => onChange([lo, Math.max(Number(event.target.value), lo)])} className={rangeInputClass} style={{ zIndex: 4 }} />
      </div>
    </div>
  );
}

export type ProfitRangeUnit = 'fiat' | 'pct';

/**
 * "Range" block: a fiat / % unit toggle above a dual slider. Values are in
 * hundredths (cents for fiat, hundredths of a percent for %).
 */
export function ProfitRangeFilter({
  fiat,
  unit,
  onUnitChange,
  min,
  max,
  value,
  onChange,
  hasData,
  description,
  emptyMessage,
}: {
  fiat: string;
  unit: ProfitRangeUnit;
  onUnitChange: (unit: ProfitRangeUnit) => void;
  min: number;
  max: number;
  value: [number, number] | null;
  onChange: (value: [number, number]) => void;
  hasData: boolean;
  description: string;
  emptyMessage: string;
}) {
  const fiatLabel = fiat.length <= 4 ? fiat : fiat.slice(0, 3);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <FilterLabel title="Switch the range slider between net profit in fiat and premium percentage">Range</FilterLabel>
        <SegmentedToggle
          ariaLabel="Range unit"
          options={[{ value: 'fiat', label: fiatLabel }, { value: 'pct', label: '%' }]}
          value={unit}
          onChange={onUnitChange}
        />
      </div>
      <DualRangeFilter
        label={unit === 'fiat' ? `Net profit ${fiat}` : 'Premium %'}
        description={description}
        min={min}
        max={Math.max(max, min + 1)}
        value={value ?? [min, max]}
        onChange={onChange}
        formatValue={hundredths => unit === 'fiat'
          ? formatFiat(hundredths / 100, fiat)
          : `${(hundredths / 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`}
        disabled={!hasData || value == null}
        disabledMessage={emptyMessage}
      />
    </div>
  );
}

// ── Premium ────────────────────────────────────────────────────────────────

const PREMIUM_DESCRIPTION = 'Raw is the quoted premium. Net Full deducts trading costs at full order size, Net Capped at your max fiat position, Net Min at the minimum executable size.';
const INCL_NON_PREMIUM = 'incl';

export function PremiumSelect({
  options,
  selected,
  onChange,
}: {
  options: FilterSelectOption[];
  selected: string;
  onChange: (value: string) => void;
}) {
  return (
    <FilterSelect
      label="Premium"
      description={PREMIUM_DESCRIPTION}
      options={options}
      selected={selected}
      onChange={onChange}
    />
  );
}

function baseOffersForPremiumCategory(offers: Offer[], filters: {
  direction: string;
  exchange: string;
  excludedExchanges: string[];
}): Offer[] {
  let f = offers.filter(isOfferLive);
  if (filters.direction) f = f.filter(o => o.direction === filters.direction);
  if (filters.exchange) f = f.filter(o => o.exchange === filters.exchange);
  if (filters.excludedExchanges.length > 0) {
    const excluded = new Set(filters.excludedExchanges);
    f = f.filter(o => !excluded.has(o.exchange));
  }
  return f;
}

/** True when the premium category would show at least one offer. */
function premiumCategoryAvailable(offers: Offer[], mode: PremiumFilterMode, premiumOnly: boolean): boolean {
  if (offers.length === 0) return false;
  if (!premiumOnly) return true;
  if (mode === 'net_capped') {
    // Capped mode only applies when at least one offer exceeds the fiat cap.
    return offers.some(o => hasCappedScenario(o) && (getPremiumMetricValue(o, 'net_capped') ?? 0) > 0);
  }
  return offers.some(o => (getPremiumMetricValue(o, mode) ?? 0) > 0);
}

const LIVE_PREMIUM_MODES: PremiumFilterMode[] = ['raw', 'net_full', 'net_capped'];

/** Live premium selector, bound to the shared FiltersContext. */
export function LivePremiumSelect({ maxFiatLimit }: { maxFiatLimit?: number | null }) {
  const { offers, filters, setFilters } = useFilters();
  const categoryOffers = useMemo(() => baseOffersForPremiumCategory(offers, filters), [offers, filters]);

  const options: FilterSelectOption[] = [
    ...LIVE_PREMIUM_MODES.map(mode => {
      const enabled = premiumCategoryAvailable(categoryOffers, mode, true);
      return {
        value: mode,
        label: premiumModeLabel(mode, filters.fiat, maxFiatLimit),
        disabled: !enabled,
        title: enabled
          ? undefined
          : mode === 'net_capped'
            ? 'No offers exceed the max fiat position (capped volume unused)'
            : `No ${premiumModeLabel(mode).toLowerCase()} premium offers in the current list`,
      };
    }),
    {
      value: INCL_NON_PREMIUM,
      label: 'Incl. non premium offers',
      separated: true,
      disabled: !premiumCategoryAvailable(categoryOffers, filters.premiumMode, false),
      title: categoryOffers.length === 0 ? 'No offers in the current list' : 'Also show offers without a positive premium',
    },
  ];

  return (
    <PremiumSelect
      options={options}
      selected={filters.premiumOnly ? filters.premiumMode : INCL_NON_PREMIUM}
      onChange={value => setFilters(value === INCL_NON_PREMIUM
        ? { premiumOnly: false }
        : { premiumMode: value as PremiumFilterMode, premiumOnly: true })}
    />
  );
}

/** Live range slider, bound to the shared FiltersContext. */
export function LiveProfitRange() {
  const { filters, setFilters, offersForProfitRange, offersForPremiumRange } = useFilters();
  const metric = filters.rangeMetric;
  const profitScenario = profitScenarioForPremiumMode(filters.premiumMode);
  const categoryKey = `${filters.premiumMode}:${filters.premiumOnly ? 'only' : 'all'}`;
  const prevCategoryRef = useRef(categoryKey);
  const minKey = metric === 'profit' ? 'profitMin' : 'premiumMin';
  const maxKey = metric === 'profit' ? 'profitMax' : 'premiumMax';

  const boundOffers = metric === 'profit' ? offersForProfitRange : offersForPremiumRange;
  const bounds = useMemo(() => {
    const values = boundOffers
      .filter(isOfferLive)
      .map(offer => metric === 'profit'
        ? getEstimatedProfitFiat(offer, profitScenario)
        : getPremiumMetricValue(offer, filters.premiumMode))
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length === 0) return null;
    return {
      min: Math.floor(Math.min(...values) * 100),
      max: Math.ceil(Math.max(...values) * 100),
    };
  }, [boundOffers, metric, filters.premiumMode, profitScenario]);

  useEffect(() => {
    if (bounds == null) return;
    const categoryChanged = prevCategoryRef.current !== categoryKey;
    prevCategoryRef.current = categoryKey;
    // Reset the active range whenever the premium category changes so min/max
    // match the offers in that category (e.g. Net Full vs all offers).
    if (categoryChanged || filters[minKey] === '' || filters[maxKey] === '') {
      setFilters({
        [minKey]: (bounds.min / 100).toFixed(2),
        [maxKey]: (bounds.max / 100).toFixed(2),
      });
    }
  }, [bounds, categoryKey, filters, minKey, maxKey, setFilters]);

  const min = bounds?.min ?? 0;
  const max = Math.max(bounds?.max ?? 1, min + 1);
  const parsedMin = parseFloat(filters[minKey]);
  const parsedMax = parseFloat(filters[maxKey]);
  const currentMin = Math.max(min, Math.min(Math.round((Number.isNaN(parsedMin) ? min / 100 : parsedMin) * 100), max));
  const currentMax = Math.max(currentMin, Math.min(Math.round((Number.isNaN(parsedMax) ? max / 100 : parsedMax) * 100), max));

  return (
    <ProfitRangeFilter
      fiat={filters.fiat}
      unit={metric === 'profit' ? 'fiat' : 'pct'}
      onUnitChange={unit => setFilters({ rangeMetric: unit === 'fiat' ? 'profit' : 'premium' })}
      min={min}
      max={max}
      value={bounds == null ? null : [currentMin, currentMax]}
      onChange={([nextMin, nextMax]) => setFilters({ [minKey]: (nextMin / 100).toFixed(2), [maxKey]: (nextMax / 100).toFixed(2) })}
      hasData={bounds != null}
      description={metric === 'profit'
        ? `Filter offers in the selected premium category by net profit (${filters.premiumMode === 'net_capped' ? 'capped size' : 'full size'})`
        : 'Filter offers in the selected premium category by premium percentage'}
      emptyMessage={`No ${metric === 'profit' ? 'profit' : 'premium'} data in this premium category`}
    />
  );
}

// ── Fiat / reference source / payment methods ──────────────────────────────

const FIAT_OPTIONS = ['EUR', 'USD', 'GBP', 'AUD', 'CHF', 'SEK', 'NOK', 'CAD'];
const SOURCE_OPTIONS = ['kraken', 'coinbase', 'bitstamp', 'binance'];

export function FiatSelect() {
  const { filters, setFilters } = useFilters();
  const rawPremiumCounts = useLiveFiatRawPremiumCounts();
  return (
    <FilterSelect
      label="Fiat"
      description="Show live and past offers quoted in this currency"
      selected={filters.fiat}
      onChange={fiat => setFilters({ fiat })}
      options={FIAT_OPTIONS.map(currency => {
        const count = rawPremiumCounts[currency] ?? 0;
        return {
          value: currency,
          label: currency,
          count,
          countTitle: `${count} live offer${count === 1 ? '' : 's'} with a raw premium`,
          countTestId: `fiat-raw-premium-count-${currency}`,
        };
      })}
    />
  );
}

export function ReferenceSourceSelect() {
  const { filters, setFilters } = useFilters();
  return (
    <FilterSelect
      label="Reference source"
      description="CEX reference-price source used while displaying offers"
      selected={filters.cex}
      onChange={cex => setFilters({ cex })}
      options={SOURCE_OPTIONS.map(source => ({ value: source, label: source[0].toUpperCase() + source.slice(1) }))}
    />
  );
}

/** Payment-scope control shared by Live and Past mode. */
export function PaymentMethodScopeDropdown() {
  const { filters, setFilters, linkedPaymentMethodOptions } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useMemo(() => () => setOpen(false), []);
  useDismiss(ref, open, close);

  const selected = new Set(filters.selectedLinkedPaymentMethods);
  const selectedLabel = selected.size === 0
    ? 'Linked methods'
    : `${selected.size} linked method${selected.size === 1 ? '' : 's'}`;
  const linkedMethodsByCategory = useMemo(() => {
    const categories = new Map<string, NonNullable<typeof linkedPaymentMethodOptions>>();
    for (const method of linkedPaymentMethodOptions ?? []) {
      const methods = categories.get(method.category) ?? [];
      methods.push(method);
      categories.set(method.category, methods);
    }
    return [...categories.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, methods]) => ({
        category,
        methods: methods.sort((left, right) => left.name.localeCompare(right.name)),
      }));
  }, [linkedPaymentMethodOptions]);

  const toggleMethod = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setFilters({ paymentScope: 'linked', selectedLinkedPaymentMethods: [...next].sort((a, b) => a.localeCompare(b)) });
  };

  const allActive = filters.paymentScope === 'all';
  const linkedActive = filters.paymentScope === 'linked' && selected.size === 0;

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <FilterLabel>Payment methods</FilterLabel>
      <button
        type="button"
        className={`${controlCls} flex items-center gap-1.5 text-left`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Show all methods, linked methods, or selected linked methods"
        onClick={() => setOpen(value => !value)}
      >
        <span className="truncate">{allActive ? 'All methods' : selectedLabel}</span>
        <span className="ml-auto text-[0.65rem] text-muted">▾</span>
      </button>
      {open && (
        <div className={`${menuCls} min-w-52`} role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={allActive}
            className={menuItemCls(allActive)}
            onClick={() => setFilters({ paymentScope: 'all', selectedLinkedPaymentMethods: [] })}
          >
            <span aria-hidden="true" className="w-3 text-center">{allActive ? '✓' : ''}</span>
            All methods
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={linkedActive}
            className={menuItemCls(linkedActive)}
            onClick={() => setFilters({ paymentScope: 'linked', selectedLinkedPaymentMethods: [] })}
          >
            <span aria-hidden="true" className="w-3 text-center">{linkedActive ? '✓' : ''}</span>
            Linked methods
          </button>
          {filters.paymentScope === 'linked' && (
            <div className="border-t border-border px-2.5 py-1.5">
              <p className="mb-1 text-[0.6rem] uppercase tracking-wide text-muted">Linked payment methods</p>
              {linkedPaymentMethodOptions == null ? (
                <p className="text-[0.68rem] text-muted">Loading linked methods…</p>
              ) : linkedMethodsByCategory.length === 0 ? (
                <p className="text-[0.68rem] text-muted">No linked methods.</p>
              ) : (
                <div className="flex max-h-52 flex-col overflow-y-auto">
                  {linkedMethodsByCategory.map(({ category, methods }, index) => (
                    <div key={category} className={`py-1 ${index > 0 ? 'mt-1 border-t border-border/70 pt-2' : 'pt-0'}`}>
                      <p className="px-1 pb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted">{category}</p>
                      {methods.map(method => (
                        <label key={method.name} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-text hover:bg-bg">
                          <input
                            type="checkbox"
                            checked={selected.has(method.name)}
                            onChange={() => toggleMethod(method.name)}
                          />
                          <span className="truncate">{method.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
