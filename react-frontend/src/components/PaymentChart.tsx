import { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const PALETTE = [
  '#f7931a', '#3fb950', '#bc8cff', '#58a6ff', '#f85149',
  '#d29922', '#39d353', '#db61a2', '#79c0ff', '#e3b341', '#4a4f58',
];

interface Props {
  theme: 'dark' | 'light';
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function PaymentChart({ theme }: Props) {
  const { filteredOffers: offers, loading, filters, groups } = useFilters();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !offers.length) return;

    // Count offers per individual payment method.
    const methodCounts: Record<string, number> = {};
    offers.forEach(o => {
      const pm = o.payment_method || 'Unknown';
      methodCounts[pm] = (methodCounts[pm] || 0) + 1;
    });

    const activeGroup = groups.find(g => g.name === filters.payment);
    let labels: string[];
    let data: number[];
    let colors: string[];

    if (activeGroup) {
      // Drill-down: show individual methods within the selected group.
      const entries = activeGroup.methods
        .map(m => [m, methodCounts[m] ?? 0] as [string, number])
        .filter(([, c]) => c > 0)
        .sort((a, b) => b[1] - a[1]);
      const groupIdx = groups.findIndex(g => g.name === activeGroup.name);
      const baseColor = PALETTE[groupIdx % PALETTE.length];
      labels = entries.map(([m]) => m);
      data = entries.map(([, c]) => c);
      colors = labels.map(() => baseColor);
    } else {
      // Default: show one bar per group + "Other" for ungrouped methods.
      const groupedSet = new Set(groups.flatMap(g => g.methods));
      let otherCount = 0;
      Object.entries(methodCounts).forEach(([m, c]) => {
        if (!groupedSet.has(m)) otherCount += c;
      });

      const groupEntries = groups
        .map((g, i) => ({
          label: g.display_name,
          count: g.methods.reduce((s, m) => s + (methodCounts[m] ?? 0), 0),
          color: PALETTE[i % PALETTE.length],
        }))
        .filter(g => g.count > 0)
        .sort((a, b) => b.count - a.count);

      labels = groupEntries.map(g => g.label);
      data = groupEntries.map(g => g.count);
      colors = groupEntries.map(g => g.color);

      // If no groups loaded yet, fall back to top individual methods.
      if (groups.length === 0) {
        const sorted = Object.entries(methodCounts).sort((a, b) => b[1] - a[1]);
        const top = sorted.slice(0, 10);
        const rest = sorted.slice(10);
        const restCount = rest.reduce((s, [, c]) => s + c, 0) + otherCount;
        if (restCount > 0) top.push(['Others', restCount]);
        labels = top.map(([m]) => m);
        data = top.map(([, c]) => c);
        colors = PALETTE.slice(0, labels.length);
      } else if (otherCount > 0) {
        labels.push('Other');
        data.push(otherCount);
        colors.push(PALETTE[groupEntries.length % PALETTE.length]);
      }
    }
    const textStrong = cssVar('--app-text', '#e6edf3');
    const muted = cssVar('--app-muted', '#8b949e');
    const subtle = cssVar('--app-subtle', '#606670');

    const insideLabels = {
      id: 'insideLabels',
      afterDraw(chart: Chart) {
        const { ctx: c, scales } = chart as unknown as { ctx: CanvasRenderingContext2D; scales: Record<string, { getPixelForValue: (v: number) => number }> };
        const meta = chart.getDatasetMeta(0);
        const baseX = scales.x.getPixelForValue(0);
        const pad = 8;
        const font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
        const fontLight = '11px -apple-system, BlinkMacSystemFont, sans-serif';
        c.save();
        c.textBaseline = 'middle';
        (meta.data as unknown as Array<{ x: number; y: number }>).forEach((bar, i) => {
          const barRight = bar.x;
          const barCenterY = bar.y;
          const barW = barRight - baseX;
          const name = labels[i];
          const count = String(data[i]);
          c.font = font;
          const nameW = c.measureText(name).width;
          c.font = fontLight;
          const countW = c.measureText(count).width;
          const totalNeeded = pad + nameW + 6 + countW + pad;
          if (barW >= totalNeeded) {
            c.font = font;
            c.fillStyle = textStrong;
            c.textAlign = 'left';
            c.fillText(name, baseX + pad, barCenterY);
            c.font = fontLight;
            c.fillStyle = muted;
            c.textAlign = 'right';
            c.fillText(count, barRight - pad, barCenterY);
          } else {
            c.font = font;
            c.fillStyle = muted;
            c.textAlign = 'left';
            c.fillText(name, barRight + pad, barCenterY);
            c.font = fontLight;
            c.fillStyle = subtle;
            c.fillText(count, barRight + pad + nameW + 6, barCenterY);
          }
        });
        c.restore();
      },
    };

    if (chartRef.current) chartRef.current.destroy();

    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      plugins: [insideLabels],
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderRadius: 5,
          borderSkipped: false,
          barPercentage: 0.82,
          categoryPercentage: 0.9,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.raw} offers` } },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
        layout: { padding: { top: 2, bottom: 2, left: 2, right: 2 } },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [offers, theme, filters.payment, groups]);

  return (
    <div className="relative flex-1 min-h-40">
      {loading && <LoadingSpinner label="Loading offers" />}
      <canvas ref={canvasRef} style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.3s ease' }} />
    </div>
  );
}
