import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

const baseState = {
  locations: [{ name: 'Kitchen' }, { name: 'Garden' }],
  characters: [{ first_name: 'Rosie', last_name: 'Jones', location_name: 'Kitchen' }],
  time_remaining: 10,
  location: 'Kitchen',
  mode: 'explore',
  current_talk_character: null,
  clues: [],
  narration: 'You enter the kitchen.',
  history: [],
};

async function bootstrapSession(page: Page) {
  await enableAuthBypass(page);

  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({
      json: {
        blueprints: [{ id: 'b1', title: 'B1', one_liner: '1', target_age: 6 }],
      },
    });
  });

  await page.route('**/functions/v1/game-start*', async (route) => {
    await route.fulfill({
      json: {
        game_id: 'g1',
        state: baseState,
      },
    });
  });

  await page.goto('/');
  await expect(page.getByText('B1')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/.*\/session/);
}

test.describe('Theme commands', () => {
  test('themes command lists available themes without player echo', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('themes');
    await input.press('Enter');

    // System feedback should list theme names
    await expect(page.getByText(/Classic Green/)).toBeVisible();
    await expect(page.getByText(/Amber/)).toBeVisible();
    await expect(page.getByText(/Active:/)).toBeVisible();

    // Player input should NOT appear in narration
    await expect(page.locator('text="> themes"')).toHaveCount(0);
  });

  test('theme <name> switches colors and confirms without player echo', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('theme amber');
    await input.press('Enter');

    // System confirmation should be visible
    await expect(page.getByText('Theme: Amber.')).toBeVisible();

    // CSS custom property should be updated
    const primaryColor = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--t-primary'),
    );
    expect(primaryColor).toBe('#fbbf24');

    // Player input should NOT appear in narration
    await expect(page.locator('text="> theme amber"')).toHaveCount(0);
  });

  test('theme persists across navigation', async ({ page }) => {
    await bootstrapSession(page);

    // Switch theme
    const input = page.locator('input[type="text"]');
    await input.fill('theme amber');
    await input.press('Enter');
    await expect(page.getByText('Theme: Amber.')).toBeVisible();

    // Navigate back to mystery list
    await page.goto('/');
    await expect(page.getByText('B1')).toBeVisible();

    // Theme should persist (loaded from localStorage)
    const primaryColor = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--t-primary'),
    );
    expect(primaryColor).toBe('#fbbf24');
  });

  test('invalid theme name shows error feedback', async ({ page }) => {
    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('theme nonexistent');
    await input.press('Enter');

    // Should show error with available themes
    await expect(page.getByText(/Unknown theme "nonexistent"/)).toBeVisible();
    await expect(page.getByText(/Available:/)).toBeVisible();

    // Player input should NOT appear in narration
    await expect(page.locator('text="> theme nonexistent"')).toHaveCount(0);
  });

  test('theme commands work in talk mode', async ({ page }) => {
    await enableAuthBypass(page);

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: {
          blueprints: [{ id: 'b1', title: 'B1', one_liner: '1', target_age: 6 }],
        },
      });
    });

    await page.route('**/functions/v1/game-start*', async (route) => {
      await route.fulfill({
        json: {
          game_id: 'g1',
          state: { ...baseState, mode: 'talk', current_talk_character: 'Rosie' },
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('B1')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);

    const input = page.locator('input[type="text"]');
    await input.fill('themes');
    await input.press('Enter');

    // Should still work in talk mode
    await expect(page.getByText(/Classic Green/)).toBeVisible();
    await expect(page.getByText(/Active:/)).toBeVisible();
  });
});
