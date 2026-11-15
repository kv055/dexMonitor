import { describe, expect, it } from 'vitest';
import { isPriceInLevel, isSamePriceLevel, niceStep, priceLevelAt, priceLevelStats, priceLevelStep } from './priceLevels';

describe('priceLevels', () => {
  it('uses 1/2/5 steps that match the axis labels', () => {
    expect(niceStep(7000, 6)).toBe(1000);
    expect(niceStep(14000, 6)).toBe(2000);
    expect(niceStep(30000, 6)).toBe(5000);
    expect(priceLevelStep(68000, 75000)).toBe(1000);
  });

  it('shrinks the level step when the price axis is zoomed in', () => {
    expect(priceLevelStep(70000, 71000)).toBe(200);
    expect(priceLevelStep(70500, 70800)).toBe(50);
  });

  it('finds the band between two labels that contains a price', () => {
    expect(priceLevelAt(71500, 1000)).toEqual({ low: 71000, high: 72000 });
    expect(priceLevelAt(72000, 1000)).toEqual({ low: 72000, high: 73000 });
  });

  it('counts bid and ask offers inside a half-open level', () => {
    const offers = [
      { price: 70999, btc: 1, bid: true },
      { price: 71000, btc: 0.5, bid: true },
      { price: 71500, btc: 0.25, bid: false },
      { price: 71999, btc: 0.25, bid: false },
      { price: 72000, btc: 2, bid: false },
    ];
    const stats = priceLevelStats(offers, { low: 71000, high: 72000 }, {
      price: o => o.price,
      btc: o => o.btc,
      isBid: o => o.bid,
    });
    expect(stats.bids).toMatchObject({ count: 1, btc: 0.5 });
    expect(stats.asks).toMatchObject({ count: 2, btc: 0.5 });
  });

  it('reports cumulative depth through the level, matching the depth axis', () => {
    const offers = [
      { price: 73000, btc: 4, bid: true },   // above the level: counted in bid depth
      { price: 71500, btc: 0.5, bid: true },
      { price: 70500, btc: 1, bid: true },   // below the level: not yet reached
      { price: 70500, btc: 2, bid: false },  // below the level: counted in ask depth
      { price: 71200, btc: 0.25, bid: false },
      { price: 73000, btc: 8, bid: false },  // above the level: not yet reached
    ];
    const stats = priceLevelStats(offers, { low: 71000, high: 72000 }, {
      price: o => o.price,
      btc: o => o.btc,
      isBid: o => o.bid,
    });
    expect(stats.bids).toEqual({ count: 1, btc: 0.5, cumBtc: 4.5 });
    expect(stats.asks).toEqual({ count: 1, btc: 0.25, cumBtc: 2.25 });
  });

  it('matches a price against the half-open [low, high) band', () => {
    const level = { low: 71000, high: 72000 };
    expect(isPriceInLevel(71000, level)).toBe(true);
    expect(isPriceInLevel(71999.99, level)).toBe(true);
    expect(isPriceInLevel(72000, level)).toBe(false);
    expect(isPriceInLevel(70999.99, level)).toBe(false);
  });

  it('treats floating-point rounding of the same band as the same level', () => {
    const step = 0.1 + 0.2; // 0.30000000000000004
    const a = priceLevelAt(0.31, step);
    expect(isSamePriceLevel(a, { low: 0.3, high: 0.6 })).toBe(true);
    expect(isSamePriceLevel({ low: 71000, high: 72000 }, { low: 72000, high: 73000 })).toBe(false);
    // Same low edge but a different step (after zooming) is a different level.
    expect(isSamePriceLevel({ low: 71000, high: 72000 }, { low: 71000, high: 71500 })).toBe(false);
  });
});
