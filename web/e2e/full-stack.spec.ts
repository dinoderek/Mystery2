import { expect, test } from '@playwright/test';
import { loginWithSeedUser } from './test-auth';

test.describe('Full stack browser flow', () => {
  test('covers parser + store + backend state machine for talk/ask', async ({ page }) => {
    await loginWithSeedUser(page);

    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');

    await expect(page.locator('h2.text-xl').first()).toBeVisible({ timeout: 8000 });

    const caseTitles = await page.locator('h2.text-xl').allTextContents();
    const honeyCakeIndex = caseTitles.findIndex((title) => title.includes('Missing Honey Cakes'));
    expect(honeyCakeIndex, 'Missing Honey Cakes blueprint must be available in local storage seed.').toBeGreaterThanOrEqual(0);

    await page.keyboard.press(String(honeyCakeIndex + 1));
    await expect(page).toHaveURL(/.*\/session/);

    const input = page.locator("input[type='text']");

    await input.fill('talk to mayor');
    await input.press('Enter');
    await expect(page.getByText(/\[Mock\] You approach Mayor in/i)).toBeVisible();

    await input.fill('Where were you when the cakes disappeared?');
    await input.press('Enter');

    await expect(page.getByText(/\[Mock\] Mayor responds thoughtfully to:/i)).toBeVisible();
    await expect(page.getByText(/Request failed:/i)).toHaveCount(0);
  });
});
