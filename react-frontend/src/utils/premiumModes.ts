import type { PremiumFilterMode, TakerOpportunityMode } from '../types';
import { formatFiat } from './currency';

/** One naming scheme for premium modes in Live and Past. */
export function premiumModeLabel(
  mode: PremiumFilterMode | TakerOpportunityMode,
  fiat?: string,
  maxFiatLimit?: number | null,
): string {
  switch (mode) {
    case 'raw': return 'Raw';
    case 'net_full': return 'Net Full';
    case 'net_min': return 'Net Min';
    case 'net_capped':
      return maxFiatLimit != null && maxFiatLimit > 0 && fiat
        ? `Net Capped ${formatFiat(maxFiatLimit, fiat, { maximumFractionDigits: 0 })}`
        : 'Net Capped';
  }
}
