import { memo, useEffect, useRef, useMemo, useLayoutEffect, useState } from 'react';
import { useFilters } from '../hooks/useFilters';
import { useTimezone } from '../hooks/useTimezone';
import { LoadingSpinner } from './LoadingSpinner';
import { formatDateTimeLabel, toUtcSec } from '../utils/formatters';
import { formatFiat } from '../utils/currency';
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

function cumulativeRows(rows: { price: number; btc: number }[]) {
  let runningTotal = 0;
  return rows.map((row) => {
    runningTotal += row.btc;
    return { price: row.price, cum: runningTotal };
  });
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

function DepthChartInner() {
  const { depthOffers, filters, loading, hoveredOhlcTime } = useFilters();
  const { timezone } = useTimezone();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasMetricsRef = useRef<{ w: number; h: number; dpr: number } | null>(null);
  const [referenceNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [resizeTick, setResizeTick] = useState(0);
  // Price-axis zoom (1 = default window) and vertical pan expressed as a
  // fraction of the natural data range, so it stays stable across zoom levels.
  const [yZoom, setYZoom] = useState(1.0);
  const [panFrac, setPanFrac] = useState(0);
  const headerTimestamp = formatDateTimeLabel(hoveredOhlcTime ?? referenceNowSec, timezone);

  // Mirror the interactive state into refs so the (mount-scoped) pointer
  // handlers always read the latest values without re-binding listeners.
  const yZoomRef = useRef(yZoom);
  const panFracRef = useRef(panFrac);
  useEffect(() => { yZoomRef.current = yZoom; }, [yZoom]);
  useEffect(() => { panFracRef.current = panFrac; }, [panFrac]);
  // Plot geometry published by the draw pass so pointer handlers can tell the
  // price-axis margin (left) from the plot area and convert pixels ↔ price.
  const layoutRef = useRef<{ ML: number; PH: number } | null>(null);

  const showReset = Math.abs(yZoom - 1) > 0.001 || Math.abs(panFrac) > 0.001;
  const resetView = () => {
    setYZoom(1);
    setPanFrac(0);
  };

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => setResizeTick(t => t + 1));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Pan/zoom gestures on the price (y) axis — mirrors the OHLC chart:
  //   · wheel over the chart zooms the price scale
  //   · dragging vertically on the left price-axis margin scales it
  //   · dragging vertically inside the plot pans up/down
  // The cursor turns into the same ns-resize arrow over the axis labels.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setYZoom(z => clampZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };

    const drag = { active: false, mode: 'pan' as 'pan' | 'zoom', startY: 0, startZoom: 1, startPan: 0 };

    const onWindowMove = (e: MouseEvent) => {
      const layout = layoutRef.current;
      if (!drag.active || !layout) return;
      const dy = e.clientY - drag.startY;
      if (drag.mode === 'zoom') {
        setYZoom(clampZoom(drag.startZoom * Math.exp(-dy / 150)));
      } else {
        // Grab-and-pull: dragging down reveals higher prices (which sit at the top).
        setPanFrac(drag.startPan + (dy / layout.PH) * (2 / drag.startZoom));
      }
    };
    const onWindowUp = () => {
      if (!drag.active) return;
      drag.active = false;
      canvas.style.cursor = 'default';
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
    };
    const onDown = (e: MouseEvent) => {
      const layout = layoutRef.current;
      if (!layout) return;
      const x = e.clientX - canvas.getBoundingClientRect().left;
      drag.active = true;
      drag.startY = e.clientY;
      drag.startZoom = yZoomRef.current;
      drag.startPan = panFracRef.current;
      drag.mode = x < layout.ML ? 'zoom' : 'pan';
      canvas.style.cursor = drag.mode === 'zoom' ? 'ns-resize' : 'grabbing';
      e.preventDefault();
      window.addEventListener('mousemove', onWindowMove);
      window.addEventListener('mouseup', onWindowUp);
    };
    const onHover = (e: MouseEvent) => {
      if (drag.active) return;
      const layout = layoutRef.current;
      if (!layout) { canvas.style.cursor = 'default'; return; }
      const x = e.clientX - canvas.getBoundingClientRect().left;
      canvas.style.cursor = x < layout.ML ? 'ns-resize' : 'grab';
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onHover);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onHover);
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
    };
  }, []);

  // Compute offers to display: live or historical snapshot
  const displayOffers = useMemo(() => {
    if (hoveredOhlcTime === null) return depthOffers;
    return depthOffers.filter(o => {
      const fs = toUtcSec(getFirstSeen(o) || '');
      const ls = toUtcSec(getLastSeen(o) || '');
      if (!Number.isFinite(fs) || fs > hoveredOhlcTime) return false;

      // last_seen is the time of the latest snapshot, not the closing time of
      // an offer that is still live. Treat live offers as open-ended so the
      // newest OHLC candles remain hoverable between snapshot refreshes.
      return isOfferLive(o) || (Number.isFinite(ls) && ls >= hoveredOhlcTime);
    });
  }, [hoveredOhlcTime, depthOffers]);

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

    const bids = cumulativeRows(rawBids);
    const asks = cumulativeRows(rawAsks);

    const maxVol = Math.max(bids.at(-1)?.cum ?? 0, asks.at(-1)?.cum ?? 0) * 1.05 || 1;
    const dataRange = Math.max(
      midPrice - (rawBids.at(-1)?.price ?? midPrice),
      (rawAsks.at(-1)?.price ?? midPrice) - midPrice
    ) * 1.1 || midPrice * 0.05;
    const priceRange = dataRange / yZoom;
    const priceCenter = midPrice + panFrac * dataRange;
    const priceMin = priceCenter - priceRange;
    const priceMax = priceCenter + priceRange;

    // Volume totals within visible price range
    const visibleBidBtc = rawBids
      .filter(b => b.price >= priceMin && b.price <= priceMax)
      .reduce((s, b) => s + b.btc, 0);
    const visibleAskBtc = rawAsks
      .filter(a => a.price >= priceMin && a.price <= priceMax)
      .reduce((s, a) => s + a.btc, 0);

    const highestBid = rawBids[0]?.price ?? null;
    const lowestAsk = rawAsks[0]?.price ?? null;

    return {
      rawBids,
      rawAsks,
      bids,
      asks,
      midPrice,
      maxVol,
      priceMin,
      priceMax,
      visibleBidBtc,
      visibleAskBtc,
      spread: highestBid && lowestAsk ? lowestAsk - highestBid : null,
    };
  }, [displayOffers, hoveredOhlcTime, yZoom, panFrac]);

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

    // Publish geometry for the pointer handlers (axis margin vs plot, px↔price).
    layoutRef.current = { ML, PH };

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
	  ctx.fillText(formatFiat(p, filters.fiat, { maximumFractionDigits: 0 }), ML - 5, y);
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

	}, [chartData, filters.fiat, resizeTick]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="mb-2 shrink-0">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted">Orderbook Depth</h3>
          <span className="text-[0.6rem] tabular-nums text-accent">{headerTimestamp}</span>
        </div>
        {chartData && (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[0.65rem] tabular-nums text-muted">
            <span>Bids <span className="font-medium text-green">{chartData.visibleBidBtc.toFixed(3)}</span></span>
            <span>Asks <span className="font-medium text-red">{chartData.visibleAskBtc.toFixed(3)}</span> BTC</span>
			<span>Mid <span className="font-medium text-text">{formatFiat(chartData.midPrice, filters.fiat, { maximumFractionDigits: 0 })}</span></span>
            {chartData.spread != null && (
			  <span>Spread <span className="font-medium text-text">{formatFiat(chartData.spread, filters.fiat, { maximumFractionDigits: 0 })}</span></span>
            )}
          </div>
        )}
      </header>
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {loading && <LoadingSpinner size={104} label="Loading orderbook" />}
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
        {showReset && (
          <button
            onClick={resetView}
            title="Reset chart view"
            className="absolute top-1.5 right-2 z-10 bg-surface/90 border border-border rounded-md px-2 py-0.5 text-[0.68rem] text-muted hover:text-text hover:border-muted transition-colors"
          >
            ⟲ Reset view
          </button>
        )}
      </div>
    </div>
  );
}

export const DepthChart = memo(DepthChartInner);
