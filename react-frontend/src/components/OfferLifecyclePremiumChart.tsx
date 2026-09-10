import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
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
import {
  expandPanBounds,
  isDefaultWindow,
  translateWindow,
  type AxisWindow,
} from './OfferLifecyclePremiumChartMath';

ChartJS.register(BubbleController, LinearScale, PointElement, Tooltip, Legend);

interface OfferBubble extends BubbleDataPoint {
  offer: OfferLifecyclePremiumPoint;
}

type AxisKey = 'x' | 'y';

interface AxisZoomDrag {
  kind: 'zoom';
  axis: AxisKey;
  startCoordinate: number;
  startMin: number;
  startMax: number;
}

interface AxisPanDrag {
  kind: 'pan-axis';
  axis: AxisKey;
  startCoordinate: number;
  start: AxisWindow;
}

interface PlotPanDrag {
  kind: 'pan';
  startX: number;
  startY: number;
  start: Record<AxisKey, AxisWindow>;
}

type ChartDrag = AxisZoomDrag | AxisPanDrag | PlotPanDrag;

export type PremiumScatterDimension = 'lifecycle' | 'volume' | 'deposit';

interface DimensionConfig {
  title: string;
  subtitle: string;
  ariaLabel: string;
  emptyMessage: string;
  xTitle: string;
  xValue: (point: OfferLifecyclePremiumPoint) => number;
  formatX: (value: number) => string;
  xFullMaxFloor: number;
  xMinimumSpanFloor: number;
  sizeValue: (point: OfferLifecyclePremiumPoint) => number;
  sizeFloor: number;
}

function formatLifecycle(hours: number): string {
  const sign = hours < 0 ? '-' : '';
  const abs = Math.abs(hours);
  if (abs < 1) return `${sign}${Math.round(abs * 60)}m`;
  if (abs < 48) return `${sign}${abs.toFixed(abs < 10 ? 1 : 0)}h`;
  return `${sign}${(abs / 24).toFixed(abs < 240 ? 1 : 0)}d`;
}

function formatVolume(btc: number): string {
  if (btc === 0) return '0';
  const sign = btc < 0 ? '-' : '';
  const abs = Math.abs(btc);
  const formatted = abs >= 10
    ? abs.toFixed(1)
    : abs >= 1
      ? abs.toFixed(2)
      : abs >= 0.01
        ? abs.toFixed(3)
        : abs.toFixed(5);
  return `${sign}${formatted.replace(/0+$/, '').replace(/\.$/, '')}`;
}

const DIMENSIONS: Record<PremiumScatterDimension, DimensionConfig> = {
  lifecycle: {
    title: 'Lifecycle vs premium',
    subtitle: 'Bubble area represents offered BTC volume',
    ariaLabel: 'Scatter bubble chart of offer lifecycle length by premium rate, sized by BTC volume',
    emptyMessage: 'No positive-premium offers with lifecycle and volume data in this window.',
    xTitle: 'Offer lifecycle length',
    xValue: point => point.lifecycle_hours,
    formatX: formatLifecycle,
    xFullMaxFloor: 1,
    xMinimumSpanFloor: 1 / 60,
    sizeValue: point => point.volume_btc,
    sizeFloor: 1e-8,
  },
  volume: {
    title: 'Volume vs premium',
    subtitle: 'Bubble area represents offer lifecycle length',
    ariaLabel: 'Scatter bubble chart of offered BTC volume by premium rate, sized by lifecycle length',
    emptyMessage: 'No positive-premium offers with volume and premium data in this window.',
    xTitle: 'Offered BTC volume',
    xValue: point => point.volume_btc,
    formatX: formatVolume,
    xFullMaxFloor: 0.01,
    xMinimumSpanFloor: 1e-4,
    sizeValue: point => point.lifecycle_hours,
    sizeFloor: 1 / 60,
  },
  deposit: {
    title: 'Counterparty deposit vs premium',
    subtitle: 'Bubble area represents offered BTC volume',
    ariaLabel: 'Scatter bubble chart of counterparty deposit in BTC by premium rate, sized by BTC volume',
    emptyMessage: 'No positive-premium offers with a counterparty deposit in this window.',
    xTitle: 'Counterparty deposit (BTC)',
    xValue: point => {
      const stake = point.counterparty_stake_btc;
      return typeof stake === 'number' && Number.isFinite(stake) && stake > 0 ? stake : Number.NaN;
    },
    formatX: formatVolume,
    xFullMaxFloor: 0.001,
    xMinimumSpanFloor: 1e-6,
    sizeValue: point => point.volume_btc,
    sizeFloor: 1e-8,
  },
};

