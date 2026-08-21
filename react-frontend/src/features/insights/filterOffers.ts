import type { Filters, Offer } from '../../types';
import {
  getEstimatedProfitFiat,
  getPremiumMetricValue,
  isOfferLive,
  profitScenarioForPremiumMode,
} from '../../utils/offerAccess';

export interface OfferFilterOptions {
  skipPayment?: boolean;
  skipProfitRange?: boolean;
  skipPremiumRange?: boolean;
}

export function countOffersByPaymentMethod(offers: Offer[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const offer of offers) {
    for (const method of offer.payment_methods ?? []) {
      counts[method] = (counts[method] ?? 0) + 1;
    }
  }
  return counts;
}

export function applyOfferFilters(
  offers: Offer[],
  filters: Filters,
  paymentFilter: ((offer: Offer) => boolean) | null,
  options?: OfferFilterOptions,
): Offer[] {
  let filtered = offers;
  if (filters.direction) filtered = filtered.filter(offer => offer.direction === filters.direction);
  if (filters.exchange) filtered = filtered.filter(offer => offer.exchange === filters.exchange);
  if (filters.excludedExchanges.length > 0) {
    const excluded = new Set(filters.excludedExchanges);
    filtered = filtered.filter(offer => !excluded.has(offer.exchange));
  }
  if (!options?.skipPayment && paymentFilter) filtered = filtered.filter(paymentFilter);
  if (filters.status === 'open') filtered = filtered.filter(isOfferLive);
  if (filters.status === 'closed') filtered = filtered.filter(offer => !isOfferLive(offer));
  if (!options?.skipPremiumRange && filters.rangeMetric === 'premium') {
    const minimum = Number.parseFloat(filters.premiumMin);
    const maximum = Number.parseFloat(filters.premiumMax);
    if (!Number.isNaN(minimum)) {
      filtered = filtered.filter(offer => (getPremiumMetricValue(offer, filters.premiumMode) ?? 0) >= minimum);
    }
    if (!Number.isNaN(maximum)) {
      filtered = filtered.filter(offer => (getPremiumMetricValue(offer, filters.premiumMode) ?? 0) <= maximum);
    }
  }
  if (!options?.skipProfitRange && filters.rangeMetric === 'profit') {
    const minimum = Number.parseFloat(filters.profitMin);
    const maximum = Number.parseFloat(filters.profitMax);
    const scenario = profitScenarioForPremiumMode(filters.premiumMode);
    if (!Number.isNaN(minimum)) {
      filtered = filtered.filter(offer => (getEstimatedProfitFiat(offer, scenario) ?? 0) >= minimum);
    }
    if (!Number.isNaN(maximum)) {
      filtered = filtered.filter(offer => (getEstimatedProfitFiat(offer, scenario) ?? 0) <= maximum);
    }
  }
  if (filters.premiumOnly) {
    filtered = filtered.filter(offer => (getPremiumMetricValue(offer, filters.premiumMode) ?? 0) > 0);
  }
  return filtered.toSorted(
    (a, b) => (getPremiumMetricValue(a, filters.premiumMode) ?? 0) - (getPremiumMetricValue(b, filters.premiumMode) ?? 0),
  );
}
