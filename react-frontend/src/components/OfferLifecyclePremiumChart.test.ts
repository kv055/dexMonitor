import { describe, expect, it } from 'vitest';
import {
  expandPanBounds,
  isDefaultWindow,
  isZoomedWindow,
  translateWindow,
} from './OfferLifecyclePremiumChart';

const bounds = { min: 0, max: 10 };

describe('expandPanBounds', () => {
  it('opens room past zero on both sides of a non-negative data range', () => {
    expect(expandPanBounds({ min: 0, max: 10 })).toEqual({ min: -10, max: 20 });
  });

  it('reaches negative values even when data sits above zero', () => {
    const pan = expandPanBounds({ min: 1.15, max: 1.25 });
    expect(pan.min).toBeLessThan(0);
    expect(pan.max).toBeGreaterThan(1.25);
  });
});

describe('translateWindow', () => {
  it('shifts a zoomed window without changing its span', () => {
    expect(translateWindow({ min: 2, max: 4 }, bounds, 3)).toEqual({ min: 5, max: 7 });
  });

  it('can cross below zero when the pan bounds allow it', () => {
    const pan = expandPanBounds(bounds);
    expect(translateWindow({ min: 0, max: 4 }, pan, -6)).toEqual({ min: -6, max: -2 });
  });

  it('clamps against the expanded left edge without shrinking the span', () => {
    const pan = expandPanBounds(bounds);
    expect(translateWindow({ min: 2, max: 5 }, pan, -40)).toEqual({ min: -10, max: -7 });
  });

  it('clamps against the expanded right edge without shrinking the span', () => {
    const pan = expandPanBounds(bounds);
    expect(translateWindow({ min: 6, max: 9 }, pan, 40)).toEqual({ min: 17, max: 20 });
  });
});

describe('isZoomedWindow', () => {
  it('treats a full-range window as not zoomed', () => {
    expect(isZoomedWindow(bounds, bounds)).toBe(false);
  });

  it('treats a narrower window as zoomed', () => {
    expect(isZoomedWindow({ min: 2, max: 4 }, bounds)).toBe(true);
  });
});

describe('isDefaultWindow', () => {
  it('accepts the data-fit window', () => {
    expect(isDefaultWindow(bounds, bounds)).toBe(true);
  });

  it('rejects a window panned into negatives', () => {
    expect(isDefaultWindow({ min: -2, max: 8 }, bounds)).toBe(false);
  });
});
