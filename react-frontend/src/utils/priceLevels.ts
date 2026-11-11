/**
 * "Nice" axis step (1/2/5 × 10^n) splitting `range` into roughly `targetSteps`
 * intervals. The depth chart uses the same step for its price-axis labels and
 * its price-level bands, so every band lies exactly between two labels.
 */
export function niceStep(range: number, targetSteps: number): number {
  const rough = range / targetSteps;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * pow;
}

export const PRICE_LEVEL_TARGET_STEPS = 6;

export function priceLevelStep(priceMin: number, priceMax: number): number {
  return niceStep(priceMax - priceMin, PRICE_LEVEL_TARGET_STEPS);
}

export interface PriceLevel {
  low: number;
  high: number;
}

/** The [low, high) band between two adjacent axis labels that contains `price`. */
export function priceLevelAt(price: number, step: number): PriceLevel {
  const low = Math.floor(price / step) * step;
  return { low, high: low + step };
}

export interface PriceLevelSide {
  /** Offers priced inside the level. */
  count: number;
  /** Max BTC of the offers inside the level. */
  btc: number;
  /**
   * Cumulative BTC from the top of the book through this level — the value
   * the depth chart's x axis shows at the level's far edge (its low edge for
   * bids, which accumulate downwards; its high edge for asks).
   */
  cumBtc: number;
}

export interface PriceLevelStats {
  bids: PriceLevelSide;
  asks: PriceLevelSide;
}

/**
 * Counts offers (and their max BTC) with a price in [level.low, level.high),
 * plus the cumulative depth through the level on each side.
 */
export function priceLevelStats<T>(
  offers: readonly T[],
  level: PriceLevel,
  accessors: {
    price: (offer: T) => number;
    btc: (offer: T) => number;
    isBid: (offer: T) => boolean;
  },
): PriceLevelStats {
  const stats: PriceLevelStats = {
    bids: { count: 0, btc: 0, cumBtc: 0 },
    asks: { count: 0, btc: 0, cumBtc: 0 },
  };
  for (const offer of offers) {
    const price = accessors.price(offer);
    const isBid = accessors.isBid(offer);
    const side = isBid ? stats.bids : stats.asks;
    const btc = accessors.btc(offer);
    if (isBid ? price >= level.low : price < level.high) side.cumBtc += btc;
    if (!(price >= level.low && price < level.high)) continue;
    side.count += 1;
    side.btc += btc;
  }
  return stats;
}
