import { useEffect, useRef, useState } from 'react';
import { useFilters } from '../context/FiltersContext';

export function DepthChart() {
  const { depthOffers: offers } = useFilters();
  const divRef = useRef<HTMLDivElement>(null);
  const [midInfo, setMidInfo] = useState('');

  useEffect(() => {
    if (!divRef.current || !offers.length) return;
    const Plotly = (window as unknown as Record<string, unknown>).Plotly;
    if (!Plotly) return;

    const lastSeen: Record<string, string> = {};
    offers.forEach(o => {
      if (!lastSeen[o.exchange] || o.last_seen! > lastSeen[o.exchange]) lastSeen[o.exchange] = o.last_seen!;
    });
    const open = offers.filter(o => o.last_seen === lastSeen[o.exchange]);
    if (!open.length) return;

    const midPrice = open.reduce((s, o) => s + (o.ref_price || 0), 0) / open.length;

    const bidMap: Record<number, number> = {};
    const askMap: Record<number, number> = {};
    open.forEach(o => {
      const map = o.direction === 'buy' ? bidMap : askMap;
      map[o.price] = (map[o.price] || 0) + (o.btc_max || 0);
    });

    const rawBids = Object.entries(bidMap).map(([price, btc]) => ({ price: +price, btc }));
    const rawAsks = Object.entries(askMap).map(([price, btc]) => ({ price: +price, btc }));
    rawBids.sort((a, b) => b.price - a.price);
    rawAsks.sort((a, b) => a.price - b.price);

    let cumBid = 0;
    const bids = rawBids.map(o => { cumBid += o.btc; return { price: o.price, cum: cumBid }; });
    let cumAsk = 0;
    const asks = rawAsks.map(o => { cumAsk += o.btc; return { price: o.price, cum: cumAsk }; });

    const maxVol = Math.max(cumBid, cumAsk);
    const minPrice = rawBids.length ? Math.min(...rawBids.map(b => b.price)) : midPrice;
    const maxPrice = rawAsks.length ? Math.max(...rawAsks.map(a => a.price)) : midPrice;
    const priceRange = Math.max(midPrice - minPrice, maxPrice - midPrice) * 1.05 || midPrice * 0.05;

    const traces = [
      {
        x: bids.map(b => b.cum), y: bids.map(b => b.price),
        type: 'scatter', mode: 'lines', name: 'Bids',
        fill: 'tozerox', line: { color: '#3fb950', width: 1.5, shape: 'vh' },
        fillcolor: 'rgba(63,185,80,0.15)',
        hovertemplate: 'Bid €%{y:,.0f}<br>Cum: %{x:.3f} BTC<extra></extra>',
      },
      {
        x: asks.map(a => a.cum), y: asks.map(a => a.price),
        type: 'scatter', mode: 'lines', name: 'Asks',
        fill: 'tozerox', line: { color: '#f85149', width: 1.5, shape: 'vh' },
        fillcolor: 'rgba(248,81,73,0.15)',
        hovertemplate: 'Ask €%{y:,.0f}<br>Cum: %{x:.3f} BTC<extra></extra>',
      },
      {
        x: [0, maxVol], y: [midPrice, midPrice],
        type: 'scatter', mode: 'lines', name: 'Mid',
        line: { color: '#8b949e', width: 1, dash: 'dot' },
        hoverinfo: 'skip', showlegend: false,
      },
    ];

    const layout = {
      paper_bgcolor: '#161b22',
      plot_bgcolor: '#0d1117',
      font: { color: '#8b949e', size: 11 },
      xaxis: { title: 'Cumulative BTC', gridcolor: '#21262d', range: [0, maxVol * 1.05] },
      yaxis: {
        title: 'Price (EUR)', gridcolor: '#21262d', tickformat: ',.0f',
        side: 'left',
        range: [midPrice - priceRange, midPrice + priceRange],
      },
      showlegend: false,
      margin: { l: 70, r: 20, t: 10, b: 20 },
      hovermode: 'y unified',
    };

    (Plotly as { newPlot: (el: HTMLDivElement, traces: unknown[], layout: unknown, config: unknown) => void })
      .newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });

    const highestBid = rawBids.length ? rawBids[0].price : null;
    const lowestAsk = rawAsks.length ? rawAsks[0].price : null;
    const spreadText = highestBid && lowestAsk
      ? ` · Spread €${(lowestAsk - highestBid).toLocaleString('de-DE')}`
      : '';
    setMidInfo(`Mid €${Math.round(midPrice).toLocaleString('de-DE')}${spreadText}`);
  }, [offers]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex justify-between items-center mb-2 shrink-0">
        <h3 className="text-[0.85rem] text-muted">Orderbook Depth</h3>
        <span className="text-[0.85rem] text-muted">{midInfo}</span>
      </div>
      <div className="flex-1 min-h-0 relative">
        <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
      </div>
    </div>
  );
}
