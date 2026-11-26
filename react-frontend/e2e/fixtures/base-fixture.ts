import { test as base, expect, type Page, type Locator } from '@playwright/test';
import {
  FIXED_TIME,
  MOCK_LIVE_OFFERS,
  MOCK_LIVE_OFFER_FIAT_COUNTS,
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
  MOCK_TRADE_COST_CONFIG,
  MOCK_CEX_PERMISSIONS,
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
    await page.route('**/api/mm-controller/lnd/submarine-swaps*', route =>
      route.fulfill({ json: [] }),
    );
    await page.route('**/api/mm-controller/transactions/dex-pending-liquidity', route =>
      route.fulfill({ json: { btc_value: 0, transaction_count: 0, statuses: [] } }),
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
    await page.route('**/api/live_offers/counts*', route =>
      route.fulfill({ json: MOCK_LIVE_OFFER_FIAT_COUNTS }),
    );
    await page.route('**/api/live_offers*', route =>
      route.fulfill({ json: MOCK_LIVE_OFFERS }),
    );
    await page.route('**/api/trade_cost_config', route =>
      route.fulfill({ json: MOCK_TRADE_COST_CONFIG }),
    );
    const cexPermissionsState = structuredClone(MOCK_CEX_PERMISSIONS);
    await page.route(/\/api\/cex_permissions(?:\/[^/?]+)?(?:\?.*)?$/, async route => {
      if (route.request().method() === 'PUT') {
        const exchange = new URL(route.request().url()).pathname.split('/').pop() ?? '';
        const policy = route.request().postDataJSON() as { spot_enabled: boolean; hedge_enabled: boolean };
        const current = cexPermissionsState.exchanges.find(item => item.exchange === exchange);
        if (!current) return route.fulfill({ status: 404, json: { error: 'unknown provider' } });
        current.policy = policy;
        current.spot.policy_enabled = policy.spot_enabled;
        current.spot.effective_enabled = current.spot.available && policy.spot_enabled;
        current.hedge.policy_enabled = policy.hedge_enabled;
        current.hedge.effective_enabled = current.hedge.available && policy.hedge_enabled;
        return route.fulfill({ json: current });
      }
      return route.fulfill({ json: cexPermissionsState });
    });
    await page.route('**/api/payment_method_groups', route =>
      route.fulfill({ json: MOCK_PAYMENT_METHOD_GROUPS }),
    );
    let paymentMethodsState = structuredClone(MOCK_TRADING_PAYMENT_METHODS);
    await page.route('**/api/trading/accounts', route =>
      route.fulfill({ json: MOCK_TRADING_ACCOUNTS }),
    );
    await page.route('**/api/trading/accounts/*/credentials', route => {
      const id = Number(new URL(route.request().url()).pathname.match(/\/accounts\/(\d+)\/credentials$/)?.[1]);
      const account = MOCK_TRADING_ACCOUNTS.find(candidate => candidate.id === id);
      return route.fulfill({
        json: {
          email: account?.email ?? '',
          password: account?.password ?? '',
          phone: account?.phone ?? '',
          payment_tag: '$desk',
        },
      });
    });
    await page.route('**/api/trading/accounts/priorities', route =>
      route.fulfill({ json: { ok: true } }),
    );
    await page.route('**/api/trading/payment_methods', route =>
      route.fulfill({ json: paymentMethodsState }),
    );
    const chatTemplatesByMethod: Record<number, Array<{
      id: number;
      exchange: string;
      payment_method_id: number;
      template: string;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }>> = {
      1001: [
        {
          id: 7001,
          exchange: 'RoboSats',
          payment_method_id: 1001,
          template: 'Send {{amount}} {{currency}} with Revolut.',
          is_active: true,
          created_at: new Date(FIXED_TIME).toISOString(),
          updated_at: new Date(FIXED_TIME).toISOString(),
        },
        {
          id: 7002,
          exchange: 'Bisq2',
          payment_method_id: 1001,
          template: 'Use Revolut for {{amount}} {{currency}}.',
          is_active: true,
          created_at: new Date(FIXED_TIME).toISOString(),
          updated_at: new Date(FIXED_TIME).toISOString(),
        },
      ],
    };
    await page.route('**/api/trading/payment_methods/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const chatMatch = pathname.match(
        /\/api\/trading\/payment_methods\/(\d+)\/chat_templates(?:\/([^/]+))?$/,
      );
      if (chatMatch) {
        const id = Number(chatMatch[1]);
        const exchange = chatMatch[2] ? decodeURIComponent(chatMatch[2]) : null;
        const rows = chatTemplatesByMethod[id] ?? [];
        if (route.request().method() === 'GET' && exchange === null) {
          await route.fulfill({ json: { chat_templates: rows } });
          return;
        }
        if (route.request().method() === 'PUT' && exchange !== null) {
          const payload = await route.request().postDataJSON() as { template: string; is_active: boolean };
          const existing = rows.find(template => template.exchange === exchange);
          const now = new Date(FIXED_TIME).toISOString();
          const updated = {
            id: existing?.id ?? 7000 + Object.values(chatTemplatesByMethod).flat().length + 1,
            exchange,
            payment_method_id: id,
            template: payload.template,
            is_active: payload.is_active,
            created_at: existing?.created_at ?? now,
            updated_at: now,
          };
          chatTemplatesByMethod[id] = [
            ...rows.filter(template => template.exchange !== exchange),
            updated,
          ];
          await route.fulfill({ json: { chat_templates: chatTemplatesByMethod[id] } });
          return;
        }
        if (route.request().method() === 'DELETE' && exchange !== null) {
          chatTemplatesByMethod[id] = rows.filter(template => template.exchange !== exchange);
          await route.fulfill({ json: { ok: true } });
          return;
        }
      }
      if (route.request().method() !== 'PUT') {
        await route.fulfill({ json: { ok: true } });
        return;
      }
      const id = Number(pathname.match(/\/api\/trading\/payment_methods\/(\d+)$/)?.[1]);
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
    const bisqAccountsState = structuredClone(MOCK_BISQ_PAYMENT_ACCOUNTS);
    await page.route('**/api/mm-controller/bisq/payment-accounts', async route => {
      if (route.request().method() === 'POST') {
        const payload = await route.request().postDataJSON() as {
          payment_method_id: string;
          fields: Record<string, string>;
        };
        const created = {
          id: `bisq-created-${bisqAccountsState.payment_accounts.length + 1}`,
          account_name: payload.fields.accountName,
          payment_method_id: payload.payment_method_id,
          trade_currency: payload.fields.selectedTradeCurrency || '',
        };
        bisqAccountsState.payment_accounts.push(created);
        await route.fulfill({ json: created });
        return;
      }
      await route.fulfill({ json: bisqAccountsState });
    });
    await page.route('**/api/mm-controller/bisq/payment-methods', route =>
      route.fulfill({
        json: {
          payment_methods: [
            { id: 'REVOLUT', max_trade_period: 86_400_000, max_trade_limit: 100_000_000 },
            { id: 'CASH_APP', max_trade_period: 86_400_000, max_trade_limit: 50_000_000 },
          ],
        },
      }),
    );
    await page.route('**/api/mm-controller/bisq/payment-methods/*/form', route => {
      const id = new URL(route.request().url()).pathname.match(/payment-methods\/([^/]+)\/form$/)?.[1] ?? '';
      return route.fulfill({
        json: {
          payment_method_id: id,
          supported: true,
          fields: id === 'REVOLUT'
            ? {
                paymentMethodId: 'REVOLUT',
                accountName: 'your accountname',
                tradeCurrencies: 'comma delimited currency code list',
                selectedTradeCurrency: 'primary trading currency code',
                userName: 'your username',
                salt: '',
              }
            : { paymentMethodId: id, accountName: 'your accountname', cashTag: 'your cashtag', salt: '' },
        },
      });
    });
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
    // Without this guard the phone-push setup request falls through to a real
    // local backend whose 401 triggers the app-wide auth:unauthorized logout.
    await page.route('**/api/phone-push/setup/reveal', route =>
      route.fulfill({ json: { shared_secret: 'mock-shared-secret' } }),
    );
    await page.route('**/api/phone-push/setup*', route =>
      route.fulfill({
        json: {
          notify_url: 'http://localhost:8000/api/phone-push/notify',
          heartbeat_url: 'http://localhost:8000/api/phone-push/heartbeat',
          notify_credential_configured: true,
          heartbeat_credential_configured: true,
          online: true,
          device_id: 'payment-phone',
          last_seen: new Date(FIXED_TIME).toISOString(),
          max_age_seconds: 900,
          callback_history: [],
        },
      }),
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
    await page.route('**/api/dashboard/analytics', route =>
      route.fulfill({
        json: {
          past_order_stats_all: MOCK_PAST_ORDER_STATS,
          past_order_stats_all_net_capped: MOCK_PAST_ORDER_STATS,
          past_profitable_orders_compact: [],
          past_profitable_orders: [],
        },
      }),
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
export async function gotoAndWaitForData(page: Page, paymentScope?: 'all') {
  const liveOffersResponse = page.waitForResponse(resp =>
    resp.url().includes('/api/live_offers') && resp.status() === 200,
  );
  const analyticsResponse = page.waitForResponse(resp =>
    resp.url().includes('/api/dashboard/analytics') && resp.status() === 200,
  );
  const ohlcResponse = page.waitForResponse(resp =>
    resp.url().includes('/api/ohlc') && resp.status() === 200,
  );
  await page.goto('/');
  // Wait for live data, analytics, and React's lazy-loaded offers view.
  await Promise.all([liveOffersResponse, analyticsResponse, ohlcResponse]);
  if (paymentScope === 'all') {
    await openControlPanel(page);
    await jsClick(controlPanel(page).getByTitle('Show all methods, linked methods, or selected linked methods'));
    await page.getByRole('menuitemradio', { name: 'All methods', exact: true }).click();
    await closeControlPanel(page);
  }
  await page.getByTestId('live-offers-row').first().waitFor({ state: 'visible', timeout: 10_000 });
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

/** Opens the settings overlay via the header's gear button. */
export async function openSettings(page: Page) {
  await jsClick(page.locator('button[title="Settings"]'));
  await settingsOverlay(page).waitFor({ state: 'visible' });
}

export async function closeSettings(page: Page) {
  const overlay = settingsOverlay(page);
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await overlay.waitFor({ state: 'hidden' });
}

/** Locator for the settings overlay panel */
export function settingsOverlay(page: Page) {
  return page.locator('aside').filter({ hasText: 'Interface Preferences' });
}

/**
 * The dashboard (offers table, OHLC + depth charts) and the live-offer filter
 * controls both live on the dex Monitor tab, which is the default landing tab.
 * openControlPanel() ensures the Insights tab is in Live Offers mode with the
 * filter sidebar visible; closeControlPanel() is a no-op kept for readability at
 * call sites (there is no separate tab to return to).
 */
export async function openControlPanel(page: Page) {
  await jsClick(page.getByRole('button', { name: 'dex Monitor' }));
  await controlPanel(page).waitFor({ state: 'visible' });
  await jsClick(page.getByRole('button', { name: 'Live Offers', exact: true }));
}

export async function closeControlPanel(_page: Page) {
  void _page;
  // The dashboard and filters share the Insights tab, so there is nothing to
  // switch back to — assertions run against the same view.
}

/**
 * The Insights OHLC chart draws no offer overlays until they are ticked. Click
 * the header "all" checkbox so every currently-visible offer is plotted (paths,
 * lifecycle fetches, fit-to-offers). Call after the offers/filters are settled.
 */
export async function revealChartOffers(page: Page) {
  await jsClick(page.getByTitle('Show/hide all offers on the OHLC chart'));
}

/** Locator for the Control Panel (filters sidebar of the dex Monitor tab) */
export function controlPanel(page: Page) {
  return page.getByRole('complementary', { name: 'Insights filters' });
}

/** Locator for the OHLC chart panel (the surface holding its collapse button) */
export function ohlcPanel(page: Page) {
  return page.locator('.bg-surface').filter({
    has: page.getByRole('button', { name: 'Hide premium chart' }),
  }).last();
}

/** Locator for the Depth chart panel (the surface holding its collapse button) */
export function depthPanel(page: Page) {
  return page.locator('.bg-surface').filter({
    has: page.getByRole('button', { name: 'Hide orderbook depth chart' }),
  }).last();
}

/** Locator for the current Insights live-offer list. */
export function offersPanel(page: Page) {
  return page.getByTestId('live-offers-list');
}
