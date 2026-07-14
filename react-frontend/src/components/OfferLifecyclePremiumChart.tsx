import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import {
  BubbleController,
  Chart as ChartJS,
  Legend,
  LinearScale,
  PointElement,
  Tooltip,
  type BubbleDataPoint,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Bubble } from 'react-chartjs-2';
import type { OfferLifecyclePremiumPoint } from '../types';

ChartJS.register(BubbleController, LinearScale, PointElement, Tooltip, Legend);

interface OfferBubble extends BubbleDataPoint {
  offer: OfferLifecyclePremiumPoint;
}

interface OfferLifecyclePremiumChartProps {
  points: OfferLifecyclePremiumPoint[];
}

type AxisKey = 'x' | 'y';

interface AxisDrag {
  axis: AxisKey;
  startCoordinate: number;
  startMin: number;
  startMax: number;
}

function formatLifecycle(hours: number): string {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${(hours / 24).toFixed(hours < 240 ? 1 : 0)}d`;
}

function buildBubbles(points: OfferLifecyclePremiumPoint[], maxVolume: number): OfferBubble[] {
  return points.map(point => ({
    x: point.lifecycle_hours,
    y: point.premium_rate_pct,
    // Radius uses the square root so bubble area, rather than diameter, tracks volume.
    r: Math.max(3, 18 * Math.sqrt(point.volume_btc / maxVolume)),
    offer: point,
  }));
}

export function OfferLifecyclePremiumChart({ points }: OfferLifecyclePremiumChartProps) {
  const chartRef = useRef<ChartJS<'bubble', OfferBubble[]>>(null);
  const dragRef = useRef<AxisDrag | null>(null);
  const [zoomedAxes, setZoomedAxes] = useState({ x: false, y: false });
  const positivePoints = points.filter(point => point.premium_rate_pct > 0);
  const maxVolume = Math.max(...positivePoints.map(point => point.volume_btc), 1e-8);
  const maxLifecycle = Math.max(...positivePoints.map(point => point.lifecycle_hours), 1);
  const minPremium = Math.min(...positivePoints.map(point => point.premium_rate_pct), 0);
  const maxPremium = Math.max(...positivePoints.map(point => point.premium_rate_pct), 1);
  const premiumPadding = Math.max((maxPremium - minPremium) * 0.08, 0.05);
  const fullBounds = {
    x: { min: 0, max: Math.max(maxLifecycle * 1.08, 1) },
    y: { min: Math.max(0, minPremium - premiumPadding), max: maxPremium + premiumPadding },
  };
  const livePoints = positivePoints.filter(point => point.is_live);
  const pastPoints = positivePoints.filter(point => !point.is_live);

  const resetAxisZoom = (axis: AxisKey) => {
    const chart = chartRef.current;
    const axisOptions = chart?.options.scales?.[axis];
    if (!chart || !axisOptions) return;
    axisOptions.min = fullBounds[axis].min;
    axisOptions.max = fullBounds[axis].max;
    chart.update('none');
    setZoomedAxes(current => ({ ...current, [axis]: false }));
  };

  const resetView = () => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const axis of ['x', 'y'] as const) {
      const axisOptions = chart.options.scales?.[axis];
      if (!axisOptions) continue;
      axisOptions.min = fullBounds[axis].min;
      axisOptions.max = fullBounds[axis].max;
    }
    chart.update('none');
    setZoomedAxes({ x: false, y: false });
  };

  const applyAxisZoom = (
    axis: AxisKey,
    sourceMin: number,
    sourceMax: number,
    factor: number,
    focalRatio = 0.5,
  ) => {
    const chart = chartRef.current;
    const axisOptions = chart?.options.scales?.[axis];
    if (!chart || !axisOptions) return;

    const { min: fullMin, max: fullMax } = fullBounds[axis];
    const currentSpan = sourceMax - sourceMin;
    const minimumSpan = Math.max(fullMax / 100, 1 / 60);
    const nextSpan = Math.max(currentSpan * factor, minimumSpan);

    if (factor > 1 && nextSpan >= fullMax - fullMin) {
      resetAxisZoom(axis);
      return;
    }

    const anchor = sourceMin + currentSpan * focalRatio;
    let nextMin = anchor - nextSpan * focalRatio;
    let nextMax = anchor + nextSpan * (1 - focalRatio);
    if (nextMin < fullMin) {
      nextMax += fullMin - nextMin;
      nextMin = fullMin;
    }
    if (nextMax > fullMax) {
      nextMin -= nextMax - fullMax;
      nextMax = fullMax;
    }

    axisOptions.min = Math.max(fullMin, nextMin);
    axisOptions.max = Math.min(fullMax, nextMax);
    chart.update('none');
    setZoomedAxes(current => ({ ...current, [axis]: true }));
  };

  const zoomAxis = (axis: AxisKey, factor: number, focalRatio = 0.5) => {
    const scale = chartRef.current?.scales[axis];
    if (!scale) return;
    applyAxisZoom(axis, scale.min, scale.max, factor, focalRatio);
  };

  const axisAtPosition = (x: number, y: number): AxisKey | null => {
    const chartArea = chartRef.current?.chartArea;
    if (!chartArea) return null;
    if (y >= chartArea.bottom && x >= chartArea.left && x <= chartArea.right) return 'x';
    if (x <= chartArea.left && y >= chartArea.top && y <= chartArea.bottom) return 'y';
    return null;
  };

  const handleWheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    if (!chart || positivePoints.length === 0) return;
    const canvasRect = chart.canvas.getBoundingClientRect();
    const cursorX = event.clientX - canvasRect.left;
    const cursorY = event.clientY - canvasRect.top;
    const pointedAxis = axisAtPosition(cursorX, cursorY);
    const insidePlot = cursorX >= chart.chartArea.left && cursorX <= chart.chartArea.right
      && cursorY >= chart.chartArea.top && cursorY <= chart.chartArea.bottom;
    if (!pointedAxis && !insidePlot) return;

    event.preventDefault();
    const axis = pointedAxis ?? 'x';
    const focalRatio = axis === 'x'
      ? (cursorX - chart.chartArea.left) / chart.chartArea.width
      : (chart.chartArea.bottom - cursorY) / chart.chartArea.height;
    zoomAxis(axis, event.deltaY < 0 ? 0.8 : 1.25, Math.min(1, Math.max(0, focalRatio)));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    if (!chart) return;
    const rect = chart.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const axis = axisAtPosition(x, y);
    const scale = axis ? chart.scales[axis] : null;
    if (!axis || !scale) return;

    dragRef.current = {
      axis,
      startCoordinate: axis === 'x' ? event.clientX : event.clientY,
      startMin: scale.min,
      startMax: scale.max,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    chart.canvas.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    if (!chart) return;
    const drag = dragRef.current;
    if (drag) {
      const coordinate = drag.axis === 'x' ? event.clientX : event.clientY;
      const delta = coordinate - drag.startCoordinate;
      applyAxisZoom(drag.axis, drag.startMin, drag.startMax, Math.exp(delta / 150));
      return;
    }

    const rect = chart.canvas.getBoundingClientRect();
    const axis = axisAtPosition(event.clientX - rect.left, event.clientY - rect.top);
    chart.canvas.style.cursor = axis === 'x' ? 'ew-resize' : axis === 'y' ? 'ns-resize' : 'default';
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (chartRef.current) chartRef.current.canvas.style.cursor = 'default';
  };

  const data = useMemo<ChartData<'bubble', OfferBubble[]>>(() => ({
    datasets: [
      ...(livePoints.length > 0 ? [{
        label: 'Live offers',
        data: buildBubbles(livePoints, maxVolume),
        backgroundColor: 'rgba(247, 147, 26, 0.62)',
        borderColor: '#f7931a',
        borderWidth: 1,
      }] : []),
      ...(pastPoints.length > 0 ? [{
        label: 'Past offers',
        data: buildBubbles(pastPoints, maxVolume),
        backgroundColor: 'rgba(88, 166, 255, 0.52)',
        borderColor: '#58a6ff',
        borderWidth: 1,
      }] : []),
    ],
  }), [livePoints, maxVolume, pastPoints]);

  const options = useMemo<ChartOptions<'bubble'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'nearest',
      intersect: true,
    },
    plugins: {
      legend: {
        display: livePoints.length > 0 && pastPoints.length > 0,
        position: 'top',
        align: 'end',
        labels: {
          color: '#8b949e',
          boxWidth: 9,
          boxHeight: 9,
          usePointStyle: true,
          pointStyle: 'circle',
          font: { size: 10 },
        },
      },
      tooltip: {
        callbacks: {
          label(context) {
            const point = (context.raw as OfferBubble).offer;
            return `${point.exchange || 'Unknown'} · ${point.direction || 'Unknown direction'}`;
          },
          afterLabel(context) {
            const point = (context.raw as OfferBubble).offer;
            return [
              `Lifecycle: ${formatLifecycle(point.lifecycle_hours)}`,
              `Premium: ${point.premium_rate_pct.toFixed(2)}%`,
              `Volume: ${point.volume_btc.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        min: fullBounds.x.min,
        max: fullBounds.x.max,
        grid: { color: 'rgba(139, 148, 158, 0.15)' },
        border: { color: 'rgba(139, 148, 158, 0.3)' },
        ticks: {
          color: '#8b949e',
          callback: value => formatLifecycle(Number(value)),
          font: { size: 10 },
        },
        title: {
          display: true,
          text: 'Offer lifecycle length',
          color: '#8b949e',
          font: { size: 10, weight: 500 },
        },
      },
      y: {
        min: fullBounds.y.min,
        max: fullBounds.y.max,
        grid: { color: 'rgba(139, 148, 158, 0.15)' },
        border: { color: 'rgba(139, 148, 158, 0.3)' },
        ticks: {
          color: '#8b949e',
          callback: value => `${Number(value).toFixed(1)}%`,
          font: { size: 10 },
        },
        title: {
          display: true,
          text: 'Premium rate',
          color: '#8b949e',
          font: { size: 10, weight: 500 },
        },
      },
    },
  }), [fullBounds.x.max, fullBounds.x.min, fullBounds.y.max, fullBounds.y.min, livePoints.length, pastPoints.length]);

  return (
    <div className="bg-bg/40 border border-border rounded-lg p-3 flex flex-col gap-2 min-h-[20rem]">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-[0.7rem] uppercase tracking-widest font-semibold text-muted">
            Lifecycle vs premium
          </h3>
          <p className="text-[0.65rem] text-muted mt-0.5">Bubble area represents offered BTC volume</p>
        </div>
        <span className="text-[0.65rem] text-muted tabular-nums mono-nums">
          {positivePoints.length} {positivePoints.length === 1 ? 'offer' : 'offers'}
        </span>
      </div>
      {positivePoints.length > 0 ? (
        <div
          className="relative flex-1 min-h-[16rem]"
          onWheel={handleWheelZoom}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <Bubble
            ref={chartRef}
            data={data}
            options={options}
            role="img"
            aria-label="Scatter bubble chart of offer lifecycle length by premium rate, sized by BTC volume"
          />
          {(zoomedAxes.x || zoomedAxes.y) && (
            <button
              type="button"
              onClick={resetView}
              title="Reset chart view"
              className="absolute top-1.5 right-3 z-10 bg-surface/90 border border-border rounded-md px-2 py-0.5 text-[0.68rem] text-muted hover:text-text hover:border-muted transition-colors"
            >
              ⟲ Reset view
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-1 min-h-[16rem] items-center justify-center text-sm text-muted">
          No positive-premium offers with lifecycle and volume data in this window.
        </div>
      )}
    </div>
  );
}
