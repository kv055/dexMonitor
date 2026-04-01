import { useEffect, useRef, useState } from 'react';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';

function niceStep(range: number, targetSteps: number): number {
  const rough = range / targetSteps;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * pow;
}

export function DepthChart() {
  const { depthOffers: offers, loading } = useFilters();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [midInfo, setMidInfo] = useState('');
  const [resizeTick, setResizeTick] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => setResizeTick(t => t + 1));
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !offers.length) return;

    const dpr = window.devicePixelRatio || 1;
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (W === 0 || H === 0) return;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // --- Data ---
    const open = offers.filter(o => o.is_live);
    if (!open.length) return;

    const midPrice = open.reduce((s, o) => s + (o.ref_price || 0), 0) / open.length;

    const bidMap: Record<number, number> = {};
    const askMap: Record<number, number> = {};
    open.forEach(o => {
      const map = o.direction === 'buy' ? bidMap : askMap;
      map[o.price] = (map[o.price] || 0) + (o.btc_max || 0);
    });

    const rawBids = Object.entries(bidMap).map(([p, b]) => ({ price: +p, btc: b })).sort((a, b) => b.price - a.price);
    const rawAsks = Object.entries(askMap).map(([p, b]) => ({ price: +p, btc: b })).sort((a, b) => a.price - b.price);

    let cum = 0;
    const bids = rawBids.map(o => { cum += o.btc; return { price: o.price, cum }; });
    cum = 0;
    const asks = rawAsks.map(o => { cum += o.btc; return { price: o.price, cum }; });

    const maxVol = Math.max(bids.at(-1)?.cum ?? 0, asks.at(-1)?.cum ?? 0) * 1.05 || 1;
    const priceRange = Math.max(
      midPrice - (rawBids.at(-1)?.price ?? midPrice),
      (rawAsks.at(-1)?.price ?? midPrice) - midPrice
    ) * 1.1 || midPrice * 0.05;
    const priceMin = midPrice - priceRange;
    const priceMax = midPrice + priceRange;

    // --- Layout ---
    const ML = 70, MR = 15, MT = 10, MB = 28;
    const PW = W - ML - MR;
    const PH = H - MT - MB;

    const xOf = (v: number) => ML + (v / maxVol) * PW;
    const yOf = (p: number) => MT + (1 - (p - priceMin) / (priceMax - priceMin)) * PH;

    // --- Background ---
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    // --- Grid & labels ---
    ctx.font = `10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.lineWidth = 1;

    // Y (price) gridlines + labels
    const priceStep = niceStep(priceRange * 2, 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let p = Math.ceil(priceMin / priceStep) * priceStep; p <= priceMax; p += priceStep) {
      const y = yOf(p);
      ctx.strokeStyle = '#21262d';
      ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + PW, y); ctx.stroke();
      ctx.fillStyle = '#8b949e';
      ctx.fillText(`€${Math.round(p).toLocaleString('de-DE')}`, ML - 5, y);
    }

    // X (volume) gridlines + labels
    const volStep = niceStep(maxVol, 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let v = 0; v <= maxVol; v += volStep) {
      const x = xOf(v);
      ctx.strokeStyle = '#21262d';
      ctx.beginPath(); ctx.moveTo(x, MT); ctx.lineTo(x, MT + PH); ctx.stroke();
      ctx.fillStyle = '#8b949e';
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
    ctx.strokeStyle = '#8b949e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ML, midY); ctx.lineTo(ML + PW, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();

    // X axis title
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Cumulative BTC', ML + PW / 2, H - 2);

    // Update header info
    const highestBid = rawBids[0]?.price ?? null;
    const lowestAsk = rawAsks[0]?.price ?? null;
    const spreadText = highestBid && lowestAsk
      ? ` · Spread €${(lowestAsk - highestBid).toLocaleString('de-DE')}`
      : '';
    setMidInfo(`Mid €${Math.round(midPrice).toLocaleString('de-DE')}${spreadText}`);
  }, [offers, resizeTick]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex justify-between items-center mb-2 shrink-0">
        <h3 className="text-[0.85rem] text-muted">Orderbook Depth</h3>
        <span className="text-[0.85rem] text-muted">{midInfo}</span>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {loading && <LoadingSpinner label="Loading orderbook" />}
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, opacity: loading ? 0 : 1, transition: 'opacity 0.35s ease' }} />
      </div>
    </div>
  );
}
