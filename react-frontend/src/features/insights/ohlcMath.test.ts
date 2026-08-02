import { describe, expect, it } from 'vitest';
import { aggregateOHLC, gapThresholdSeconds, requiredHoursForCandleSize, weakenColor } from './ohlcMath';

describe('OHLC calculations', () => {
  it('aggregates candles without mutating their source', () => {
    const candles = [
      { time: '2026-01-01T00:00:00Z', open: 10, high: 12, low: 9, close: 11 },
      { time: '2026-01-01T00:01:00Z', open: 11, high: 14, low: 10, close: 13 },
    ];
    const snapshot = structuredClone(candles);
    expect(aggregateOHLC(candles, 5, 1)).toEqual([
      { time: '2026-01-01T00:00:00Z', open: 10, high: 14, low: 9, close: 13 },
    ]);
    expect(candles).toEqual(snapshot);
  });

  it('uses cadence-aware gaps and window sizes', () => {
    expect(gapThresholdSeconds([{ utcSec: 0 }, { utcSec: 60 }, { utcSec: 120 }])).toBe(150);
    expect(requiredHoursForCandleSize(240)).toBe(480);
  });

  it('weakens colors with a safe fallback', () => {
    expect(weakenColor('#f00')).toMatch(/^rgba\(/);
    expect(weakenColor('not-a-color')).toBe('rgba(139, 148, 158, 0.7)');
  });
});
