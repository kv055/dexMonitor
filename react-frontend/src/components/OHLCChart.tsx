import { memo, useEffect, useRef } from 'react';
import { toUtcSec } from '../utils/formatters';
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { OHLCData } from '../types';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';

interface Props {
  data: OHLCData | null;
}

const EXCHANGE_COLORS: Record<string, string> = { bisq: '#f7931a', hodlhodl: '#3fb950', robosats: '#bc8cff' };

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function OHLCChartInner({ data }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { filteredOffers: premiumOffers, filters: { hours }, selectedOfferId, setSelectedOfferId, setHoveredOhlcTime, loading } = useFilters();

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
    if (data?.candles?.length) {
      const candleSeries = chart.addCandlestickSeries({
        upColor: '#3fb950',
        downColor: '#f85149',
        borderUpColor: '#3fb950',
        borderDownColor: '#f85149',
        wickUpColor: '#3fb950',
        wickDownColor: '#f85149',
      });
      candleSeries.setData(
        data.candles.map(c => ({
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
    // Map series → { offerId, price } for click detection
    const seriesInfo = new Map<ISeriesApi<'Line'>, { offerId: number; price: number }>();

    premiumOffers.forEach(o => {
      const isOpen = o.is_live;
      const startSec = toUtcSec(o.first_seen || o.time || '') as UTCTimestamp;
      const endSec = (isOpen ? nowSec : toUtcSec(o.last_seen ?? '') as UTCTimestamp);

      if (startSec >= endSec) return;

      const isSelected = o.id === selectedOfferId;
      const color = isSelected ? selectedLine : (EXCHANGE_COLORS[o.exchange] || '#888');

      const series = chart.addLineSeries({
        color,
        lineWidth: isSelected ? 3 : 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: isSelected ? 5 : 3,
      });

      series.setData([
        { time: startSec, value: o.price },
        { time: endSec, value: o.price },
      ]);

      seriesInfo.set(series, { offerId: o.id, price: o.price });
    });

    // Apply visible range — requires at least one series with data
    const hasData = (data?.candles?.length ?? 0) > 0 || premiumOffers.length > 0;
    if (hasData) {
      try {
        chart.timeScale().setVisibleRange({ from: fromSec, to: nowSec });
      } catch {
        chart.timeScale().fitContent();
      }
    }

    // Crosshair move — emit hovered time to shared state immediately
    chart.subscribeCrosshairMove((param) => {
      setHoveredOhlcTime(param.time !== undefined ? (param.time as number) : null);
    });

    // Click handler — find closest offer line within 12px
    chart.subscribeClick((param) => {
      if (!param.point) {
        setSelectedOfferId(null);
        return;
      }
      const clickY = param.point.y;
      let closestId: number | null = null;
      let closestDist = Infinity;

      for (const [series, info] of seriesInfo) {
        const coord = series.priceToCoordinate(info.price);
        if (coord == null) continue;
        const dist = Math.abs(coord - clickY);
        if (dist < closestDist && dist < 12) {
          closestDist = dist;
          closestId = info.offerId;
        }
      }

      setSelectedOfferId(closestId != null
        ? (closestId === selectedOfferId ? null : closestId)
        : null
      );
    });

    return () => {
      setHoveredOhlcTime(null);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, premiumOffers, hours, selectedOfferId]);

  return (
    <div className="relative h-full bg-bg">
      {loading && <LoadingSpinner size={36} label="Loading chart data" />}
      <div ref={divRef} style={{ position: 'absolute', inset: 0, opacity: loading ? 0 : 1, transition: 'opacity 0.35s ease' }} />
    </div>
  );
}

export const OHLCChart = memo(OHLCChartInner);
