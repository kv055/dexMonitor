import { test as base, expect, type Page, type Locator } from '@playwright/test';
import {
  FIXED_TIME,
  MOCK_STATS,
  MOCK_LIVE_OFFERS,
  MOCK_PAST_OFFERS,
  MOCK_PAST_OFFER_LIFECYCLES,
  MOCK_OHLC_DATA,
  MOCK_PAYMENT_METHOD_GROUPS,
  MOCK_PAST_ORDER_STATS,
  MOCK_GENERAL_STATS_LIFETIMES,
  MOCK_GENERAL_STATS_OVERVIEW,
  MOCK_GENERAL_STATS_PAST_PREMIUMS,
  MOCK_GENERAL_STATS_PAYMENT_METHODS,
  MOCK_SNAPSHOT_LOG_COMPACT,
  MOCK_SNAPSHOT_LOG_DETAIL,
  MOCK_TRADE_COST_CONFIG,
} from './mock-data';

type Fixtures = {
  mockApi: void;
};

export const test = base.extend<Fixtures>({
  mockApi: [async ({ page }, use) => {
    // Freeze Date.now() for deterministic timestamps
    await page.addInitScript(`{
      const FIXED = ${FIXED_TIME};
      const _OrigDate = Date;
      const _origNow = Date.now;
      Date.now = () => FIXED;
      // Override new Date() with no args to use frozen time
      const handler = {
        construct(target, args) {
          if (args.length === 0) return new target(FIXED);
          return new target(...args);
        },
      };
      globalThis.Date = new Proxy(_OrigDate, handler);
      Object.assign(globalThis.Date, _OrigDate);
      globalThis.Date.now = () => FIXED;
      globalThis.Date.prototype = _OrigDate.prototype;
    }`);

    await page.routeWebSocket('**/ws/live_offers*', ws => {
      ws.close();
    });

    await page.routeWebSocket('**/ws.kraken.com/**', ws => {
      ws.close();
    });

    // Auth: the app calls /api/auth/me on mount and renders the login wall on
    // 401. Mock an authenticated user so the dashboard renders for every test.
    await page.route('**/api/auth/me', route =>
      route.fulfill({ json: { username: 'e2e' } }),
    );
    await page.route('**/api/auth/registration_available', route =>
      route.fulfill({ json: { available: false } }),
    );

    // Mock REST API endpoints
    await page.route('**/api/stats*', route =>
      route.fulfill({ json: MOCK_STATS }),
    );
    await page.route('**/api/past_offers/*/lifecycle', route => {
      const id = Number(new URL(route.request().url()).pathname.match(/\/api\/past_offers\/(\d+)\/lifecycle$/)?.[1]);
      return route.fulfill({ json: MOCK_PAST_OFFER_LIFECYCLES[id] ?? [] });
    });
    await page.route('**/api/past_offers*', route =>
      route.fulfill({ json: MOCK_PAST_OFFERS }),
    );
    await page.route('**/api/ohlc*', route =>
      route.fulfill({ json: MOCK_OHLC_DATA }),
    );
    await page.route('**/api/live_offers*', route =>
      route.fulfill({ json: MOCK_LIVE_OFFERS }),
    );
    await page.route('**/api/trade_cost_config', route =>
      route.fulfill({ json: MOCK_TRADE_COST_CONFIG }),
    );
    await page.route('**/api/payment_method_groups', route =>
      route.fulfill({ json: MOCK_PAYMENT_METHOD_GROUPS }),
    );
    await page.route('**/api/past_order_stats*', route =>
      route.fulfill({ json: MOCK_PAST_ORDER_STATS }),
    );
    await page.route('**/api/past_profitable_orders*', route =>
      route.fulfill({ json: [] }),
    );
    await page.route('**/api/general_stats/overview*', route =>
      route.fulfill({ json: MOCK_GENERAL_STATS_OVERVIEW }),
    );
    await page.route('**/api/general_stats/past_premiums*', route =>
      route.fulfill({ json: MOCK_GENERAL_STATS_PAST_PREMIUMS }),
    );
    await page.route('**/api/general_stats/lifetimes*', route =>
      route.fulfill({ json: MOCK_GENERAL_STATS_LIFETIMES }),
    );
    await page.route('**/api/general_stats/payment_methods*', route =>
      route.fulfill({ json: MOCK_GENERAL_STATS_PAYMENT_METHODS }),
    );
    await page.route(/\/api\/snapshot-log(?:\/\d+)?(?:\?.*)?$/, route => {
      const url = new URL(route.request().url());
      const id = Number(url.pathname.match(/\/api\/snapshot-log\/(\d+)$/)?.[1]);
      if (id) {
        return route.fulfill({ json: MOCK_SNAPSHOT_LOG_DETAIL[id] ?? { error: 'not found' }, status: MOCK_SNAPSHOT_LOG_DETAIL[id] ? 200 : 404 });
      }
      return route.fulfill({ json: MOCK_SNAPSHOT_LOG_COMPACT });
    });

    await use();
  }, { auto: true }],
});

export { expect };

/**
 * Wait for a chart's canvas to be fully rendered.
 */
export async function waitForChartReady(container: Locator, page: Page) {
  const spinner = container.locator('text=Loading');
  await spinner.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

  // Wait for first canvas to exist and be visible
  const canvas = container.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 10_000 });

  // Allow animation and transitions to settle
  await page.waitForTimeout(600);
}

/**
 * Navigate to the app and wait for initial data to load.
 */
export async function gotoAndWaitForData(page: Page) {
  const liveOffersResponse = page.waitForResponse(resp =>
    resp.url().includes('/api/live_offers') && resp.status() === 200,
  );
  await page.goto('/');
  // Wait for offers table to populate (REST polling fallback)
  await liveOffersResponse;
  // Small delay for React to process state updates
  await page.waitForTimeout(300);
}

/**
 * Click an element via JS DOM `.click()`, bypassing Playwright's hit-test.
 * Needed when chart canvases overlay control panel buttons in the z-stack.
 */
export async function jsClick(locator: Locator) {
  await locator.evaluate(el => (el as HTMLElement).click());
}

/**
 * Fill an input via JS, triggering React's synthetic onChange.
 * Needed when chart canvases overlay inputs in the z-stack.
 */
export async function jsFill(locator: Locator, value: string) {
  await locator.evaluate((el, val) => {
    const input = el as HTMLInputElement;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    )!.set!;
    nativeInputValueSetter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Locator for the Control Panel container (scoped to avoid table header collisions) */
export function controlPanel(page: Page) {
  return page.locator('.bg-surface').filter({ hasText: 'Control Panel' });
}

/** Locator for the OHLC chart panel */
export function ohlcPanel(page: Page) {
  return page.locator('.bg-surface').filter({ hasText: 'DEX Premium Offer Overlay' });
}

/** Locator for the Depth chart panel */
export function depthPanel(page: Page) {
  return page.locator('.bg-surface').filter({ hasText: 'Orderbook Depth' });
}

/** Locator for the Offers table panel */
export function offersPanel(page: Page) {
  return page.locator('.bg-surface').filter({
    has: page.getByRole('heading', { name: 'Offers', exact: true }),
  }).first();
}