function ChartDimensionDropdown({
  value,
  onChange,
}: {
  value: PremiumScatterDimension;
  onChange: (value: PremiumScatterDimension) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Offer scatter chart"
        onClick={() => setOpen(current => !current)}
        className="flex items-center gap-1.5 text-[0.7rem] uppercase tracking-widest font-semibold text-muted hover:text-text transition-colors"
      >
        {DIMENSIONS[value].title}
        <span className="text-[0.65rem] text-muted">▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Offer scatter chart"
          className="absolute left-0 top-full z-20 mt-1 min-w-52 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          {(Object.keys(DIMENSIONS) as PremiumScatterDimension[]).map(key => {
            const active = key === value;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={active}
                className={`flex w-full px-2.5 py-1.5 text-left text-xs transition-colors ${
                  active ? 'bg-accent/15 text-accent' : 'text-text hover:bg-bg'
                }`}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
              >
                {DIMENSIONS[key].title}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function selectPremiumScatterPoints(
  points: OfferLifecyclePremiumPoint[],
  dimensionKey: PremiumScatterDimension,
): OfferLifecyclePremiumPoint[] {
  const dimension = DIMENSIONS[dimensionKey];
  return points.filter(point => (
    point.premium_rate_pct > 0 && Number.isFinite(dimension.xValue(point))
  ));
}

function buildBubbles(
  points: OfferLifecyclePremiumPoint[],
  maxSize: number,
  dimension: DimensionConfig,
): OfferBubble[] {
  return points.map(point => ({
    x: dimension.xValue(point),
    y: point.premium_rate_pct,
    // Radius uses the square root so bubble area, rather than diameter, tracks the size metric.
    r: Math.max(3, 18 * Math.sqrt(dimension.sizeValue(point) / maxSize)),
    offer: point,
  }));
}

export function OfferPremiumScatterChart({
  points,
  dimension: dimensionKey,
  onDimensionChange,
}: {
  points: OfferLifecyclePremiumPoint[];
  dimension: PremiumScatterDimension;
  onDimensionChange?: (dimension: PremiumScatterDimension) => void;
}) {
  const dimension = DIMENSIONS[dimensionKey];
  const chartRef = useRef<ChartJS<'bubble', OfferBubble[]>>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ChartDrag | null>(null);
  const [zoomedAxes, setZoomedAxes] = useState({ x: false, y: false });
  const chartPoints = selectPremiumScatterPoints(points, dimensionKey);
  const maxSize = Math.max(...chartPoints.map(point => dimension.sizeValue(point)), dimension.sizeFloor);
  const maxX = Math.max(...chartPoints.map(point => dimension.xValue(point)), 0);
  const minPremium = Math.min(...chartPoints.map(point => point.premium_rate_pct), 0);
  const maxPremium = Math.max(...chartPoints.map(point => point.premium_rate_pct), 1);
  const premiumPadding = Math.max((maxPremium - minPremium) * 0.08, 0.05);
  const fullBounds = {
    x: { min: 0, max: Math.max(maxX * 1.08, dimension.xFullMaxFloor) },
    y: { min: Math.max(0, minPremium - premiumPadding), max: maxPremium + premiumPadding },
  };
  const panBounds = {
    x: expandPanBounds(fullBounds.x),
    y: expandPanBounds(fullBounds.y),
  };
  const livePoints = chartPoints.filter(point => point.is_live);
  const pastPoints = chartPoints.filter(point => !point.is_live);

  const publishView = () => {
    const chart = chartRef.current;
    if (!chart || !viewRef.current) return;
    viewRef.current.dataset.chartView = JSON.stringify({
      x: { min: chart.scales.x.min, max: chart.scales.x.max },
      y: { min: chart.scales.y.min, max: chart.scales.y.max },
    });
  };

  const syncViewFlags = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const next = {
      x: !isDefaultWindow({ min: chart.scales.x.min, max: chart.scales.x.max }, fullBounds.x),
      y: !isDefaultWindow({ min: chart.scales.y.min, max: chart.scales.y.max }, fullBounds.y),
    };
    setZoomedAxes(current => (current.x === next.x && current.y === next.y) ? current : next);
  };

  const writeAxisWindow = (axis: AxisKey, window: AxisWindow) => {
    const chart = chartRef.current;
    const axisOptions = chart?.options.scales?.[axis];
    if (!chart || !axisOptions) return;
    axisOptions.min = window.min;
    axisOptions.max = window.max;
  };

  const resetAxisZoom = (axis: AxisKey) => {
    const chart = chartRef.current;
    if (!chart) return;
    writeAxisWindow(axis, fullBounds[axis]);
    chart.update('none');
    publishView();
    setZoomedAxes(current => ({ ...current, [axis]: false }));
  };

  const resetView = () => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const axis of ['x', 'y'] as const) writeAxisWindow(axis, fullBounds[axis]);
    chart.update('none');
    publishView();
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
    if (!chart) return;

    const { min: fullMin, max: fullMax } = fullBounds[axis];
    const { min: panMin, max: panMax } = panBounds[axis];
    const currentSpan = sourceMax - sourceMin;
    const minimumSpan = Math.max(fullMax / 100, axis === 'x' ? dimension.xMinimumSpanFloor : 1 / 60);
    const nextSpan = Math.max(currentSpan * factor, minimumSpan);

    if (factor > 1 && nextSpan >= fullMax - fullMin) {
      resetAxisZoom(axis);
      return;
    }

    const anchor = sourceMin + currentSpan * focalRatio;
    let nextMin = anchor - nextSpan * focalRatio;
    let nextMax = anchor + nextSpan * (1 - focalRatio);
    if (nextMin < panMin) {
      nextMax += panMin - nextMin;
      nextMin = panMin;
    }
    if (nextMax > panMax) {
      nextMin -= nextMax - panMax;
      nextMax = panMax;
    }

    writeAxisWindow(axis, {
      min: Math.max(panMin, nextMin),
      max: Math.min(panMax, nextMax),
    });
    chart.update('none');
    publishView();
    setZoomedAxes(current => ({ ...current, [axis]: true }));
  };

  const applyAxisPan = (
    axis: AxisKey,
    source: AxisWindow,
    valueShift: number,
  ) => {
    const chart = chartRef.current;
    if (!chart) return;
    writeAxisWindow(axis, translateWindow(source, panBounds[axis], valueShift));
    chart.update('none');
    publishView();
    syncViewFlags();
  };

  const applyPlotPan = (start: Record<AxisKey, AxisWindow>, dx: number, dy: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const { width, height } = chart.chartArea;
    if (width > 0) {
      writeAxisWindow('x', translateWindow(start.x, panBounds.x, -(dx / width) * (start.x.max - start.x.min)));
    }
    if (height > 0) {
      writeAxisWindow('y', translateWindow(start.y, panBounds.y, (dy / height) * (start.y.max - start.y.min)));
    }
    chart.update('none');
    publishView();
    syncViewFlags();
  };

  const zoomAxis = (axis: AxisKey, factor: number, focalRatio = 0.5) => {
    const scale = chartRef.current?.scales[axis];
    if (!scale) return;
    applyAxisZoom(axis, scale.min, scale.max, factor, focalRatio);
  };

  // Wheel over an axis zooms that axis; wheel over the plot zooms both toward
  // the cursor. Dragging an axis at the default view scales it; once the view
  // has moved, dragging that axis or the plot pans, including past zero.

  const axisAtPosition = (x: number, y: number): AxisKey | null => {
    const chartArea = chartRef.current?.chartArea;
    if (!chartArea) return null;
    if (y >= chartArea.bottom && x >= chartArea.left && x <= chartArea.right) return 'x';
    // Include the axis line and a sliver of the plot so the y scale is as easy
    // to grab as the x labels below the chart.
    if (x <= chartArea.left + 12 && y >= chartArea.top && y <= chartArea.bottom) return 'y';
    return null;
  };

  const insidePlot = (x: number, y: number): boolean => {
    const chartArea = chartRef.current?.chartArea;
    if (!chartArea) return false;
    return x >= chartArea.left && x <= chartArea.right && y >= chartArea.top && y <= chartArea.bottom;
  };

  const handleWheelZoom = (event: WheelEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    if (!chart || chartPoints.length === 0) return;
    const canvasRect = chart.canvas.getBoundingClientRect();
    const cursorX = event.clientX - canvasRect.left;
    const cursorY = event.clientY - canvasRect.top;
    const pointedAxis = axisAtPosition(cursorX, cursorY);
    if (!pointedAxis && !insidePlot(cursorX, cursorY)) return;

    event.preventDefault();
    const xScale = chart.scales.x;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      if (xScale && chart.chartArea.width > 0) {
        const span = xScale.max - xScale.min;
        applyAxisPan('x', { min: xScale.min, max: xScale.max }, (event.deltaX / chart.chartArea.width) * span);
      }
      return;
    }

    const factor = event.deltaY < 0 ? 0.8 : 1.25;
    const clampRatio = (value: number) => Math.min(1, Math.max(0, value));
    if (pointedAxis) {
      const focalRatio = pointedAxis === 'x'
        ? (cursorX - chart.chartArea.left) / chart.chartArea.width
        : (chart.chartArea.bottom - cursorY) / chart.chartArea.height;
      zoomAxis(pointedAxis, factor, clampRatio(focalRatio));
      return;
    }

    zoomAxis('x', factor, clampRatio((cursorX - chart.chartArea.left) / chart.chartArea.width));
    zoomAxis('y', factor, clampRatio((chart.chartArea.bottom - cursorY) / chart.chartArea.height));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    if (!chart) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = chart.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const axis = axisAtPosition(x, y);
    const scale = axis ? chart.scales[axis] : null;

    if (axis && scale) {
      const window = { min: scale.min, max: scale.max };
      if (!isDefaultWindow(window, fullBounds[axis])) {
        dragRef.current = {
          kind: 'pan-axis',
          axis,
          startCoordinate: axis === 'x' ? event.clientX : event.clientY,
          start: window,
        };
        chart.canvas.style.cursor = 'grabbing';
      } else {
        dragRef.current = {
          kind: 'zoom',
          axis,
          startCoordinate: axis === 'x' ? event.clientX : event.clientY,
          startMin: scale.min,
          startMax: scale.max,
        };
        chart.canvas.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
      }
    } else if (insidePlot(x, y)) {
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      dragRef.current = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        start: {
          x: { min: xScale.min, max: xScale.max },
          y: { min: yScale.min, max: yScale.max },
        },
      };
      chart.canvas.style.cursor = 'grabbing';
    } else {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    if (!chart) return;
    const drag = dragRef.current;
    if (drag?.kind === 'zoom') {
      const coordinate = drag.axis === 'x' ? event.clientX : event.clientY;
      applyAxisZoom(drag.axis, drag.startMin, drag.startMax, Math.exp((coordinate - drag.startCoordinate) / 150));
      return;
    }
    if (drag?.kind === 'pan-axis') {
      const pixelSpan = drag.axis === 'x' ? chart.chartArea.width : chart.chartArea.height;
      if (pixelSpan <= 0) return;
      const pixelDelta = (drag.axis === 'x' ? event.clientX : event.clientY) - drag.startCoordinate;
      const span = drag.start.max - drag.start.min;
      const valueShift = drag.axis === 'x'
        ? -(pixelDelta / pixelSpan) * span
        : (pixelDelta / pixelSpan) * span;
      applyAxisPan(drag.axis, drag.start, valueShift);
      return;
    }
    if (drag?.kind === 'pan') {
      applyPlotPan(drag.start, event.clientX - drag.startX, event.clientY - drag.startY);
      return;
    }

    const rect = chart.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const axis = axisAtPosition(x, y);
    if (axis) {
      const hovered = chart.scales[axis];
      const atDefault = hovered == null || isDefaultWindow({ min: hovered.min, max: hovered.max }, fullBounds[axis]);
      chart.canvas.style.cursor = atDefault ? (axis === 'x' ? 'ew-resize' : 'ns-resize') : 'grab';
      return;
    }
    chart.canvas.style.cursor = insidePlot(x, y) ? 'grab' : 'default';
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (chartRef.current) chartRef.current.canvas.style.cursor = 'default';
  };

  const data = useMemo<ChartData<'bubble', OfferBubble[]>>(() => ({
    datasets: [
      ...(livePoints.length > 0 ? [{
        label: 'Live offers',
        data: buildBubbles(livePoints, maxSize, dimension),
        backgroundColor: 'rgba(247, 147, 26, 0.62)',
        borderColor: '#f7931a',
        borderWidth: 1,
      }] : []),
      ...(pastPoints.length > 0 ? [{
        label: 'Past offers',
        data: buildBubbles(pastPoints, maxSize, dimension),
        backgroundColor: 'rgba(88, 166, 255, 0.52)',
        borderColor: '#58a6ff',
        borderWidth: 1,
      }] : []),
    ],
  }), [dimension, livePoints, maxSize, pastPoints]);

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
              `Volume: ${formatVolume(point.volume_btc)} BTC`,
              ...(typeof point.counterparty_stake_btc === 'number' && point.counterparty_stake_btc > 0
                ? [`Counterparty deposit: ${formatVolume(point.counterparty_stake_btc)} BTC`]
                : []),
            ];
          },
        },
      },
    },
    scales: {
      x: {
        min: fullBounds.x.min,
        max: fullBounds.x.max,
        grid: { color: 'rgba(139, 148, 158, 0.15)' },
        border: { color: 'rgba(139, 148, 158, 0.3)' },
        ticks: {
          color: '#8b949e',
          callback: value => dimension.formatX(Number(value)),
          font: { size: 10 },
        },
        title: {
          display: true,
          text: dimension.xTitle,
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
  }), [dimension, fullBounds.x.max, fullBounds.x.min, fullBounds.y.max, fullBounds.y.min, livePoints.length, pastPoints.length]);

  return (
    <div className="bg-bg/40 border border-border rounded-lg p-3 flex flex-col gap-2 min-h-[20rem]">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          {onDimensionChange ? (
            <ChartDimensionDropdown value={dimensionKey} onChange={onDimensionChange} />
          ) : (
            <h3 className="text-[0.7rem] uppercase tracking-widest font-semibold text-muted">
              {dimension.title}
            </h3>
          )}
          <p className="text-[0.65rem] text-muted mt-0.5">{dimension.subtitle}</p>
        </div>
        <span className="text-[0.65rem] text-muted tabular-nums mono-nums">
          {chartPoints.length} {chartPoints.length === 1 ? 'offer' : 'offers'}
        </span>
      </div>
      {chartPoints.length > 0 ? (
        <div
          ref={viewRef}
          data-testid={`offer-premium-chart-${dimensionKey}`}
          className="relative flex-1 min-h-[16rem] touch-none"
          onWheel={handleWheelZoom}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
        >
          <Bubble
            ref={chartRef}
            data={data}
            options={options}
            role="img"
            aria-label={dimension.ariaLabel}
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
          {dimension.emptyMessage}
        </div>
      )}
    </div>
  );
}

export function OfferLifecyclePremiumChart({ points }: { points: OfferLifecyclePremiumPoint[] }) {
  return <OfferPremiumScatterChart points={points} dimension="lifecycle" />;
}

export function OfferVolumePremiumChart({ points }: { points: OfferLifecyclePremiumPoint[] }) {
  return <OfferPremiumScatterChart points={points} dimension="volume" />;
}
