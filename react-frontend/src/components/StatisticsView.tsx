import { useEffect, useState } from 'react';
import { useStatistics } from '../hooks/useStatistics';
import { useMarketRequestParams } from '../hooks/useMarketRequestParams';
import { LoadingSpinner } from './LoadingSpinner';
import { OfferLifecyclePremiumChart } from './OfferLifecyclePremiumChart';
import {
  ExchangesCard,
  LifetimeCard,
  PastPremiumsCard,
  PaymentMethodsCard,
  PremiumsCard,
} from './GeneralStats';

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 shrink-0">
      <h2 className="text-[0.7rem] uppercase tracking-widest font-semibold text-muted">{title}</h2>
      {subtitle && <span className="text-[0.65rem] text-muted">{subtitle}</span>}
    </div>
  );
}

function formatBuiltAt(value: string | null): string | null {
  if (!value) return null;
  const builtAt = new Date(value);
  if (Number.isNaN(builtAt.getTime())) return null;
  const diffMs = Date.now() - builtAt.getTime();
  if (diffMs < 0) return 'just now';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

type StatisticsMode = 'live' | 'past' | 'shared';

export function StatisticsView() {
  const { params, ready } = useMarketRequestParams();
  const { data, loading, error, cacheState, builtAt, load } = useStatistics();
  const [mode, setMode] = useState<StatisticsMode>('live');

  useEffect(() => {
    if (!ready) return;
    load(params);
  }, [params, load, ready]);

  if (loading && !data) {
    return (
      <div className="relative lg:flex-1 lg:min-h-0 flex items-center justify-center">
        <LoadingSpinner size={88} label="Loading statistics" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
        <div className="bg-error border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="lg:flex-1 lg:min-h-0 flex items-center justify-center text-sm text-muted">
        No statistics available.
      </div>
    );
  }

  const { live, past, shared } = data;
  const builtAtLabel = formatBuiltAt(builtAt);
  const activeFilters = [
    params.cex.toUpperCase(),
    `${shared.hours}h window`,
    params.excludedPaymentMethods.length > 0 ? `${params.excludedPaymentMethods.length} methods hidden` : null,
  ].filter(Boolean).join(' · ');
  const metaLabel = cacheState === 'stale'
    ? `Refreshed ${builtAtLabel ?? 'recently'} · refreshing in background`
    : builtAtLabel
      ? `Refreshed ${builtAtLabel}`
      : 'Loaded from cache';
  const modeOptions: { value: StatisticsMode; label: string }[] = [
    { value: 'live', label: 'Live Offers' },
    { value: 'past', label: 'Past Offers' },
    { value: 'shared', label: 'All Offers' },
  ];
  const lifecyclePoints = mode === 'live'
    ? (live.offer_lifecycle_points ?? [])
    : mode === 'past'
      ? (past.offer_lifecycle_points ?? [])
      : [...(live.offer_lifecycle_points ?? []), ...(past.offer_lifecycle_points ?? [])];

  let title = 'Live Offers';
  let subtitle = `${live.active_offers} active · ${live.exchanges_live} exchanges`;
  let cards: React.ReactNode;

  if (mode === 'past') {
    title = 'Past Offers';
    subtitle = `${past.total_offers} closed summary in window`;
    cards = (
      <>
        <PastPremiumsCard frames={past.past_premiums} />
        <LifetimeCard lifetimes={past.premium_lifetimes} />
        <PaymentMethodsCard counts={past.payment_method_counts} />
      </>
    );
  } else if (mode === 'shared') {
    title = 'All Offers';
    subtitle = `${shared.total_offers} in last ${shared.hours}h (live + past)`;
    cards = (
      <>
        <ExchangesCard exchangesLive={shared.exchanges_live} offersByExchange={shared.offers_by_exchange} />
        <PaymentMethodsCard counts={shared.payment_method_counts} />
        <div className="relative bg-bg border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1.5 overflow-hidden min-w-0">
          <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-border" />
          <span className="text-[0.65rem] uppercase tracking-widest text-muted font-semibold leading-none">
            Window
          </span>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">
              {shared.total_offers}
            </span>
            <span className="text-[0.68rem] text-muted">offers</span>
            <span className="text-[0.68rem] tabular-nums mono-nums text-muted">
              · {shared.active_offers} active · {shared.exchanges_live} exchanges
            </span>
          </div>
        </div>
      </>
    );
  } else {
    cards = (
      <>
        <ExchangesCard exchangesLive={live.exchanges_live} offersByExchange={live.offers_by_exchange} />
        <PremiumsCard premium={live.premium_summary} />
        <PaymentMethodsCard counts={live.payment_method_counts} />
      </>
    );
  }

  return (
    <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-3 sm:gap-4 overflow-y-auto lg:overflow-y-auto pr-0.5">
      {error && (
        <div className="bg-error border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
          {error}
        </div>
      )}

      <div className="bg-surface border border-border rounded-lg px-3 py-2 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 flex items-center gap-2">
          <h1 className="text-[0.76rem] font-semibold text-text shrink-0">Statistics</h1>
          <span className="text-[0.68rem] text-muted truncate">{activeFilters}</span>
        </div>
        {(builtAtLabel || cacheState === 'stale') && (
          <span className="text-[0.65rem] text-muted shrink-0 whitespace-nowrap">{metaLabel}</span>
        )}
      </div>

      <section className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 lg:flex-1 lg:min-h-0">
        <div className="flex items-center justify-between gap-3 shrink-0">
          <SectionHeader title={title} subtitle={subtitle} />
          <div className="flex items-center gap-1 flex-wrap justify-end">
            {modeOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={mode === option.value
                  ? 'rounded-md border border-accent bg-accent px-2 py-0.5 text-[0.68rem] font-medium text-black transition-colors'
                  : 'rounded-md border border-border bg-bg/40 px-2 py-0.5 text-[0.68rem] font-medium text-muted transition-colors hover:text-text'}
                aria-pressed={mode === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <OfferLifecyclePremiumChart key={mode} points={lifecyclePoints} />
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-3 lg:flex-1 lg:min-h-0 auto-rows-fr">
          {cards}
        </div>
      </section>
    </div>
  );
}
