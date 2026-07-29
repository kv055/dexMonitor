import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

test('generates communication QR codes locally without third-party requests', async ({ page }) => {
  const thirdPartyQrRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).hostname === 'api.qrserver.com') {
      thirdPartyQrRequests.push(request.url());
    }
  });

  let telegramConfig = {
    bot_token_present: false,
    chat_id: '',
    dexmm_webhook_url: 'https://203.0.113.10/telegram-webhook',
    pushpush_webhook_url: '',
    dexmm_webhook_set: false,
    pushpush_webhook_set: false,
    config_version: 1,
  };
  await page.route('**/api/mm-controller/telegram/config', async route => {
    if (route.request().method() === 'PUT') {
      telegramConfig = {
        ...telegramConfig,
        bot_token_present: true,
        config_version: 2,
      };
    }
    await route.fulfill({ json: telegramConfig });
  });
  await page.route('**/api/mm-controller/telegram/pair', route =>
    route.fulfill({
      json: {
        deep_link: 'https://t.me/dexarb_test_bot?start=temporary-pairing-token',
        expires_at: '2030-01-01T12:00:00Z',
      },
    }),
  );
  await page.route('**/api/phone-push/setup', route =>
    route.fulfill({
      json: {
        notify_url: 'https://dexarb.example.test/api/phone-push/notify',
        heartbeat_url: 'https://dexarb.example.test/api/phone-push/heartbeat',
        notify_credential_configured: true,
        heartbeat_credential_configured: true,
        online: false,
        device_id: '',
        last_seen: '',
        max_age_seconds: 600,
      },
    }),
  );

  await gotoAndWaitForData(page);
  await page.getByRole('button', { name: 'Trading Accounts', exact: true }).click();
  const panel = page.getByTestId('trading-accounts-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /^Communication/ }).click();

  const telegramSection = panel
    .getByRole('heading', { name: 'Telegram bot' })
    .locator('xpath=ancestor::section');
  await expect(telegramSection.getByText('https://203.0.113.10/telegram-webhook')).toBeVisible();
  await expect(telegramSection.getByText('This public endpoint is derived from the active server edge and cannot be edited here.')).toBeVisible();
  await telegramSection.getByPlaceholder('Paste bot token from BotFather').fill('123456:test-token');

  const botFatherQr = panel.getByRole('img', { name: 'QR code to open Telegram BotFather' });
  const phoneSetupQr = panel.getByRole('img', {
    name: 'Non-secret combined phone monitoring setup reference QR code',
  });
  await expect(botFatherQr).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(phoneSetupQr).toHaveAttribute('src', /^data:image\/png;base64,/);
  const botFatherQrSource = await botFatherQr.getAttribute('src');

  await expect(telegramSection.getByRole('link', { name: 'Open BotFather ↗' })).toHaveAttribute('href', 'https://t.me/BotFather');
  await telegramSection.getByRole('button', { name: 'Save', exact: true }).click();

  const pairingQr = panel.getByRole('img', { name: 'QR code to connect your Telegram bot' });
  await expect(pairingQr).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(await pairingQr.getAttribute('src')).not.toBe(botFatherQrSource);
  expect(thirdPartyQrRequests).toEqual([]);
});
