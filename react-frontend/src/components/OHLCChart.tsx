import { memo, useEffect, useRef, useState, useMemo } from 'react';
import { toUtcSec } from '../utils/formatters';
import { shiftOhlcCandlesForTimezone } from '../utils/ohlcTimezone';
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { OHLCCandle, OHLCData } from '../types';
import { useFilters } from '../context/FiltersContext';
import { useTimezone } from '../context/TimezoneContext';
import { LoadingSpinner } from './LoadingSpinner';
import { buildOfferKeys } from '../utils/offerIdentity';

interface Props {
  data: OHLCData | null;
  loadedHours: number;
  onNeedMoreData: (newHours: number) => void;
}

const DIR_COLORS = {
  bid_premium:  '#00d4ff',
  bid_discount: '#0369a1',
  ask_premium:  '#f472b6',
  ask_discount: '#86198f',
} as const;

function offerColor(direction: string, netPremiumPct: number | null | undefined): string {
  const isBid = direction === 'buy';
  const isPremium = netPremiumPct != null && netPremiumPct > 0;
  if (isBid) return isPremium ? DIR_COLORS.bid_premium : DIR_COLORS.bid_discount;
  return isPremium ? DIR_COLORS.ask_premium : DIR_COLORS.ask_discount;
}

// Candle size options in minutes — only multiples >= source interval are shown
const CANDLE_OPTIONS = [1, 5, 15, 30, 60, 240, 1440];
const CANDLE_LABELS: Record<number, string> = {
  1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d',
};

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
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

