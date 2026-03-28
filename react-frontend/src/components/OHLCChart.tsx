import { useEffect, useRef } from 'react';
import type { OHLCData } from '../types';
import { useFilters } from '../context/FiltersContext';

interface Props {
  data: OHLCData | null;
}

const DOT_COLORS: Record<string, string> = { bisq: '#f7931a', hodlhodl: '#3fb950', robosats: '#bc8cff' };
const DIR_SYMBOL: Record<string, string> = { sell: 'triangle-down', buy: 'triangle-up' };

export function OHLCChart({ data }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const { filteredOffers: premiumOffers, filters: { hours } } = useFilters();

  useEffect(() => {
    if (!divRef.current || !data) return;
    const Plotly = (window as unknown as Record<string, unknown>).Plotly;
    if (!Plotly) return;

    const candles = data.candles;
    const traces: unknown[] = [];

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

    const groups: Record<string, { x: string[]; y: number[]; text: string[]; exchange: string; direction: string }> = {};
    premiumOffers.forEach(o => {
      const key = `${o.exchange}_${o.direction}`;
      if (!groups[key]) groups[key] = { x: [], y: [], text: [], exchange: o.exchange, direction: o.direction };
      const g = groups[key];
      g.x.push((o.first_seen || o.time || '').replace(' ', 'T') + 'Z');
      g.y.push(o.price);
      const pct = (o.price_diff_percent ?? o.premium) != null
        ? ((o.price_diff_percent ?? o.premium) as number).toFixed(1) + '%' : '—';
      g.text.push(`${o.exchange} ${o.direction === 'buy' ? 'Bid' : 'Ask'}<br>€${Number(o.price).toLocaleString('de-DE')}<br>Premium: ${pct}<br>${o.payment_method || ''}`);
    });

    Object.values(groups).forEach((g) => {
      traces.push({
        type: 'scatter', mode: 'markers',
        x: g.x, y: g.y, text: g.text, hoverinfo: 'text',
        name: `${g.exchange} ${g.direction === 'buy' ? 'Bids' : 'Asks'}`,
        marker: {
          color: DOT_COLORS[g.exchange] || '#888',
          size: 7,
          symbol: DIR_SYMBOL[g.direction] || 'circle',
          line: { width: 1, color: '#0d1117' },
        },
      });
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

    (Plotly as { newPlot: (el: HTMLDivElement, traces: unknown[], layout: unknown, config: unknown) => void })
      .newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
  }, [data, premiumOffers, hours]);

  return (
    <div className="relative h-full">
      <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
