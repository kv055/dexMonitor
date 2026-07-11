import { memo, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { toUtcSec } from '../utils/formatters';
import { shiftOhlcCandlesForTimezone, shiftUtcSecForTimezone } from '../utils/ohlcTimezone';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { LifecyclePoint, Offer, OHLCCandle, OHLCData } from '../types';
import { useFilters } from '../hooks/useFilters';
import { usePreferences } from '../hooks/usePreferences';
import { getFirstSeen, getLastSeen, getOfferPrice, getPremiumMetricValue, isOfferLive } from '../utils/offerAccess';
import { useTimezone } from '../hooks/useTimezone';
import { LoadingSpinner } from './LoadingSpinner';
import { buildOfferKeys, buildStableOfferKey } from '../utils/offerIdentity';
import { exchangeColor } from '../utils/exchangeColors';
import { apiFetch } from '../utils/api';

interface Props {
  data: OHLCData | null;
  loadedHours: number;
  onNeedMoreData: (newHours: number, intervalMin?: number) => void;
  allowExtend?: boolean;
  /**
   * Offers plotted in addition to the FiltersContext set — e.g. the Insights
   * tab's past profitable orders. Deduped against the context offers by id
   * and subject to the same premium and chart-visibility guards.
   */
  extraOffers?: Offer[];
  /**
   * When false, the FiltersContext offers are not plotted and only
   * extraOffers appear — the Insights tab's Past mode, where live offer
   * overlays would obscure the past orders under inspection.
   */
  includeContextOffers?: boolean;
  /**
   * Auto-fit the x-axis to the plotted offers whenever the offer source
   * (includeContextOffers) flips: the window spans the oldest offer's start
   * to the latest closure (or "now" for live offers), and the candle size is
   * re-picked to keep roughly TARGET_VISIBLE_CANDLES on screen.
   */
  fitToOffers?: boolean;
}

type PendingVisibleRange = {
  range: { from: UTCTimestamp; to: UTCTimestamp };
  intervalMin: number;
  visibleHours: number;
};

type LifecycleCacheEntry = { points: LifecyclePoint[]; fetchedAt: number };

// Live offers gain one lifecycle point per snapshot cycle (~1 min), so their
// cached history must be refreshed; closed offers' history is immutable.
const LIVE_LIFECYCLE_REFRESH_MS = 60_000;

// Offer lines are re-synced at most this often. Live offers arrive on every
// CEX price tick over the WebSocket, which can be several times per second —
// without this the offer layer would churn constantly.
const OFFER_RENDER_THROTTLE_MS = 1_000;

function lifecycleUrl(offer: { id: number }, live: boolean): string {
  return live
    ? `/api/live_offers/${offer.id}/lifecycle`
    : `/api/past_offers/${offer.id}/lifecycle`;
}

// Candle size options in minutes — only multiples >= source interval are shown
const CANDLE_OPTIONS = [1, 5, 15, 30, 60, 240, 1440];
const CANDLE_LABELS: Record<number, string> = {
  1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d',
};
const TARGET_VISIBLE_CANDLES = 120;

// A connector between two lifecycle observations is treated as a DATA GAP —
// drawn dashed and muted rather than as a confident straight line — when it
// spans far more than the offer's own typical snapshot cadence. The factor is
// applied to the median spacing (so it adapts to 1m vs 4h buckets), with an
// absolute floor so ordinary sub-minute jitter never trips it.
const GAP_CADENCE_FACTOR = 2.5;
const MIN_GAP_SECONDS = 90;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Blend a line's color toward neutral grey (and drop its alpha a touch) so a
// gap connector still carries the line's identity but clearly reads as
// "uncertain — we don't actually know the price here".
function weakenColor(color: string): string {
  const rgb = parseHexColor(color);
  if (!rgb) return 'rgba(139, 148, 158, 0.7)';
  const GREY = 145;
  const MIX = 0.62; // 0 = original color, 1 = fully grey
  const r = Math.round(rgb.r + (GREY - rgb.r) * MIX);
  const g = Math.round(rgb.g + (GREY - rgb.g) * MIX);
  const b = Math.round(rgb.b + (GREY - rgb.b) * MIX);
  return `rgba(${r}, ${g}, ${b}, 0.85)`;
}

// The offer's typical observation spacing × factor (with a floor). Connectors
// longer than this are missing-data gaps.
function gapThresholdSeconds(points: { utcSec?: number }[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].utcSec;
    const b = points[i].utcSec;
    if (a != null && b != null) deltas.push(b - a);
  }
  if (deltas.length === 0) return Infinity;
  deltas.sort((x, y) => x - y);
  const median = deltas[Math.floor(deltas.length / 2)];
  return Math.max(median * GAP_CADENCE_FACTOR, MIN_GAP_SECONDS);
}

function getNowUtcSec(): number {
  return Math.floor(Date.now() / 1000);
}

