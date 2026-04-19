import { memo, useEffect, useRef, useMemo, useLayoutEffect, useState } from 'react';
import { useFilters } from '../context/FiltersContext';
import { useTimezone } from '../context/TimezoneContext';
import { LoadingSpinner } from './LoadingSpinner';
import { formatDateTimeLabel, toUtcSec } from '../utils/formatters';
import { getBtcMax, getFirstSeen, getLastSeen, getOfferPrice, getRefPrice, isOfferLive } from '../utils/offerAccess';

function niceStep(range: number, targetSteps: number): number {
  const rough = range / targetSteps;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * pow;
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function DepthChartInner() {
  const { depthOffers, offers: allOffers, filters, loading, hoveredOhlcTime } = useFilters();
  const { timezone } = useTimezone();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasMetricsRef = useRef<{ w: number; h: number; dpr: number } | null>(null);
  const [resizeTick, setResizeTick] = useState(0);
  const [yZoom, setYZoom] = useState(1.0);
  const headerTimestamp = formatDateTimeLabel(hoveredOhlcTime ?? Math.floor(Date.now() / 1000), timezone);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => setResizeTick(t => t + 1));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom on the y (price) axis
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setYZoom(z => Math.min(20, Math.max(0.1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Compute offers to display: live or historical snapshot
  const displayOffers = useMemo(() => {
    if (hoveredOhlcTime === null) return depthOffers;
    return allOffers.filter(o => {
      if (filters.exchange && o.exchange !== filters.exchange) return false;
      if (filters.payment && o.payment_method !== filters.payment) return false;
      const fs = toUtcSec(getFirstSeen(o) || '');
      const ls = toUtcSec(getLastSeen(o) || '');
      return fs <= hoveredOhlcTime && ls >= hoveredOhlcTime;
    });
  }, [hoveredOhlcTime, depthOffers, allOffers, filters.exchange, filters.payment]);

  // Expensive aggregation should not rerun just because the theme changes.
  const chartData = useMemo(() => {
    if (!displayOffers.length) return null;

    // In historical mode use all matched offers; in live mode filter to is_live only
    const open = hoveredOhlcTime !== null ? displayOffers : displayOffers.filter(o => isOfferLive(o));
    if (!open.length) return null;

    const midPrice = open.reduce((s, o) => s + (getRefPrice(o) || 0), 0) / open.length;

    const bidMap: Record<number, number> = {};
    const askMap: Record<number, number> = {};
    open.forEach(o => {
      const map = o.direction === 'buy' ? bidMap : askMap;
      const price = getOfferPrice(o);
      map[price] = (map[price] || 0) + (getBtcMax(o) || 0);
    });

    const rawBids = Object.entries(bidMap).map(([p, b]) => ({ price: +p, btc: b })).sort((a, b) => b.price - a.price);
    const rawAsks = Object.entries(askMap).map(([p, b]) => ({ price: +p, btc: b })).sort((a, b) => a.price - b.price);

    let cum = 0;
    const bids = rawBids.map(o => { cum += o.btc; return { price: o.price, cum }; });
    cum = 0;
    const asks = rawAsks.map(o => { cum += o.btc; return { price: o.price, cum }; });

    const maxVol = Math.max(bids.at(-1)?.cum ?? 0, asks.at(-1)?.cum ?? 0) * 1.05 || 1;
    const dataRange = Math.max(
      midPrice - (rawBids.at(-1)?.price ?? midPrice),
      (rawAsks.at(-1)?.price ?? midPrice) - midPrice
    ) * 1.1 || midPrice * 0.05;
    const priceRange = dataRange / yZoom;
    const priceMin = midPrice - priceRange;
    const priceMax = midPrice + priceRange;

    // Volume totals within visible price range
    const visibleBidBtc = rawBids
      .filter(b => b.price >= priceMin && b.price <= priceMax)
      .reduce((s, b) => s + b.btc, 0);
    const visibleAskBtc = rawAsks
      .filter(a => a.price >= priceMin && a.price <= priceMax)
      .reduce((s, a) => s + a.btc, 0);

    const highestBid = rawBids[0]?.price ?? null;
    const lowestAsk = rawAsks[0]?.price ?? null;
    const spreadText = highestBid && lowestAsk
      ? ` · Spread €${(lowestAsk - highestBid).toLocaleString('de-DE')}`
      : '';

    return {
      rawBids,
      rawAsks,
      bids,
      asks,
      midPrice,
      maxVol,
      priceMin,
      priceMax,
      volumeInfo: `Bids ${visibleBidBtc.toFixed(3)} · Asks ${visibleAskBtc.toFixed(3)} BTC`,
      midInfo: `Mid €${Math.round(midPrice).toLocaleString('de-DE')}${spreadText}`,
    };
  }, [displayOffers, hoveredOhlcTime, yZoom]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (W === 0 || H === 0) return;

    const canvasW = Math.round(W * dpr);
    const canvasH = Math.round(H * dpr);
    const prev = canvasMetricsRef.current;
    const sizeChanged = !prev || prev.w !== canvasW || prev.h !== canvasH || prev.dpr !== dpr;
    if (sizeChanged) {
      canvas.width = canvasW;
      canvas.height = canvasH;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      canvasMetricsRef.current = { w: canvasW, h: canvasH, dpr };
    }

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // --- Layout --- (narrower left margin on small containers)
    const ML = W < 340 ? 48 : 70, MR = 15, MT = 10, MB = 28;
    const grid = cssVar('--app-grid', '#21262d');
    const muted = cssVar('--app-muted', '#8b949e');

    // Keep canvas transparent so theme background swaps instantly via CSS.
    ctx.clearRect(0, 0, W, H);
    if (!chartData) return;

    const { bids, asks, midPrice, maxVol, priceMin, priceMax } = chartData;
    const PW = W - ML - MR;
    const PH = H - MT - MB;

    const xOf = (v: number) => ML + (v / maxVol) * PW;
    const yOf = (p: number) => MT + (1 - (p - priceMin) / (priceMax - priceMin)) * PH;

    // --- Grid & labels ---
    ctx.font = `10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.lineWidth = 1;

    // Y (price) gridlines + labels
    const priceStep = niceStep(priceMax - priceMin, 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let p = Math.ceil(priceMin / priceStep) * priceStep; p <= priceMax; p += priceStep) {
      const y = yOf(p);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + PW, y); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(`€${Math.round(p).toLocaleString('de-DE')}`, ML - 5, y);
    }

    // X (volume) gridlines + labels
    const volStep = niceStep(maxVol, 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = 0; v <= maxVol; v += volStep) {
      const x = xOf(v);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(x, MT); ctx.lineTo(x, MT + PH); ctx.stroke();
      ctx.fillStyle = muted;
      ctx.fillText(v.toFixed(2), x, MT + PH + 5);
    }

    // --- Clip to plot area ---
    ctx.save();
    ctx.beginPath();
    ctx.rect(ML, MT, PW, PH);
    ctx.clip();

    // Draw vh-step staircase starting from x=0
    function staircase(pts: { price: number; cum: number }[]) {
      if (!pts.length) return;
      ctx.moveTo(xOf(0), yOf(pts[0].price));
      ctx.lineTo(xOf(pts[0].cum), yOf(pts[0].price));
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(xOf(pts[i - 1].cum), yOf(pts[i].price));
        ctx.lineTo(xOf(pts[i].cum), yOf(pts[i].price));
      }
    }

    // Bid fill + line
    if (bids.length) {
      ctx.beginPath();
      staircase(bids);
      ctx.lineTo(xOf(bids.at(-1)!.cum), yOf(priceMin));
      ctx.lineTo(xOf(0), yOf(priceMin));
      ctx.closePath();
      ctx.fillStyle = 'rgba(63,185,80,0.15)';
      ctx.fill();

      ctx.beginPath();
      staircase(bids);
      ctx.strokeStyle = '#3fb950';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Ask fill + line
    if (asks.length) {
      ctx.beginPath();
      staircase(asks);
      ctx.lineTo(xOf(asks.at(-1)!.cum), yOf(priceMax));
      ctx.lineTo(xOf(0), yOf(priceMax));
      ctx.closePath();
      ctx.fillStyle = 'rgba(248,81,73,0.15)';
      ctx.fill();

      ctx.beginPath();
      staircase(asks);
      ctx.strokeStyle = '#f85149';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Mid price dashed line
    const midY = yOf(midPrice);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ML, midY); ctx.lineTo(ML + PW, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();

    // X axis title
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Cumulative BTC', ML + PW / 2, H - 2);

  }, [chartData, resizeTick]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex justify-between items-center mb-2 shrink-0">
        <h3 className="text-[0.85rem] text-muted">
          Orderbook Depth
          <span className="ml-2 text-[0.75rem] text-accent">{headerTimestamp}</span>
        </h3>
        <div className="flex flex-col items-end gap-0.5">
          {chartData?.volumeInfo && <span className="text-[0.75rem] text-muted">{chartData.volumeInfo}</span>}
          <span className="text-[0.85rem] text-muted">{chartData?.midInfo ?? ''}</span>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {loading && <LoadingSpinner label="Loading orderbook" />}
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--app-bg)',
            opacity: loading ? 0 : 1,
            transition: 'opacity 0.35s ease',
          }}
        />
      </div>
    </div>
  );
}

export const DepthChart = memo(DepthChartInner);
