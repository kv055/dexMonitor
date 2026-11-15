import {
  memo,
  useEffect,
  useRef,
  useMemo,
  useLayoutEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useFilters } from '../hooks/useFilters';
import { LoadingSpinner } from './LoadingSpinner';
import { toUtcSec } from '../utils/formatters';
import { formatFiat } from '../utils/currency';
import { getBtcMax, getFirstSeen, getLastSeen, getOfferPrice, getRefPrice, isOfferLive } from '../utils/offerAccess';
import { isSamePriceLevel, niceStep, priceLevelAt, priceLevelStats, priceLevelStep, type PriceLevel } from '../utils/priceLevels';

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

// Plot margins; the left (price-label) margin narrows on small containers.
function plotLayout(W: number, H: number) {
  const ML = W < 340 ? 48 : 70, MR = 15, MT = 10, MB = 28;
  return { ML, MR, MT, MB, PW: W - ML - MR, PH: H - MT - MB };
}

const TOOLTIP_W = 190;
const TOOLTIP_H = 126;
// Pointer travel (px) below which a press on the plot is a click, not a pan.
const CLICK_SLOP_PX = 4;

function DepthChartInner() {
  const { depthOffers, filters, loading, hoveredOhlcTime, selectedPriceLevel, setSelectedPriceLevel } = useFilters();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasMetricsRef = useRef<{ w: number; h: number; dpr: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Pointer position (canvas px) while hovering the plot; drives the
  // highlighted price level and its tooltip.
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  // Axis zoom (1 = default window) and vertical pan expressed as a fraction of
  // the natural price range, so it stays stable across zoom levels.
  const [xZoom, setXZoom] = useState(1.0);
  const [yZoom, setYZoom] = useState(1.0);
  const [panFrac, setPanFrac] = useState(0);

  // Mirror the interactive state into refs so the (mount-scoped) pointer
  // handlers always read the latest values without re-binding listeners.
  const xZoomRef = useRef(xZoom);
  const yZoomRef = useRef(yZoom);
  const panFracRef = useRef(panFrac);
  const xAxisDragRef = useRef<{ pointerId: number; startX: number; startZoom: number } | null>(null);
  useEffect(() => { xZoomRef.current = xZoom; }, [xZoom]);
  useEffect(() => { yZoomRef.current = yZoom; }, [yZoom]);
  useEffect(() => { panFracRef.current = panFrac; }, [panFrac]);
  // Plot geometry published by the draw pass so pointer handlers can tell the
  // axis margins from the plot area and convert pointer movement to scale.
  const layoutRef = useRef<{ ML: number; MT: number; PW: number; PH: number } | null>(null);
  // Visible price window published by the draw pass, so a click can resolve
  // the price level under the pointer.
  const priceWindowRef = useRef<{ priceMin: number; priceMax: number } | null>(null);
  // Clicking a price level pins it and filters the offers list to it;
  // clicking it again (or resetting the view) clears the selection.
  const selectedLevelRef = useRef(selectedPriceLevel);
  useEffect(() => { selectedLevelRef.current = selectedPriceLevel; }, [selectedPriceLevel]);
  const setSelectedLevelRef = useRef(setSelectedPriceLevel);
  useEffect(() => { setSelectedLevelRef.current = setSelectedPriceLevel; }, [setSelectedPriceLevel]);

  const showReset = Math.abs(xZoom - 1) > 0.001 ||
    Math.abs(yZoom - 1) > 0.001 ||
    Math.abs(panFrac) > 0.001 ||
    selectedPriceLevel != null;
  const resetView = () => {
    setXZoom(1);
    setYZoom(1);
    setPanFrac(0);
    setSelectedPriceLevel(null);
  };

  const handleXAxisPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    xAxisDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startZoom: xZoomRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleXAxisPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = xAxisDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    setXZoom(clampZoom(drag.startZoom * Math.exp(-dx / 150)));
  };

  const finishXAxisDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = xAxisDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    xAxisDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleXAxisWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setXZoom(z => clampZoom(z * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
  };

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: container.clientWidth, h: container.clientHeight });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Pan/zoom gestures on the price axis — mirrors the OHLC chart:
  //   · wheel over the plot or price axis zooms the price scale
  //   · dragging vertically on the left price-axis margin scales it
  //   · dragging vertically inside the plot pans up/down
  // Touch has no hover, so a tap selects the price level under the finger
  // (tap it again or tap outside the chart to dismiss) and swipes keep
  // scrolling the page instead of panning the chart.
  // X-axis gestures use the dedicated interaction layer rendered over its
  // labels below, ensuring the whole visible axis is a reliable drag target.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setYZoom(z => clampZoom(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };

    type DragMode = 'pan-y' | 'zoom-y';
    const drag = {
      active: false,
      mode: 'pan-y' as DragMode,
      // Stays false while the pointer is within CLICK_SLOP_PX of the press,
      // so a plain click selects a price level instead of panning.
      moved: false,
      startX: 0,
      startY: 0,
      startZoom: 1,
      startPan: 0,
    };

    const tap = { pointerId: -1, x: 0, y: 0, moved: false };
    const TAP_SLOP_PX = 10;

    // The price level at canvas y, using the geometry of the last draw.
    const levelAtY = (y: number): PriceLevel | null => {
      const layout = layoutRef.current;
      const priceWindow = priceWindowRef.current;
      if (!layout || !priceWindow) return null;
      const { priceMin, priceMax } = priceWindow;
      const price = priceMax - ((y - layout.MT) / layout.PH) * (priceMax - priceMin);
      return priceLevelAt(price, priceLevelStep(priceMin, priceMax));
    };
    // Selects the level at y, or clears it when it is already selected.
    // Returns whether the level is selected afterwards.
    const toggleLevelAt = (y: number): boolean => {
      const level = levelAtY(y);
      if (!level) return false;
      const current = selectedLevelRef.current;
      const selected = !(current && isSamePriceLevel(current, level));
      setSelectedLevelRef.current(selected ? level : null);
      return selected;
    };

    const plotPoint = (e: PointerEvent) => {
      const layout = layoutRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const overYAxis = !!layout && x < layout.ML &&
        y >= layout.MT && y <= layout.MT + layout.PH;
      const insidePlot = !!layout && x >= layout.ML && x <= layout.ML + layout.PW &&
        y >= layout.MT && y <= layout.MT + layout.PH;
      return { x, y, overYAxis, insidePlot };
    };

    const onWindowMove = (e: PointerEvent) => {
      const layout = layoutRef.current;
      if (!drag.active || !layout) return;
      const dy = e.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, dy) <= CLICK_SLOP_PX) return;
        drag.moved = true;
      }
      if (drag.mode === 'zoom-y') {
        setYZoom(clampZoom(drag.startZoom * Math.exp(-dy / 150)));
      } else {
        // Grab-and-pull: dragging down reveals higher prices (which sit at the top).
        setPanFrac(drag.startPan + (dy / layout.PH) * (2 / drag.startZoom));
      }
    };
    const onWindowUp = (e: PointerEvent) => {
      if (!drag.active) return;
      drag.active = false;
      canvas.style.cursor = 'default';
      if (e.type === 'pointerup' && drag.mode === 'pan-y' && !drag.moved) {
        const { x, y, insidePlot } = plotPoint(e);
        if (insidePlot) {
          toggleLevelAt(y);
          setHover({ x, y });
        }
      }
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (e.isPrimary) Object.assign(tap, { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false });
        return;
      }
      if (e.button !== 0 || !layoutRef.current) return;
      const { overYAxis, insidePlot } = plotPoint(e);
      if (!overYAxis && !insidePlot) return;

      drag.active = true;
      drag.moved = false;
      setHover(null);
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.startPan = panFracRef.current;
      drag.mode = overYAxis ? 'zoom-y' : 'pan-y';
      drag.startZoom = yZoomRef.current;
      canvas.style.cursor = drag.mode === 'zoom-y' ? 'ns-resize' : 'grabbing';
      e.preventDefault();
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowUp);
    };
    const onHover = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId === tap.pointerId &&
          Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) {
          tap.moved = true;
        }
        return;
      }
      if (drag.active) return;
      if (!layoutRef.current) { canvas.style.cursor = 'default'; return; }
      const { x, y, overYAxis, insidePlot } = plotPoint(e);
      canvas.style.cursor = overYAxis ? 'ns-resize' : insidePlot ? 'grab' : 'default';
      setHover(insidePlot ? { x, y } : null);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || e.pointerId !== tap.pointerId) return;
      tap.pointerId = -1;
      if (tap.moved) return;
      const { x, y, insidePlot } = plotPoint(e);
      if (!insidePlot) { setHover(null); return; }
      // A tap selects the level (showing its tooltip); tapping the selected
      // level again clears the selection and dismisses the tooltip.
      setHover(toggleLevelAt(y) ? { x, y } : null);
    };
    // Touch leaves the canvas on every lift, so only a mouse leaving clears it.
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') setHover(null);
    };
    const onDocumentDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && e.target !== canvas) setHover(null);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onHover);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerdown', onDocumentDown);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onHover);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerdown', onDocumentDown);
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
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
      const map = o.direction === 'bid' ? bidMap : askMap;
      const price = getOfferPrice(o);
      map[price] = (map[price] || 0) + (getBtcMax(o) || 0);
    });

    const rawBids = Object.entries(bidMap).map(([p, b]) => ({ price: +p, btc: b })).sort((a, b) => b.price - a.price);
    const rawAsks = Object.entries(askMap).map(([p, b]) => ({ price: +p, btc: b })).sort((a, b) => a.price - b.price);

    const bids = cumulativeRows(rawBids);
    const asks = cumulativeRows(rawAsks);

    const naturalMaxVol = Math.max(bids.at(-1)?.cum ?? 0, asks.at(-1)?.cum ?? 0) * 1.05 || 1;
    const maxVol = naturalMaxVol / xZoom;
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
      open,
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
  }, [displayOffers, hoveredOhlcTime, xZoom, yZoom, panFrac]);

  // Price level under the pointer: the band between the two price-axis labels
  // around it. Counts every offer in the displayed book (premium or not).
  const hoveredLevel = useMemo(() => {
    if (!hover || !chartData || size.h === 0) return null;
    const { MT, PH } = plotLayout(size.w, size.h);
    const { priceMin, priceMax } = chartData;
    const price = priceMax - ((hover.y - MT) / PH) * (priceMax - priceMin);
    const level = priceLevelAt(price, priceLevelStep(priceMin, priceMax));
    const stats = priceLevelStats(chartData.open, level, {
      price: getOfferPrice,
      btc: o => getBtcMax(o) || 0,
      isBid: o => o.direction === 'bid',
    });
    const isSelected = selectedPriceLevel != null && isSamePriceLevel(selectedPriceLevel, level);
    return { ...level, ...stats, isSelected };
  }, [hover, chartData, size, selectedPriceLevel]);

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

    const { ML, MT, PW, PH } = plotLayout(W, H);
    const grid = cssVar('--app-grid', '#21262d');
    const muted = cssVar('--app-muted', '#8b949e');
    const text = cssVar('--app-text', '#e6edf3');

    // Keep canvas transparent so theme background swaps instantly via CSS.
    ctx.clearRect(0, 0, W, H);
    priceWindowRef.current = chartData
      ? { priceMin: chartData.priceMin, priceMax: chartData.priceMax }
      : null;
    if (!chartData) return;

    const { bids, asks, midPrice, maxVol, priceMin, priceMax } = chartData;

    // Publish geometry for the pointer handlers (axis margin vs plot, px↔price).
    layoutRef.current = { ML, MT, PW, PH };

    const xOf = (v: number) => ML + (v / maxVol) * PW;
    const yOf = (p: number) => MT + (1 - (p - priceMin) / (priceMax - priceMin)) * PH;

    // --- Grid & labels ---
    ctx.font = `10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.lineWidth = 1;

    // Price levels: alternate shading between adjacent price labels so each
    // level reads as a band; the hovered level is highlighted.
    const priceStep = priceLevelStep(priceMin, priceMax);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ML, MT, PW, PH);
    ctx.clip();
    for (let low = Math.floor(priceMin / priceStep) * priceStep; low < priceMax; low += priceStep) {
      const isHovered = hoveredLevel != null && Math.abs(hoveredLevel.low - low) < priceStep / 2;
      const isOdd = Math.round(low / priceStep) % 2 !== 0;
      if (!isHovered && !isOdd) continue;
      const top = yOf(low + priceStep);
      ctx.globalAlpha = isHovered ? 0.18 : 0.35;
      ctx.fillStyle = isHovered ? text : grid;
      ctx.fillRect(ML, top, PW, yOf(low) - top);
    }
    // The selected level keeps its own absolute price bounds, so it stays put
    // while zooming changes the band step.
    if (selectedPriceLevel) {
      const accent = cssVar('--color-accent', '#f7931a');
      const top = yOf(selectedPriceLevel.high);
      const bottom = yOf(selectedPriceLevel.low);
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = accent;
      ctx.fillRect(ML, top, PW, bottom - top);
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(ML, top); ctx.lineTo(ML + PW, top);
      ctx.moveTo(ML, bottom); ctx.lineTo(ML + PW, bottom);
      ctx.stroke();
    }
    ctx.restore();

    // Y (price) gridlines + labels
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

	}, [chartData, filters.fiat, size, hoveredLevel, selectedPriceLevel]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {chartData && (
        <div className="mb-2 flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[0.65rem] tabular-nums text-muted">
          <span>Bids <span className="font-medium text-green">{chartData.visibleBidBtc.toFixed(3)}</span></span>
          <span>Asks <span className="font-medium text-red">{chartData.visibleAskBtc.toFixed(3)}</span> BTC</span>
          <span>Mid <span className="font-medium text-text">{formatFiat(chartData.midPrice, filters.fiat, { maximumFractionDigits: 0 })}</span></span>
          {chartData.spread != null && (
            <span>Spread <span className="font-medium text-text">{formatFiat(chartData.spread, filters.fiat, { maximumFractionDigits: 0 })}</span></span>
          )}
        </div>
      )}
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
        {hoveredLevel && hover && (
          <div
            data-testid="depth-price-level-tooltip"
            className="pointer-events-none absolute z-[6] rounded-md border border-border bg-surface/95 px-2 py-1 text-[0.68rem] tabular-nums text-text shadow-lg"
            style={{
              width: TOOLTIP_W,
              left: hover.x + 12 + TOOLTIP_W > size.w ? hover.x - 12 - TOOLTIP_W : hover.x + 12,
              top: Math.max(0, Math.min(hover.y - 28, size.h - TOOLTIP_H)),
            }}
          >
            <div className="font-medium">
              {formatFiat(hoveredLevel.low, filters.fiat, { maximumFractionDigits: 0 })}
              {' – '}
              {formatFiat(hoveredLevel.high, filters.fiat, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-muted">
              {hoveredLevel.bids.count + hoveredLevel.asks.count} offers in level
            </div>
            <div>
              <span className="text-green">Bids {hoveredLevel.bids.count}</span>
              <span className="text-muted"> · {hoveredLevel.bids.btc.toFixed(3)} BTC</span>
            </div>
            <div>
              <span className="text-red">Asks {hoveredLevel.asks.count}</span>
              <span className="text-muted"> · {hoveredLevel.asks.btc.toFixed(3)} BTC</span>
            </div>
            {/* Matches the x axis: depth accumulated from the top of the book through this level. */}
            <div className="mt-1 border-t border-border pt-1 text-muted">
              Cumulative{' '}
              <span className="text-green">{hoveredLevel.bids.cumBtc.toFixed(3)}</span>
              {' / '}
              <span className="text-red">{hoveredLevel.asks.cumBtc.toFixed(3)}</span> BTC
            </div>
            <div className="text-muted">
              {hoveredLevel.isSelected ? 'Click to show all offers' : 'Click to filter offers'}
            </div>
          </div>
        )}
        <div
          data-axis-zoom="x"
          title="Drag to zoom cumulative BTC axis"
          onPointerDown={handleXAxisPointerDown}
          onPointerMove={handleXAxisPointerMove}
          onPointerUp={finishXAxisDrag}
          onPointerCancel={finishXAxisDrag}
          onLostPointerCapture={() => { xAxisDragRef.current = null; }}
          onWheel={handleXAxisWheel}
          className="absolute inset-x-0 bottom-0 z-[5] h-7 cursor-ew-resize"
          style={{ touchAction: 'none' }}
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
