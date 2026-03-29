import { useEffect, useRef } from 'react';
import type { OHLCData } from '../types';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';

interface Props {
  data: OHLCData | null;
}

const EXCHANGE_COLORS: Record<string, string> = { bisq: '#f7931a', hodlhodl: '#3fb950', robosats: '#bc8cff' };

/** Snap a timestamp (ms) to the nearest candle center (ms). */
function snapToCandle(offerMs: number, candleTimesMs: number[]): number {
  if (candleTimesMs.length === 0) return offerMs;
  let nearest = candleTimesMs[0];
  let minDiff = Math.abs(offerMs - nearest);
  for (const t of candleTimesMs) {
    const diff = Math.abs(offerMs - t);
    if (diff < minDiff) { minDiff = diff; nearest = t; }
  }
  return nearest;
}

function normalizeTs(ts: string): string {
  return ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z');
}

export function OHLCChart({ data }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const { filteredOffers: premiumOffers, filters: { hours }, selectedOfferId, setSelectedOfferId, loading } = useFilters();

  useEffect(() => {
    if (!divRef.current || !data) return;
    const Plotly = (window as unknown as Record<string, unknown>).Plotly;
    if (!Plotly) return;

    const candles = data.candles;
    const traces: unknown[] = [];

    // Candle width in ms (fallback: 1 hour)
    const candleWidthMs = candles.length > 1
      ? new Date(candles[1].time + 'Z').getTime() - new Date(candles[0].time + 'Z').getTime()
      : 3_600_000;
    const halfWidthMs = candleWidthMs / 2;
    const candleTimesMs = candles.map(c => new Date(c.time + 'Z').getTime());
    const chartEndMs = Date.now();

    if (candles.length) {
      traces.push({
        type: 'candlestick',
        x: candles.map(c => c.time + 'Z'),
        open: candles.map(c => c.open),
        high: candles.map(c => c.high),
        low: candles.map(c => c.low),
        close: candles.map(c => c.close),
        increasing: { line: { color: '#3fb950' } },
        decreasing: { line: { color: '#f85149' } },
        name: 'Kraken BTC/EUR',
      });
    }

    // Determine the most recent last_seen per exchange to identify open offers
    const lastSeenMap: Record<string, string> = {};
    premiumOffers.forEach(o => {
      if (o.last_seen && (!lastSeenMap[o.exchange] || o.last_seen > lastSeenMap[o.exchange]))
        lastSeenMap[o.exchange] = o.last_seen;
    });

    const groups: Record<string, {
      x: string[]; lastSeen: string[]; y: number[]; text: string[]; ids: number[];
      exchange: string; direction: string;
    }> = {};

    premiumOffers.forEach(o => {
      const key = `${o.exchange}_${o.direction}`;
      if (!groups[key]) groups[key] = { x: [], lastSeen: [], y: [], text: [], ids: [], exchange: o.exchange, direction: o.direction };
      const g = groups[key];
      g.x.push((o.first_seen || o.time || '').replace(' ', 'T') + 'Z');
      g.lastSeen.push(o.last_seen ?? '');
      g.y.push(o.price);
      const pct = (o.price_diff_percent ?? o.premium) != null
        ? ((o.price_diff_percent ?? o.premium) as number).toFixed(1) + '%' : '—';
      g.text.push(`${o.exchange} ${o.direction === 'buy' ? 'Bid' : 'Ask'}<br>€${Number(o.price).toLocaleString('de-DE')}<br>Premium: ${pct}<br>${o.payment_method || ''}`);
      g.ids.push(o.id);
    });

    // Each offer is a horizontal line from first_seen → last_seen (or chart end for open offers).
    // Start snaps to the left edge of nearest candle; end snaps to the right edge (open offers go to now).
    Object.values(groups).forEach((g) => {
      const baseColor = EXCHANGE_COLORS[g.exchange] || '#888';
      const traceName = `${g.exchange} ${g.direction === 'buy' ? 'Bids' : 'Asks'}`;

      type Seg = { x: (string | null)[]; y: (number | null)[]; text: (string | null)[]; customdata: (number | null)[] };
      const normal: Seg = { x: [], y: [], text: [], customdata: [] };
      const selected: Seg = { x: [], y: [], text: [], customdata: [] };

      g.ids.forEach((id, i) => {
        const firstMs = new Date(g.x[i]).getTime();
        const isOpen = !g.lastSeen[i] || g.lastSeen[i] === lastSeenMap[g.exchange];
        const lastMs = isOpen
          ? chartEndMs
          : new Date(normalizeTs(g.lastSeen[i])).getTime();

        const startCandleMs = snapToCandle(firstMs, candleTimesMs);
        const endCandleMs = isOpen ? chartEndMs : snapToCandle(lastMs, candleTimesMs);

        // Densify: one data point per candle center within the offer's duration so
        // clicking anywhere along the line hits a nearby point and triggers selection.
        const pointsMs = candleTimesMs.filter(t => t >= startCandleMs - halfWidthMs && t <= endCandleMs + halfWidthMs);
        if (pointsMs.length === 0) pointsMs.push(startCandleMs);

        const seg = id === selectedOfferId ? selected : normal;
        pointsMs.forEach(t => {
          seg.x.push(new Date(t).toISOString());
          seg.y.push(g.y[i]);
          seg.text.push(g.text[i]);
          seg.customdata.push(id);
        });
        seg.x.push(null);
        seg.y.push(null);
        seg.text.push(null);
        seg.customdata.push(null);
      });

      if (normal.x.length) {
        traces.push({
          type: 'scatter', mode: 'lines',
          x: normal.x, y: normal.y, text: normal.text, hoverinfo: 'text',
          customdata: normal.customdata,
          name: traceName,
          line: { color: baseColor, width: 2 },
        });
      }
      if (selected.x.length) {
        traces.push({
          type: 'scatter', mode: 'lines',
          x: selected.x, y: selected.y, text: selected.text, hoverinfo: 'text',
          customdata: selected.customdata,
          name: `${traceName} (selected)`,
          line: { color: '#ffffff', width: 3 },
        });
      }
    });

    const layout = {
      paper_bgcolor: '#161b22',
      plot_bgcolor: '#0d1117',
      font: { color: '#8b949e', size: 11 },
      xaxis: {
        type: 'date', gridcolor: '#21262d',
        rangeslider: { visible: false },
        range: [new Date(Date.now() - Number(hours) * 3600 * 1000).toISOString(), new Date().toISOString()],
      },
      yaxis: { title: 'Price (EUR)', gridcolor: '#21262d', side: 'left', tickformat: ',.0f' },
      showlegend: false,
      margin: { l: 70, r: 10, t: 10, b: 20 },
    };

    const plotEl = divRef.current;
    (Plotly as { newPlot: (el: HTMLDivElement, traces: unknown[], layout: unknown, config: unknown) => void })
      .newPlot(plotEl, traces, layout, { responsive: true, displayModeBar: false });

    // Click handler — toggle selection (skip null separators)
    (plotEl as unknown as { on: (ev: string, fn: (d: unknown) => void) => void })
      .on('plotly_click', (eventData: unknown) => {
        const pts = (eventData as { points?: { customdata?: number | null }[] }).points;
        const id = pts?.[0]?.customdata ?? null;
        if (id != null) setSelectedOfferId(id === selectedOfferId ? null : id);
      });
  }, [data, premiumOffers, hours, selectedOfferId]);

  return (
    <div className="relative h-full">
      {loading && <LoadingSpinner size={36} label="Loading chart data" />}
      <div ref={divRef} style={{ position: 'absolute', inset: 0, opacity: loading ? 0 : 1, transition: 'opacity 0.35s ease' }} />
    </div>
  );
}
