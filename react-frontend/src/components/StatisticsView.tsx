import { useEffect } from 'react';
import { useStatistics, type StatisticsLoadParams } from '../hooks/useStatistics';
import { useFilters } from '../hooks/useFilters';
import { usePreferences } from '../hooks/usePreferences';
import { LoadingSpinner } from './LoadingSpinner';
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

export function StatisticsView() {
  const { filters } = useFilters();
  const { excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit } = usePreferences();
  const { data, loading, error, load } = useStatistics();

  useEffect(() => {
    const params: StatisticsLoadParams = {
      hours: filters.hours,
      cex: filters.cex,
      excludedPaymentMethods: excludedMethods,
      excludedCEXes,
      feeTier,
      coupledHedge,
      maxFiatLimit,
    };
    load(params);
  }, [filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, load]);

  if (loading && !data) {
    return (
      <div className="lg:flex-1 lg:min-h-0 flex items-center justify-center">
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

  return (
    <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-3 sm:gap-4 overflow-y-auto lg:overflow-y-auto pr-0.5">
      {error && (
        <div className="bg-error border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Live dimension */}
      <section className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 shrink-0">
        <SectionHeader title="Live Offers" subtitle="Currently open across exchanges" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
          <ExchangesCard exchangesLive={live.exchanges_live} offersByExchange={live.offers_by_exchange} />
          <PremiumsCard premium={live.premium_summary} />
          <PaymentMethodsCard counts={live.payment_method_counts} />
        </div>
      </section>

      {/* Past dimension */}
      <section className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 shrink-0">
        <SectionHeader title="Past Offers" subtitle={`${past.total_offers} closed in window`} />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
          <PastPremiumsCard frames={past.past_premiums} />
          <LifetimeCard lifetimes={past.premium_lifetimes} />
          <PaymentMethodsCard counts={past.payment_method_counts} />
        </div>
      </section>

      {/* Shared dimension */}
      <section className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 shrink-0">
        <SectionHeader
          title="All Offers"
          subtitle={`${shared.total_offers} in last ${shared.hours}h (live + past)`}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
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
        </div>
      </section>
    </div>
  );
}
