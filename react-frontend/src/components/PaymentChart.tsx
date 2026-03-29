import { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const PALETTE = [
  '#f7931a', '#3fb950', '#bc8cff', '#58a6ff', '#f85149',
  '#d29922', '#39d353', '#db61a2', '#79c0ff', '#e3b341', '#4a4f58',
];

export function PaymentChart() {
  const { filteredOffers: offers, loading } = useFilters();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !offers.length) return;

    const counts: Record<string, number> = {};
    offers.forEach(o => {
      const pm = o.payment_method || 'Unknown';
      counts[pm] = (counts[pm] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 10);
    const rest = sorted.slice(10);
    if (rest.length > 0) top.push(['Others', rest.reduce((s, e) => s + e[1], 0)]);

    const labels = top.map(e => e[0]);
    const data = top.map(e => e[1]);

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
            c.fillStyle = 'rgba(255,255,255,0.92)';
            c.textAlign = 'left';
            c.fillText(name, baseX + pad, barCenterY);
            c.font = fontLight;
            c.fillStyle = 'rgba(255,255,255,0.55)';
            c.textAlign = 'right';
            c.fillText(count, barRight - pad, barCenterY);
          } else {
            c.font = font;
            c.fillStyle = '#8b949e';
            c.textAlign = 'left';
            c.fillText(name, barRight + pad, barCenterY);
            c.font = fontLight;
            c.fillStyle = '#606670';
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
          backgroundColor: PALETTE.slice(0, labels.length),
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
  }, [offers]);

  return (
    <div className="relative flex-1 min-h-40">
      {loading && <LoadingSpinner label="Loading offers" />}
      <canvas ref={canvasRef} style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.3s ease' }} />
    </div>
  );
}
