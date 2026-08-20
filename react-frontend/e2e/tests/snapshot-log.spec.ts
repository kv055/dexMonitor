import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

test.describe('SnapshotLog', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'dex Mm Controller' }).click();
  });

  test('shows zero-offer Bisq snapshots separately from offline Bisq', async ({ page }) => {
    const snapshotLog = page.locator('h3', { hasText: 'Snapshot Log' }).locator('xpath=..');

    await expect(snapshotLog.getByText('108 offers')).toBeVisible();
    await snapshotLog.getByRole('button').filter({ hasText: '108 offers' }).click();
    await expect(snapshotLog.getByText('Bisq v1')).toBeVisible();
    await expect(snapshotLog.getByRole('button', { name: /^Bisq v1 complete, 0 offers/ })).toBeVisible();

    await snapshotLog.getByRole('button', { name: /^Bisq v1 complete, 0 offers/ }).click();
    await expect(snapshotLog.getByText('No offer IDs in this snapshot.')).toBeVisible();

    await snapshotLog.getByRole('button').filter({ hasText: '107 offers' }).click();
    await expect(snapshotLog.getByRole('button', { name: /Bisq.*failed/ }).first()).toBeVisible();
  });
});
