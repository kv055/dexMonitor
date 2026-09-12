import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';
import type { Page } from '@playwright/test';

type AxisView = { min: number; max: number };
type ChartView = { x: AxisView; y: AxisView };

async function readLifecycleChartView(page: Page): Promise<ChartView> {
  const raw = await page.getByTestId('offer-premium-chart-lifecycle').getAttribute('data-chart-view');
  if (!raw) throw new Error('lifecycle chart view is missing');
  return JSON.parse(raw) as ChartView;
}

test.describe('Statistics', () => {
  // Regression: the Statistics tab used to hang on its loading spinner forever
  // in dev — StrictMode's double-mount aborted the first /api/statistics fetch
  // and the reload deduped onto the aborted (never-dispatching) promise.
  test('switches between live, past, and shared views', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'Statistics', exact: true }).click();

    const statsFilters = page.getByRole('complementary', { name: 'Statistics filters' });
    await expect(statsFilters).toBeVisible();
    await expect(statsFilters.getByText('Reference source')).toHaveCount(0);
    await expect(statsFilters.getByText(/BTC\/.+ — /)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeVisible();
    await expect(page.getByTestId('exchanges-live-card')).toBeVisible();
    await expect(page.getByTestId('payment-methods-card')).toBeVisible();
    for (const cardId of ['exchanges-live-card', 'payment-methods-card'] as const) {
      const card = page.getByTestId(cardId);
      const pie = card.getByTestId('breakdown-pie-graphic');
      await expect.poll(async () => {
        const cardBox = await card.boundingBox();
        const pieBox = await pie.boundingBox();
        if (!cardBox || !pieBox) return 'missing';
        const pad = 1.5;
        const inside = pieBox.x >= cardBox.x - pad
          && pieBox.y >= cardBox.y - pad
          && pieBox.x + pieBox.width <= cardBox.x + cardBox.width + pad
          && pieBox.y + pieBox.height <= cardBox.y + cardBox.height + pad;
        return inside ? 'inside' : `overflow card=${JSON.stringify(cardBox)} pie=${JSON.stringify(pieBox)}`;
      }).toBe('inside');
    }
    await expect(page.getByRole('heading', { name: 'All Offers', exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Timeframe', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Duration', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Premium', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Range', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Past Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Past Offers', exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Timeframe', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Duration', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Premium mode', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Premium', { exact: true })).toHaveCount(0);
    await expect(statsFilters.getByText('Range', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'All Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All Offers', exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Timeframe', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Duration', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Premium', { exact: true })).toBeVisible();
    await expect(statsFilters.getByText('Range', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Live Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Live Offers', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /offer lifecycle length by premium rate/i })).toBeVisible();
    await expect(page.getByRole('img', { name: /offered btc volume by premium rate/i })).toHaveCount(0);
    await expect(page.getByText('1 offer', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Offer scatter chart' }).click();
    await page.getByRole('option', { name: 'Volume vs premium' }).click();
    await expect(page.getByRole('img', { name: /offered btc volume by premium rate/i })).toBeVisible();
    await page.getByRole('button', { name: 'Offer scatter chart' }).click();
    await page.getByRole('option', { name: 'Counterparty deposit (BTC) vs premium' }).click();
    await expect(page.getByRole('img', { name: /counterparty deposit in BTC by premium rate/i })).toBeVisible();
    await expect(page.getByText('1 offer', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Offer scatter chart' }).click();
    await page.getByRole('option', { name: 'Counterparty deposit (%) vs premium' }).click();
    await expect(page.getByRole('img', { name: /counterparty deposit percent by premium rate/i })).toBeVisible();
    await expect(page.getByText('1 offer', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Offer scatter chart' }).click();
    await page.getByRole('option', { name: 'Lifecycle vs premium' }).click();
    await expect(page.getByRole('img', { name: /offer lifecycle length by premium rate/i })).toBeVisible();
    const lifecycleChart = page.getByRole('img', { name: /offer lifecycle length by premium rate/i });
    const chartBounds = await lifecycleChart.boundingBox();
    if (!chartBounds) throw new Error('lifecycle chart has no bounds');
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.65, chartBounds.y + chartBounds.height - 8);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.45, chartBounds.y + chartBounds.height - 8);
    await page.mouse.up();
    await expect(page.getByRole('button', { name: '⟲ Reset view' })).toBeVisible();
    await expect.poll(async () => (
      page.getByTestId('offer-premium-chart-lifecycle').getAttribute('data-chart-view')
    )).toBeTruthy();

    const zoomed = await readLifecycleChartView(page);
    const zoomedSpan = zoomed.x.max - zoomed.x.min;
    // A second drag on the x-axis must pan the zoomed window, not zoom around center.
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.65, chartBounds.y + chartBounds.height - 8);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.35, chartBounds.y + chartBounds.height - 8, { steps: 8 });
    await page.mouse.up();
    const afterAxisPan = await readLifecycleChartView(page);
    expect(afterAxisPan.x.max - afterAxisPan.x.min).toBeCloseTo(zoomedSpan, 2);
    expect(afterAxisPan.x.min).toBeGreaterThan(zoomed.x.min);

    const beforePlotPan = afterAxisPan;
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.5, chartBounds.y + chartBounds.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.72, chartBounds.y + chartBounds.height * 0.45, { steps: 8 });
    await page.mouse.up();
    const afterPlotPan = await readLifecycleChartView(page);
    expect(afterPlotPan.x.max - afterPlotPan.x.min).toBeCloseTo(zoomedSpan, 2);
    expect(afterPlotPan.x.min).toBeLessThan(beforePlotPan.x.min);

    await page.getByRole('button', { name: '⟲ Reset view' }).click();
    await page.mouse.move(chartBounds.x + 20, chartBounds.y + chartBounds.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + 20, chartBounds.y + chartBounds.height * 0.4);
    await page.mouse.up();
    await expect(page.getByRole('button', { name: '⟲ Reset view' })).toBeVisible();
    await expect.poll(async () => (
      page.getByTestId('offer-premium-chart-lifecycle').getAttribute('data-chart-view')
    )).toBeTruthy();

    const yZoomed = await readLifecycleChartView(page);
    const ySpan = yZoomed.y.max - yZoomed.y.min;
    await page.mouse.move(chartBounds.x + 20, chartBounds.y + chartBounds.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + 20, chartBounds.y + chartBounds.height * 0.3, { steps: 8 });
    await page.mouse.up();
    const afterYAxisPan = await readLifecycleChartView(page);
    expect(afterYAxisPan.y.max - afterYAxisPan.y.min).toBeCloseTo(ySpan, 2);
    expect(afterYAxisPan.y.min).toBeLessThan(yZoomed.y.min);

    await page.mouse.move(chartBounds.x + chartBounds.width * 0.5, chartBounds.y + chartBounds.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.5, chartBounds.y + chartBounds.height * 0.62, { steps: 8 });
    await page.mouse.up();
    const afterYPlotPan = await readLifecycleChartView(page);
    expect(afterYPlotPan.y.max - afterYPlotPan.y.min).toBeCloseTo(ySpan, 2);
    expect(afterYPlotPan.y.min).toBeGreaterThan(afterYAxisPan.y.min);

    await page.getByRole('button', { name: '⟲ Reset view' }).click();
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.55, chartBounds.y + chartBounds.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.95, chartBounds.y + chartBounds.height * 0.5, { steps: 8 });
    await page.mouse.up();
    const pastOrigin = await readLifecycleChartView(page);
    expect(pastOrigin.x.min).toBeLessThan(0);

    await expect(page.locator('text=Loading statistics')).toHaveCount(0);
    await expect(page.getByText('12 active · 2 exchanges')).toBeVisible();

    await page.getByRole('button', { name: 'Past Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Past Offers', exact: true })).toBeVisible();
    await expect(page.getByText('34 closed summary in window')).toBeVisible();

    await page.getByRole('button', { name: 'All Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All Offers', exact: true })).toBeVisible();
    await expect(page.getByText('46 in last 168h (live + past)')).toBeVisible();
    await expect(page.getByText('3 offers', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Offer scatter chart' }).click();
    await page.getByRole('option', { name: 'Counterparty deposit (BTC) vs premium' }).click();
    await expect(page.getByRole('img', { name: /counterparty deposit in BTC by premium rate/i })).toBeVisible();
    await expect(page.getByText('2 offers', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Offer scatter chart' }).click();
    await page.getByRole('option', { name: 'Counterparty deposit (%) vs premium' }).click();
    await expect(page.getByRole('img', { name: /counterparty deposit percent by premium rate/i })).toBeVisible();
    await expect(page.getByText('2 offers', { exact: true })).toHaveCount(1);
  });
});
