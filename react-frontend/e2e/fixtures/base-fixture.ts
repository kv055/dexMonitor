import { test as base, expect, type Page, type Locator } from '@playwright/test';
import {
  FIXED_TIME,
  MOCK_STATS,
  MOCK_LIVE_OFFERS,
  MOCK_LIVE_OFFER_LIFECYCLES,
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
  MOCK_TRADING_ACCOUNTS,
  MOCK_TRADING_PAYMENT_METHODS,
  MOCK_BISQ_PAYMENT_ACCOUNTS,
  MOCK_CEX_DEPOSIT_ADDRESSES,
  MOCK_CEX_BALANCES,
  MOCK_TELEGRAM_CONFIG,
  MOCK_STATISTICS,
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

    // Blanket guards (registered first — later, more specific routes win):
    // secondary tabs fetch mm-controller/trading endpoints no test asserts on.
    // Left unmocked they fall through to a real local backend whose 401
    // triggers the app-wide auth:unauthorized logout and the login wall.
    await page.route('**/api/trading/**', route => route.fulfill({ json: [] }));
    await page.route('**/api/mm-controller/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/mm-controller/transactions*', route =>
      route.fulfill({ json: { transactions: [], total: 0, limit: 20, offset: 0 } }),
    );

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
    // NOTE: the '**/api/live_offers*' glob below does NOT match this path (its
    // trailing '*' cannot cross '/'), so lifecycle requests need their own route.
    await page.route('**/api/live_offers/*/lifecycle*', route => {
      const id = Number(new URL(route.request().url()).pathname.match(/\/api\/live_offers\/(\d+)\/lifecycle$/)?.[1]);
      return route.fulfill({ json: MOCK_LIVE_OFFER_LIFECYCLES[id] ?? [] });
    });
    await page.route('**/api/live_offers*', route =>
      route.fulfill({ json: MOCK_LIVE_OFFERS }),
    );
    await page.route('**/api/trade_cost_config', route =>
      route.fulfill({ json: MOCK_TRADE_COST_CONFIG }),
    );
    await page.route('**/api/payment_method_groups', route =>
      route.fulfill({ json: MOCK_PAYMENT_METHOD_GROUPS }),
    );
    let paymentMethodsState = structuredClone(MOCK_TRADING_PAYMENT_METHODS);
    await page.route('**/api/trading/accounts', route =>
      route.fulfill({ json: MOCK_TRADING_ACCOUNTS }),
    );
    await page.route('**/api/trading/payment_methods', route =>
      route.fulfill({ json: paymentMethodsState }),
    );
    await page.route('**/api/trading/payment_methods/*', async route => {
      if (route.request().method() !== 'PUT') {
        await route.fulfill({ json: { ok: true } });
        return;
      }
      const id = Number(new URL(route.request().url()).pathname.match(/\/api\/trading\/payment_methods\/(\d+)$/)?.[1]);
      const payload = await route.request().postDataJSON() as { priority?: number };
      paymentMethodsState = {
        payment_methods: paymentMethodsState.payment_methods.map(row =>
          row.id === id
            ? {
                ...row,
                priority: payload.priority ?? row.priority,
                updated_at: new Date(FIXED_TIME).toISOString(),
              }
            : row,
        ),
      };
      await route.fulfill({ json: paymentMethodsState });
    });
    await page.route('**/api/trading/accounts/*/cex/deposit-addresses', route => {
      const id = Number(new URL(route.request().url()).pathname.match(/\/api\/trading\/accounts\/(\d+)\/cex\/deposit-addresses$/)?.[1]);
      return route.fulfill({ json: MOCK_CEX_DEPOSIT_ADDRESSES[id] ?? [] });
    });
    await page.route('**/api/trading/accounts/*/cex/balances', route => {
      const id = Number(new URL(route.request().url()).pathname.match(/\/api\/trading\/accounts\/(\d+)\/cex\/balances$/)?.[1]);
      return route.fulfill({ json: MOCK_CEX_BALANCES[id] ?? { fiat: [], source: 'mock' } });
    });
    await page.route('**/api/trading/accounts/*/cex/withdrawal-addresses', route =>
      route.fulfill({ json: [] }),
    );
    await page.route('**/api/trading/accounts/*/cex/hedge-positions', route =>
      route.fulfill({ json: { active: [], past: [] } }),
    );
    await page.route('**/api/trading/accounts/*/cex/spot-trades*', route =>
      route.fulfill({ json: [] }),
    );
    await page.route('**/api/mm-controller/bisq/payment-accounts', route =>
      route.fulfill({ json: MOCK_BISQ_PAYMENT_ACCOUNTS }),
    );
    await page.route('**/api/mm-controller/lnd/wallet/state', route =>
      route.fulfill({ json: { lnd_reachable: true, lnd_state: 'RUNNING', wallet_exists: true, password_set: true, client_ready: true, can_create: false } }),
    );
    await page.route('**/api/mm-controller/lnd/wallet', route =>
      route.fulfill({
        json: {
          node: {
            identity_pubkey: '02abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567',
            alias: 'Desk LND',
            num_peers: 1,
            num_active_channels: 1,
            synced_to_chain: true,
            synced_to_graph: true,
            block_height: 900000,
          },
          peers: [],
          channels: [],
          pending_channels: [],
          addresses: [],
          checked_at: new Date(FIXED_TIME).toISOString(),
        },
      }),
    );
    await page.route('**/api/mm-controller/telegram/config', route =>
      route.fulfill({ json: MOCK_TELEGRAM_CONFIG }),
    );
    await page.route('**/api/statistics', route =>
      route.fulfill({
        json: MOCK_STATISTICS,
        headers: { 'X-Stats-Cache': 'miss', 'X-Stats-Built-At': new Date(FIXED_TIME).toISOString() },
      }),
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

/**
 * The Control Panel now lives in the settings overlay ("Monitor Filters"
 * section) opened via the header's gear button. Tests must call
 * openSettings() before using controlPanel(), and closeSettings() before
 * asserting on the dashboard behind the overlay backdrop.
 */
export async function openSettings(page: Page) {
  await jsClick(page.locator('button[title="Settings"]'));
  await controlPanel(page).waitFor({ state: 'visible' });
}

export async function closeSettings(page: Page) {
  const overlay = page.locator('aside').filter({ hasText: 'Monitor Filters' });
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await overlay.waitFor({ state: 'hidden' });
}

/** Locator for the Control Panel (Monitor Filters section of the settings overlay) */
export function controlPanel(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Monitor Filters' }) });
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