// Re-aggregate raw candles into larger buckets client-side
function aggregateOHLC(candles: OHLCCandle[], targetMin: number, sourceMin: number): OHLCCandle[] {
  if (targetMin <= sourceMin || candles.length === 0) return candles;
  const bucketSec = targetMin * 60;
  const buckets = new Map<number, OHLCCandle>();
  for (const c of candles) {
    const tSec = toUtcSec(c.time);
    const bStart = Math.floor(tSec / bucketSec) * bucketSec;
    const existing = buckets.get(bStart);
    if (!existing) {
      // Use an ISO-like string so toUtcSec can parse it later
      const isoTime = new Date(bStart * 1000).toISOString().replace('.000Z', 'Z');
      buckets.set(bStart, { time: isoTime, open: c.open, high: c.high, low: c.low, close: c.close });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => toUtcSec(a.time) - toUtcSec(b.time));
}

function requiredHoursForCandleSize(candleMin: number): number {
  return Math.ceil((candleMin * TARGET_VISIBLE_CANDLES) / 60);
}

/**
 * The chart instance is created ONCE (per theme) and mutated incrementally:
 * candles via candleSeries.setData, offers by swapping only the line series.
 * Live offers arrive on every CEX price tick, so rebuilding the whole chart
 * per update — the previous design — reset the user's pan/zoom continuously
 * and burned CPU on full canvas teardowns.
 */
function OHLCChartInner({ data, loadedHours, onNeedMoreData, allowExtend = true, extraOffers, includeContextOffers = true, fitToOffers = false }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const offerSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const seriesInfoRef = useRef<Map<ISeriesApi<'Line'>, { offerKey: string; price: number }>>(new Map());
  // display-time → UTC mapping for crosshair reporting; grows with data, never
  // cleared (entries are tiny and stay valid).
  const utcByDisplaySecRef = useRef<Map<number, number>>(new Map());
  const intendedRangeRef = useRef<PendingVisibleRange | null>(null);
  const fetchingMoreRef = useRef(false);
  const earliestCandleTimeRef = useRef<number | null>(null);
  // Which default window ([hours, timezone]) has been applied; '' = none yet.
  const appliedWindowRef = useRef('');
  // Whether the candle series has ever held data on the current chart. A
  // default range applied while only offer bars existed gets clamped by the
  // library, so the first real candle batch must re-apply it.
  const hadCandlesRef = useRef(false);

  const { filteredOffers, filters: { hours, premiumMode }, selectedOfferKey, setSelectedOfferKey, setHoveredOhlcTime, loading, hiddenChartOfferKeys } = useFilters();
  const { theme } = usePreferences();

  // Chart guard: only offers with a positive premium are plotted, and only
  // offers left ticked in the table's chart-visibility checkboxes. The
  // "Incl. non premium offers" filter may let non-premium offers into the
  // table, but they must never reach the overlay.
  const premiumOffers = useMemo(() => {
    const isPlottable = (o: Offer) =>
      (getPremiumMetricValue(o, premiumMode) ?? 0) > 0 && !hiddenChartOfferKeys.has(buildStableOfferKey(o));
    const base = includeContextOffers ? filteredOffers.filter(isPlottable) : [];
    if (!extraOffers || extraOffers.length === 0) return base;
    const seenIds = new Set(base.map((o) => o.id));
    return [...base, ...extraOffers.filter((o) => !seenIds.has(o.id) && isPlottable(o))];
  }, [includeContextOffers, filteredOffers, premiumMode, hiddenChartOfferKeys, extraOffers]);
  const { timezone } = useTimezone();
  const [lifecycleCache, setLifecycleCache] = useState<Record<number, LifecycleCacheEntry>>({});
  const lifecycleLoadingRef = useRef<Set<number>>(new Set());

  const sourceIntervalMin = data?.interval_min ?? 1;
  const loadedDataHours = useMemo(() => {
    const candles = data?.candles;
    if (!candles || candles.length < 2) return loadedHours;
    const first = toUtcSec(candles[0].time);
    const last = toUtcSec(candles[candles.length - 1].time);
    if (!first || !last || last <= first) return loadedHours;
    return Math.ceil((last - first) / 3600 + sourceIntervalMin / 60);
  }, [data?.candles, loadedHours, sourceIntervalMin]);
  const availableHours = Math.max(loadedHours, loadedDataHours);

  // Candle size selector — default always tracks source interval
  const [candleMin, setCandleMin] = useState<number>(sourceIntervalMin);

  // Sync default whenever the source interval changes (e.g. after a full reload)
  useEffect(() => {
    setCandleMin(sourceIntervalMin);
  }, [sourceIntervalMin]);

  const requiredHours = useMemo(() => requiredHoursForCandleSize(candleMin), [candleMin]);
  const effectiveVisibleHours = Math.max(Number(hours), requiredHours);

  // Mount-scoped chart handlers read reactive values through refs so the
  // chart itself never has to be re-created when they change.
  const selectedOfferKeyRef = useRef(selectedOfferKey);
  const candleMinRef = useRef(candleMin);
  const availableHoursRef = useRef(availableHours);
  const requiredHoursRef = useRef(requiredHours);
  const allowExtendRef = useRef(allowExtend);
  const onNeedMoreDataRef = useRef(onNeedMoreData);
  const effectiveVisibleHoursRef = useRef(effectiveVisibleHours);
  const timezoneRef = useRef(timezone);
  useEffect(() => {
    selectedOfferKeyRef.current = selectedOfferKey;
    candleMinRef.current = candleMin;
    availableHoursRef.current = availableHours;
    requiredHoursRef.current = requiredHours;
    allowExtendRef.current = allowExtend;
    onNeedMoreDataRef.current = onNeedMoreData;
    effectiveVisibleHoursRef.current = effectiveVisibleHours;
    timezoneRef.current = timezone;
  });

  // "Reset view" appears once the view deviates from the default window
  // (pan/zoom on either axis) and restores it.
  const [showReset, setShowReset] = useState(false);

  const handleCandleMinChange = (nextCandleMin: number) => {
    const nextRequiredHours = requiredHoursForCandleSize(nextCandleMin);
    const nextVisibleHours = Math.max(Number(hours), nextRequiredHours);
    const nowUtcSec = getNowUtcSec();
    intendedRangeRef.current = {
      intervalMin: nextCandleMin,
      visibleHours: nextVisibleHours,
      range: {
        from: shiftUtcSecForTimezone(nowUtcSec - nextVisibleHours * 3600, timezone) as UTCTimestamp,
        to: shiftUtcSecForTimezone(nowUtcSec, timezone) as UTCTimestamp,
      },
    };
    setCandleMin(nextCandleMin);
    if (allowExtend && (nextCandleMin < sourceIntervalMin || nextRequiredHours > availableHours)) {
      onNeedMoreData(nextVisibleHours, nextCandleMin);
    }
  };

  // Aggregated candles for the chosen size
  const displayCandles = useMemo(() => {
    if (!data?.candles?.length) return [];
    return aggregateOHLC(data.candles, candleMin, sourceIntervalMin);
  }, [data?.candles, candleMin, sourceIntervalMin]);

  const shiftedDisplay = useMemo(
    () => shiftOhlcCandlesForTimezone(displayCandles, timezone),
    [displayCandles, timezone]
  );
  const offerKeys = useMemo(() => buildOfferKeys(premiumOffers), [premiumOffers]);

  useEffect(() => {
    async function loadMissingLifecycles() {
      const now = Date.now();
      const needed = premiumOffers.filter((offer) => {
        if (offer.lifecycle || lifecycleLoadingRef.current.has(offer.id)) return false;
        const cached = lifecycleCache[offer.id];
        if (cached == null) return true;
        return isOfferLive(offer) && now - cached.fetchedAt > LIVE_LIFECYCLE_REFRESH_MS;
      });

      if (needed.length === 0) return;

      const toFetch = needed.slice(0, 12);
      toFetch.forEach((offer) => lifecycleLoadingRef.current.add(offer.id));

      const results = await Promise.allSettled(
        toFetch.map(async (offer) => ({
          id: offer.id,
          points: await apiFetch<LifecyclePoint[]>(lifecycleUrl(offer, isOfferLive(offer))),
        }))
      );

      // Release the in-flight guard and commit results even if the effect was
      // re-run mid-fetch (offer identities change often, e.g. while the
      // Insights analytics phases stream in): the fetched points are valid
      // regardless, and bailing out before this cleanup used to leave the ids
      // marked as loading forever — permanently stuck on fallback markers.
      toFetch.forEach((offer) => lifecycleLoadingRef.current.delete(offer.id));

      setLifecycleCache((prev) => {
        const fulfilled = results.filter(
          (r): r is PromiseFulfilledResult<{ id: number; points: LifecyclePoint[] }> =>
            r.status === 'fulfilled'
        );
        // Returning the same reference when nothing was fetched avoids
        // re-triggering this effect in a loop while an endpoint is failing.
        if (fulfilled.length === 0) return prev;
        const next = { ...prev };
        const fetchedAt = Date.now();
        for (const result of fulfilled) {
          next[result.value.id] = { points: result.value.points, fetchedAt };
        }
        return next;
      });
    }

    void loadMissingLifecycles();
  }, [premiumOffers, lifecycleCache]);

  // Keep chart sized to container
  useEffect(() => {
    if (!divRef.current) return;
    const ro = new ResizeObserver(() => {
      if (divRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: divRef.current.clientWidth,
          height: divRef.current.clientHeight,
        });
      }
    });
    ro.observe(divRef.current);
    return () => ro.disconnect();
  }, []);

  const applyDefaultRange = useCallback((chart: IChartApi) => {
    const nowUtcSec = getNowUtcSec();
    const from = shiftUtcSecForTimezone(nowUtcSec - effectiveVisibleHours * 3600, timezone) as UTCTimestamp;
    const to = shiftUtcSecForTimezone(nowUtcSec, timezone) as UTCTimestamp;
    try {
      chart.timeScale().setVisibleRange({ from, to });
    } catch {
      try { chart.timeScale().fitContent(); } catch { /* no data yet */ }
    }
    appliedWindowRef.current = `${effectiveVisibleHours}|${timezone}`;
  }, [effectiveVisibleHours, timezone]);

  const resetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // Manual y-axis zoom turns autoScale off; a reset must undo that too.
    chart.priceScale('right').applyOptions({ autoScale: true });
    applyDefaultRange(chart);
    setShowReset(false);
  }, [applyDefaultRange]);

  // ── Fit-to-offers (Insights) ───────────────────────────────────────────────
  // Sizes the x-axis to the plotted offers: oldest first_seen → latest
  // last_seen (live offers count as still open, so their end is "now"), then
  // picks the smallest candle size that keeps the span within the visible
  // candle budget. Data outside the loaded window is requested first and the
  // range applied by the candle-sync effect once it lands (intendedRangeRef).
  // Returns false when the fit must be retried later — setting a visible
  // range on a chart with NO series data poisons lightweight-charts' time
  // scale (every later internal update throws "Value is null"), so the fit
  // only runs once candles or offer lines exist.
  const fitRangeToOffers = useCallback((): boolean => {
    const chart = chartRef.current;
    if (!chart) return false;
    if (!hadCandlesRef.current && offerSeriesRef.current.length === 0) return false;
    const nowUtcSec = getNowUtcSec();

    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const o of premiumOffers) {
      const start = toUtcSec(getFirstSeen(o) ?? '');
      const end = isOfferLive(o) ? nowUtcSec : (toUtcSec(getLastSeen(o) ?? '') || start);
      if (start) minStart = Math.min(minStart, start);
      if (end) maxEnd = Math.max(maxEnd, end);
    }
    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) {
      applyDefaultRange(chart);
      return true;
    }

    // Pad the span so the outermost offer endpoints don't sit on the chart edge.
    const pad = Math.max((maxEnd - minStart) * 0.05, 5 * 60);
    const fromUtc = minStart - pad;
    const toUtc = Math.min(maxEnd + pad, nowUtcSec);
    const spanMin = (toUtc - fromUtc) / 60;
    const targetCandleMin = CANDLE_OPTIONS.find(opt => spanMin / opt <= TARGET_VISIBLE_CANDLES)
      ?? CANDLE_OPTIONS[CANDLE_OPTIONS.length - 1];
    // Candles load backwards from "now", so coverage is measured from there
    // even when the offer span ends in the past.
    const visibleHours = Math.ceil((nowUtcSec - fromUtc) / 3600);
    const range = {
      from: shiftUtcSecForTimezone(fromUtc, timezone) as UTCTimestamp,
      to: shiftUtcSecForTimezone(toUtc, timezone) as UTCTimestamp,
    };

    const needsFetch = allowExtend && (targetCandleMin < sourceIntervalMin || visibleHours > availableHours);
    if (targetCandleMin !== candleMin || needsFetch) {
      intendedRangeRef.current = { intervalMin: targetCandleMin, visibleHours, range };
      setCandleMin(targetCandleMin);
      if (needsFetch) onNeedMoreData(visibleHours, targetCandleMin);
    } else {
      try {
        chart.timeScale().setVisibleRange(range);
        // Stamp the window as applied so the candle-sync effect keeps this
        // range (via prevRange) instead of resetting to the default window.
        appliedWindowRef.current = `${effectiveVisibleHours}|${timezone}`;
      } catch {
        applyDefaultRange(chart);
      }
    }
    return true;
  }, [premiumOffers, timezone, sourceIntervalMin, availableHours, candleMin, effectiveVisibleHours, allowExtend, onNeedMoreData, applyDefaultRange]);

  const fitRangeToOffersRef = useRef(fitRangeToOffers);
  useEffect(() => {
    fitRangeToOffersRef.current = fitRangeToOffers;
  });

  // ── Chart lifetime (once per theme) ────────────────────────────────────────
  // Bumped after (re)creating the chart so the data-sync effects below re-run
  // against the fresh instance.
  const [chartEpoch, setChartEpoch] = useState(0);

  useEffect(() => {
    const container = divRef.current;
    if (!container) return;

    const text = cssVar('--app-muted', '#8b949e');
    const grid = cssVar('--app-grid', '#21262d');

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'rgba(0, 0, 0, 0)' },
        textColor: text,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        borderColor: grid,
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: grid,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chartRef.current = chart;
    // e2e observability: how often the chart has been torn down and rebuilt.
    // Interactions (pan/zoom) only survive when this stays constant.
    container.dataset.chartInstances = String(Number(container.dataset.chartInstances ?? 0) + 1);
    appliedWindowRef.current = '';

    // Created here (before any offer line) so candles stay below offer paths.
    candleSeriesRef.current = chart.addCandlestickSeries({
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });

    // True when the price scale was manually zoomed (drag on the y-axis
    // disables autoScale). There is no LWC event for it, so it's sampled from
    // the interaction events below.
    const isPriceScaleZoomed = () => chart.priceScale('right').options().autoScale === false;

    // --- Auto-fetch when scrolling back to the start ---
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) return;
      if (divRef.current) divRef.current.dataset.visibleRange = JSON.stringify(range);

      // Offer the reset button once the view left the default window by more
      // than 5% (small drifts from live updates and edge rounding to the bar
      // grid must not count — the reported range snaps to existing bars).
      const nowUtcSec = getNowUtcSec();
      const windowSec = effectiveVisibleHoursRef.current * 3600;
      const defFrom = shiftUtcSecForTimezone(nowUtcSec - windowSec, timezoneRef.current);
      const defTo = shiftUtcSecForTimezone(nowUtcSec, timezoneRef.current);
      const tolerance = Math.max(candleMinRef.current * 60 * 3, windowSec * 0.05);
      const deviates = Math.abs((range.from as number) - defFrom) > tolerance ||
        Math.abs((range.to as number) - defTo) > tolerance;
      setShowReset(deviates || isPriceScaleZoomed());

      if (!allowExtendRef.current || fetchingMoreRef.current) return;
      const earliest = earliestCandleTimeRef.current;
      if (!earliest) return;
      // Trigger when the left edge of the view is within 2 candle-widths of the earliest data
      const triggerThreshold = earliest + candleMinRef.current * 60 * 2;
      if ((range.from as number) <= triggerThreshold) {
        fetchingMoreRef.current = true;
        const newHours = Math.max(availableHoursRef.current * 3, requiredHoursRef.current * 2);
        onNeedMoreDataRef.current(newHours, candleMinRef.current);
        // Reset the guard after a cooldown so rapid scrolling doesn't spam requests
        setTimeout(() => { fetchingMoreRef.current = false; }, 10_000);
      }
    });

    // Crosshair move
    chart.subscribeCrosshairMove((param) => {
      // A pure y-axis drag never fires a time-range change, but the next mouse
      // move does land here — catch manual price zoom this way.
      if (isPriceScaleZoomed()) setShowReset(true);
      if (param.time === undefined) {
        setHoveredOhlcTime(null);
        return;
      }
      const shiftedSec = param.time as number;
      setHoveredOhlcTime(utcByDisplaySecRef.current.get(shiftedSec) ?? shiftedSec);
    });

    // Click handler — select the offer line nearest to the click
    chart.subscribeClick((param) => {
      if (!param.point) {
        setSelectedOfferKey(null);
        return;
      }
      const clickY = param.point.y;
      let closestKey: string | null = null;
      let closestDist = Infinity;

      for (const [series, info] of seriesInfoRef.current) {
        const coord = series.priceToCoordinate(info.price);
        if (coord == null) continue;
        const dist = Math.abs(coord - clickY);
        if (dist < closestDist && dist < 12) {
          closestDist = dist;
          closestKey = info.offerKey;
        }
      }

      setSelectedOfferKey(closestKey != null
        ? (closestKey === selectedOfferKeyRef.current ? null : closestKey)
        : null
      );
    });

    setChartEpoch((e) => e + 1);

    const seriesInfo = seriesInfoRef.current;
    return () => {
      setHoveredOhlcTime(null);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      offerSeriesRef.current = [];
      seriesInfo.clear();
      earliestCandleTimeRef.current = null;
      hadCandlesRef.current = false;
    };
  }, [theme, setHoveredOhlcTime, setSelectedOfferKey]);

  // ── Candle sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    shiftedDisplay.utcByShiftedSec.forEach((utc, disp) => utcByDisplaySecRef.current.set(disp, utc));

    if (shiftedDisplay.candles.length === 0) {
      earliestCandleTimeRef.current = null;
      return;
    }

    // Preserve the user's current view across data swaps: setData shifts
    // logical indices when history is prepended, so restore by TIME range.
    const prevRange = chart.timeScale().getVisibleRange();

    candleSeries.setData(
      shiftedDisplay.candles.map(c => ({
        time: toUtcSec(c.time) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    earliestCandleTimeRef.current = toUtcSec(shiftedDisplay.candles[0].time);

    const firstCandles = !hadCandlesRef.current;
    hadCandlesRef.current = true;

    const windowKey = `${effectiveVisibleHours}|${timezone}`;
    const intendedRange = intendedRangeRef.current;
    const intendedRangeReady = intendedRange != null &&
      sourceIntervalMin <= intendedRange.intervalMin &&
      loadedDataHours >= intendedRange.visibleHours;
    if (intendedRangeReady) {
      try {
        chart.timeScale().setVisibleRange(intendedRange.range);
        appliedWindowRef.current = windowKey;
      } catch {
        applyDefaultRange(chart);
      }
      intendedRangeRef.current = null;
    } else if (appliedWindowRef.current !== windowKey || firstCandles) {
      // First candles, or the requested window (timeframe/timezone) changed.
      applyDefaultRange(chart);
    } else if (prevRange) {
      try { chart.timeScale().setVisibleRange(prevRange); } catch { /* keep whatever the chart chose */ }
    }
  }, [shiftedDisplay, chartEpoch, effectiveVisibleHours, timezone, sourceIntervalMin, loadedDataHours, applyDefaultRange]);

  // ── Offer line sync (throttled) ────────────────────────────────────────────
  const renderOffersRef = useRef<() => void>(() => {});
  const offerCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerDirtyRef = useRef(false);

  useEffect(() => () => {
    // Fully reset the throttle on unmount: a dangling non-null cooldown ref
    // would deadlock all offer renders after a remount (e.g. StrictMode).
    if (offerCooldownRef.current) {
      clearTimeout(offerCooldownRef.current);
      offerCooldownRef.current = null;
    }
    offerDirtyRef.current = false;
  }, []);

  useEffect(() => {
    renderOffersRef.current = () => {
      const chart = chartRef.current;
      const container = divRef.current;
      if (!chart || !container) return;

      // Swapping line series adds/removes slots on the shared time axis, and
      // the library preserves the LOGICAL range across that — which drifts the
      // visible time window a little on every render. Capture and restore the
      // time range around the swap (all synchronous, so no gesture is lost).
      const prevRange = chart.timeScale().getVisibleRange();

      for (const series of offerSeriesRef.current) {
        try { chart.removeSeries(series); } catch { /* chart already disposed */ }
      }
      offerSeriesRef.current = [];
      seriesInfoRef.current.clear();

      const selectedLine = cssVar('--app-text', '#e6edf3');
      const toDisplaySec = (utcSec: number): UTCTimestamp => {
        const displaySec = shiftUtcSecForTimezone(utcSec, timezone);
        utcByDisplaySecRef.current.set(displaySec, utcSec);
        return displaySec as UTCTimestamp;
      };
      const addLine = (options: Parameters<IChartApi['addLineSeries']>[0]) => {
        const series = chart.addLineSeries(options);
        offerSeriesRef.current.push(series);
        return series;
      };

      // All series share one time axis: off-grid offer timestamps would insert
      // extra slots BETWEEN candles and visibly spread them apart. Snap every
      // offer point to the active candle grid; the dedupe map below then keeps
      // the last (close) lifecycle point of each bucket.
      const bucketSec = candleMin * 60;
      const snapToGrid = (utcSec: number) => Math.floor(utcSec / bucketSec) * bucketSec;

      const nowUtcSec = getNowUtcSec();
      const nowSec = toDisplaySec(snapToGrid(nowUtcSec));

      // Per-offer render summary exposed on the container as data-offer-paths so
      // e2e tests can verify what was plotted (canvas pixels are opaque to them).
      const renderedPaths: Array<{ id: number; live: boolean; mode: 'lifecycle' | 'fallback' | 'none'; points: number; segments: number }> = [];

      premiumOffers.forEach((o, index) => {
        const offerKey = offerKeys[index];
        const isOpen = isOfferLive(o);
        const isSelected = offerKey === selectedOfferKey;
        const lineWidth = isSelected ? 3 : 2;
        const markerRadius = isSelected ? 5 : 3;
        const lifecycle = o.lifecycle ?? lifecycleCache[o.id]?.points;

        type TimeValue = { time: UTCTimestamp; value: number };
        const renderFallbackLine = () => {
          // No usable lifecycle in the current view: show the offer at its known endpoint.
          const anchorUtc = isOpen ? nowUtcSec : toUtcSec(getLastSeen(o) ?? getFirstSeen(o) ?? '');
          if (!anchorUtc) {
            renderedPaths.push({ id: o.id, live: isOpen, mode: 'none', points: 0, segments: 0 });
            return;
          }
          const anchor = toDisplaySec(snapToGrid(anchorUtc));
          const start = toDisplaySec(snapToGrid(anchorUtc) - bucketSec);
          const points: TimeValue[] = [
            { time: start, value: getOfferPrice(o) },
            { time: anchor, value: getOfferPrice(o) },
          ];
          const color = isSelected ? selectedLine : exchangeColor(o.exchange);
          const series = addLine({
            color,
            lineWidth,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: markerRadius,
          });
          series.setData(points);
          seriesInfoRef.current.set(series, { offerKey, price: getOfferPrice(o) });
          renderedPaths.push({ id: o.id, live: isOpen, mode: 'fallback', points: points.length, segments: 1 });
        };

        if (lifecycle && lifecycle.length > 0) {
          // Lifecycle line: render the full known history, including points outside
          // the initial visible range so scrolling can reveal the whole order path.
          type LcPoint = { time: UTCTimestamp; value: number; color: string; utcSec?: number; gapBefore?: boolean };
          const lcPointsRaw: LcPoint[] = lifecycle.flatMap((p) => {
            const utcSec = toUtcSec(p.time);
            if (!utcSec) return [];
            return [{
              time: toDisplaySec(snapToGrid(utcSec)),
              utcSec,
              value: p.price,
              color: isSelected ? selectedLine : exchangeColor(o.exchange),
            }];
          });
          // Deduplicate by timestamp (keep last), then sort ascending.
          const lcByTime = new Map<number, LcPoint>();
          for (const pt of lcPointsRaw) lcByTime.set(pt.time, pt);
          const lcPoints = Array.from(lcByTime.values()).sort((a, b) => a.time - b.time);
          if (lcPoints.length === 0) {
            renderFallbackLine();
            return;
          }

          // Flag connectors that jump across a data gap: between two such
          // observations we don't actually know the price, so that stretch must
          // be drawn as an uncertain (dashed, muted) line instead of a straight
          // interpolation. Computed on the real observations only — the synthetic
          // first-seen / now / last-seen anchors added below stay solid.
          const gapThreshold = gapThresholdSeconds(lcPoints);
          for (let i = 1; i < lcPoints.length; i++) {
            const prev = lcPoints[i - 1].utcSec;
            const curr = lcPoints[i].utcSec;
            if (prev != null && curr != null && curr - prev > gapThreshold) {
              lcPoints[i].gapBefore = true;
            }
          }

          const firstSeenUtc = toUtcSec(getFirstSeen(o) ?? '');
          const lastSeenUtc = toUtcSec(getLastSeen(o) ?? '');
          if (firstSeenUtc) {
            const firstSeenDisplay = toDisplaySec(snapToGrid(firstSeenUtc));
            if (firstSeenDisplay < lcPoints[0].time) {
              lcPoints.unshift({ ...lcPoints[0], time: firstSeenDisplay });
            }
          }
          if (isOpen) {
            // Extend to "now" with the offer's CURRENT price: lifecycle snapshots
            // lag up to a cycle behind the live feed, so the tip must come from
            // the offer itself for the path to end at the price shown elsewhere.
            const last = lcPoints[lcPoints.length - 1];
            if (last.time < nowSec) {
              lcPoints.push({
                time: nowSec,
                value: getOfferPrice(o),
                color: isSelected ? selectedLine : exchangeColor(o.exchange),
              });
            }
          } else if (lastSeenUtc) {
            const lastSeenDisplay = toDisplaySec(snapToGrid(lastSeenUtc));
            const last = lcPoints[lcPoints.length - 1];
            if (lastSeenDisplay > last.time) {
              lcPoints.push({ time: lastSeenDisplay, value: getOfferPrice(o), color: last.color });
            }
          }
          if (lcPoints.length < 2) {
            renderFallbackLine();
            return;
          }

          const representativePrice = lcPoints[Math.floor(lcPoints.length / 2)].value;

          // Group into contiguous runs sharing BOTH color and gap-state. A gap
          // connector is drawn dashed in a muted color; the real segments on
          // either side stay solid and fully colored. (Color can still vary if a
          // future change reintroduces per-point coloring — this handles both.)
          type Segment = { points: TimeValue[]; color: string; isGap: boolean };
          const segments: Segment[] = [];
          for (let i = 1; i < lcPoints.length; i++) {
            const a = lcPoints[i - 1];
            const b = lcPoints[i];
            const isGap = b.gapBefore === true;
            const color = isGap ? weakenColor(a.color) : a.color;
            const from = { time: a.time, value: a.value };
            const to = { time: b.time, value: b.value };
            const last = segments[segments.length - 1];
            const lastPt = last?.points[last.points.length - 1];
            if (last && last.isGap === isGap && last.color === color &&
                lastPt && lastPt.time === from.time && lastPt.value === from.value) {
              last.points.push(to);
            } else {
              segments.push({ points: [from, to], color, isGap });
            }
          }

          let clickTargetRegistered = false;
          let drawnSegments = 0;
          for (const { points: segPts, color, isGap } of segments) {
            if (segPts.length < 2) continue;
            const series = addLine({
              color,
              lineWidth,
              lineStyle: isGap ? LineStyle.Dashed : LineStyle.Solid,
              priceLineVisible: false,
              lastValueVisible: false,
              // Gap stretches are uncertain, so don't invite hovering their points.
              crosshairMarkerVisible: !isGap,
              crosshairMarkerRadius: markerRadius,
            });
            series.setData(segPts);
            drawnSegments++;
            if (!clickTargetRegistered) {
              seriesInfoRef.current.set(series, { offerKey, price: representativePrice });
              clickTargetRegistered = true;
            }
          }
          renderedPaths.push({ id: o.id, live: isOpen, mode: 'lifecycle', points: lcPoints.length, segments: drawnSegments });
        } else {
          renderFallbackLine();
        }
      });

      container.dataset.offerPaths = JSON.stringify(renderedPaths);

      if (appliedWindowRef.current === '' && renderedPaths.length > 0) {
        // Offers-only view (no candles loaded yet): a window must still be applied once.
        applyDefaultRange(chart);
      } else if (prevRange) {
        try { chart.timeScale().setVisibleRange(prevRange); } catch { /* keep whatever the chart chose */ }
      }
    };
  }, [premiumOffers, offerKeys, lifecycleCache, selectedOfferKey, candleMin, timezone, applyDefaultRange]);

  // Leading render immediately, then at most one trailing render per cooldown
  // window while updates keep streaming in.
  const scheduleOfferRender = useCallback(() => {
    if (offerCooldownRef.current) {
      offerDirtyRef.current = true;
      return;
    }
    renderOffersRef.current();
    offerCooldownRef.current = setTimeout(function onCooldown() {
      offerCooldownRef.current = null;
      if (offerDirtyRef.current) {
        offerDirtyRef.current = false;
        renderOffersRef.current();
        offerCooldownRef.current = setTimeout(onCooldown, OFFER_RENDER_THROTTLE_MS);
      }
    }, OFFER_RENDER_THROTTLE_MS);
  }, []);

  useEffect(() => {
    scheduleOfferRender();
  }, [premiumOffers, offerKeys, lifecycleCache, selectedOfferKey, candleMin, timezone, chartEpoch, scheduleOfferRender]);

  // ── Fit-to-offers trigger ──────────────────────────────────────────────────
  // Runs AFTER the candle-sync and offer-render effects so a fit is never
  // overridden by the default-window application and the chart already holds
  // series data. Fits on every offer-source flip (Live ⇄ Past), on the first
  // offers/candles of the current source (Past orders and OHLC data often
  // stream in after the switch), and after a chart re-creation. A fit that
  // can't run yet (chart still empty) is left pending and retried on the next
  // data change instead of being consumed.
  const lastFitSourceRef = useRef<boolean | null>(null);
  const lastFitHadOffersRef = useRef(false);
  const lastFitHadCandlesRef = useRef(false);
  const lastFitEpochRef = useRef(0);
  useEffect(() => {
    if (!fitToOffers) return;
    const sourceChanged = lastFitSourceRef.current !== includeContextOffers;
    const offersArrived = !lastFitHadOffersRef.current && premiumOffers.length > 0;
    const candlesArrived = !lastFitHadCandlesRef.current && shiftedDisplay.candles.length > 0;
    const chartRecreated = lastFitEpochRef.current !== chartEpoch;
    if (!sourceChanged && !offersArrived && !candlesArrived && !chartRecreated) return;
    if (!fitRangeToOffersRef.current()) return;
    lastFitSourceRef.current = includeContextOffers;
    lastFitHadOffersRef.current = premiumOffers.length > 0;
    lastFitHadCandlesRef.current = shiftedDisplay.candles.length > 0;
    lastFitEpochRef.current = chartEpoch;
  }, [fitToOffers, includeContextOffers, premiumOffers, shiftedDisplay, chartEpoch]);

  return (
    <div className="relative h-full bg-bg flex flex-col">
      {/* Candle size selector */}
      <div className="flex items-center gap-1 px-1 pb-1 shrink-0">
        <span className="text-[0.6rem] text-muted uppercase tracking-wider mr-1">Candle</span>
        {CANDLE_OPTIONS.map(opt => (
          <button
            key={opt}
            onClick={() => handleCandleMinChange(opt)}
            className={`text-[0.65rem] px-1.5 py-0.5 rounded transition-colors ${
              candleMin === opt
                ? 'bg-accent text-bg font-semibold'
                : 'text-muted hover:text-text'
            }`}
          >
            {CANDLE_LABELS[opt] ?? `${opt}m`}
          </button>
        ))}
      </div>

      {loading && <LoadingSpinner size={120} label="Loading chart data" />}
      <div
        className="relative flex-1 min-h-0"
        style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.35s ease' }}
      >
        <div ref={divRef} className="h-full w-full" />
        {showReset && (
          <button
            onClick={resetView}
            title="Reset chart view"
            className="absolute top-1.5 right-16 z-10 bg-surface/90 border border-border rounded-md px-2 py-0.5 text-[0.68rem] text-muted hover:text-text hover:border-muted transition-colors"
          >
            ⟲ Reset view
          </button>
        )}
      </div>
    </div>
  );
}

export const OHLCChart = memo(OHLCChartInner);