function OHLCChartInner({ data, loadedHours, onNeedMoreData }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const savedRangeRef = useRef<{ from: UTCTimestamp; to: UTCTimestamp } | null>(null);
  const fetchingMoreRef = useRef(false);

  const { filteredOffers: premiumOffers, filters: { hours }, selectedOfferKey, setSelectedOfferKey, setHoveredOhlcTime, loading } = useFilters();
  const { timezone } = useTimezone();

  const sourceIntervalMin = data?.interval_min ?? 1;

  // Candle size selector — default always tracks source interval
  const [candleMin, setCandleMin] = useState<number>(sourceIntervalMin);

  // Sync default whenever the source interval changes (e.g. after a full reload)
  useEffect(() => {
    setCandleMin(sourceIntervalMin);
  }, [sourceIntervalMin]);

  const visibleOptions = useMemo(
    () => CANDLE_OPTIONS.filter(o => o >= sourceIntervalMin),
    [sourceIntervalMin]
  );

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

  useEffect(() => {
    if (!divRef.current) return;

    chartRef.current?.remove();
    const text = cssVar('--app-muted', '#8b949e');
    const grid = cssVar('--app-grid', '#21262d');
    const selectedLine = cssVar('--app-text', '#e6edf3');

    const chart = createChart(divRef.current, {
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
      width: divRef.current.clientWidth,
      height: divRef.current.clientHeight,
    });
    chartRef.current = chart;

    // --- Candlestick series ---
    if (shiftedDisplay.candles.length > 0) {
      const candleSeries = chart.addCandlestickSeries({
        upColor: '#3fb950',
        downColor: '#f85149',
        borderUpColor: '#3fb950',
        borderDownColor: '#f85149',
        wickUpColor: '#3fb950',
        wickDownColor: '#f85149',
      });
      candleSeries.setData(
        shiftedDisplay.candles.map(c => ({
          time: toUtcSec(c.time) as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    }

    const nowSec = Math.floor(Date.now() / 1000) as UTCTimestamp;
    const fromSec = (nowSec - Number(hours) * 3600) as UTCTimestamp;

    // --- Offer lines ---
    const seriesInfo = new Map<ISeriesApi<'Line'>, { offerKey: string; price: number }>();

    premiumOffers.forEach((o, index) => {
      const offerKey = offerKeys[index];
      const isOpen = o.is_live;
      const isSelected = offerKey === selectedOfferKey;
      const lineWidth = isSelected ? 3 : 2;
      const markerRadius = isSelected ? 5 : 3;

      type TimeValue = { time: UTCTimestamp; value: number };

      if (o.lifecycle && o.lifecycle.length >= 2) {
        // Multi-point line: split into colored segments by premium state at each point.
        const lcPointsRaw = o.lifecycle.map((p) => ({
          time: toUtcSec(p.time) as UTCTimestamp,
          value: p.price,
          color: isSelected ? selectedLine : offerColor(o.direction, p.net_premium_pct),
        }));
        // Deduplicate by timestamp (keep last), then sort ascending.
        const lcByTime = new Map<number, typeof lcPointsRaw[0]>();
        for (const pt of lcPointsRaw) lcByTime.set(pt.time, pt);
        const lcPoints = Array.from(lcByTime.values()).sort((a, b) => a.time - b.time);
        if (isOpen) {
          const last = lcPoints[lcPoints.length - 1];
          lcPoints.push({ ...last, time: nowSec });
        }

        const representativePrice = lcPoints[Math.floor(lcPoints.length / 2)].value;

        // Group into contiguous segments of the same color.
        type Segment = { points: TimeValue[]; color: string };
        const segments: Segment[] = [];
        let seg: TimeValue[] = [{ time: lcPoints[0].time, value: lcPoints[0].value }];
        let segColor = lcPoints[0].color;

        for (let i = 1; i < lcPoints.length; i++) {
          const pt = lcPoints[i];
          if (pt.color !== segColor) {
            // Overlap: include this point in the closing segment before starting a new one.
            segments.push({ points: [...seg, { time: pt.time, value: pt.value }], color: segColor });
            seg = [{ time: pt.time, value: pt.value }];
            segColor = pt.color;
          } else {
            seg.push({ time: pt.time, value: pt.value });
          }
        }
        segments.push({ points: seg, color: segColor });

        let clickTargetRegistered = false;
        for (const { points: segPts, color } of segments) {
          if (segPts.length < 2) continue;
          const series = chart.addLineSeries({
            color,
            lineWidth,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: markerRadius,
          });
          series.setData(segPts);
          if (!clickTargetRegistered) {
            seriesInfo.set(series, { offerKey, price: representativePrice });
            clickTargetRegistered = true;
          }
        }
      } else {
        // No lifecycle — flat line, colored by current premium state.
        const anchorRaw = isOpen ? nowSec : toUtcSec(o.last_seen ?? o.first_seen ?? '');
        if (!anchorRaw) return;
        const anchor = anchorRaw as UTCTimestamp;
        const candleWidthSec = candleMin * 60;
        const points: TimeValue[] = [
          { time: (anchor - candleWidthSec) as UTCTimestamp, value: o.price },
          { time: anchor, value: o.price },
        ];
        const color = isSelected ? selectedLine : offerColor(o.direction, o.net_premium_percent);
        const series = chart.addLineSeries({
          color,
          lineWidth,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: markerRadius,
        });
        series.setData(points);
        seriesInfo.set(series, { offerKey, price: o.price });
      }
    });

    // Apply visible range — restore saved range if available (e.g. after load-more)
    const hasData = shiftedDisplay.candles.length > 0 || premiumOffers.length > 0;
    if (hasData) {
      if (savedRangeRef.current) {
        try {
          chart.timeScale().setVisibleRange(savedRangeRef.current);
        } catch {
          chart.timeScale().setVisibleRange({ from: fromSec, to: nowSec });
        }
        savedRangeRef.current = null;
      } else {
        try {
          chart.timeScale().setVisibleRange({ from: fromSec, to: nowSec });
        } catch {
          chart.timeScale().fitContent();
        }
      }
    }

    // --- Auto-fetch when scrolling back to the start ---
    const earliestCandleTime = shiftedDisplay.candles.length > 0
      ? toUtcSec(shiftedDisplay.candles[0].time) as UTCTimestamp
      : null;

    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range || !earliestCandleTime || fetchingMoreRef.current) return;
      // Trigger when the left edge of the view is within 2 candle-widths of the earliest data
      const triggerThreshold = earliestCandleTime + candleMin * 60 * 2;
      if ((range.from as number) <= triggerThreshold) {
        fetchingMoreRef.current = true;
        // Save the current visible range so we can restore it after the chart re-renders
        savedRangeRef.current = { from: range.from as UTCTimestamp, to: range.to as UTCTimestamp };
        const newHours = loadedHours * 3;
        onNeedMoreData(newHours);
        // Reset the guard after a cooldown so rapid scrolling doesn't spam requests
        setTimeout(() => { fetchingMoreRef.current = false; }, 10_000);
      }
    });

    // Crosshair move
    chart.subscribeCrosshairMove((param) => {
      if (param.time === undefined) {
        setHoveredOhlcTime(null);
        return;
      }
      const shiftedSec = param.time as number;
      setHoveredOhlcTime(shiftedDisplay.utcByShiftedSec.get(shiftedSec) ?? shiftedSec);
    });

    // Click handler
    chart.subscribeClick((param) => {
      if (!param.point) {
        setSelectedOfferKey(null);
        return;
      }
      const clickY = param.point.y;
      let closestKey: string | null = null;
      let closestDist = Infinity;

      for (const [series, info] of seriesInfo) {
        const coord = series.priceToCoordinate(info.price);
        if (coord == null) continue;
        const dist = Math.abs(coord - clickY);
        if (dist < closestDist && dist < 12) {
          closestDist = dist;
          closestKey = info.offerKey;
        }
      }

      setSelectedOfferKey(closestKey != null
        ? (closestKey === selectedOfferKey ? null : closestKey)
        : null
      );
    });

    return () => {
      setHoveredOhlcTime(null);
      chart.remove();
      chartRef.current = null;
    };
  }, [shiftedDisplay, premiumOffers, offerKeys, hours, selectedOfferKey, candleMin, loadedHours, onNeedMoreData, setHoveredOhlcTime, setSelectedOfferKey]);

  return (
    <div className="relative h-full bg-bg flex flex-col">
      {/* Candle size selector */}
      <div className="flex items-center gap-1 px-1 pb-1 shrink-0">
        <span className="text-[0.6rem] text-muted uppercase tracking-wider mr-1">Candle</span>
        {visibleOptions.map(opt => (
          <button
            key={opt}
            onClick={() => setCandleMin(opt)}
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

      {loading && <LoadingSpinner size={36} label="Loading chart data" />}
      <div
        ref={divRef}
        className="flex-1 min-h-0"
        style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.35s ease' }}
      />
    </div>
  );
}

export const OHLCChart = memo(OHLCChartInner);
