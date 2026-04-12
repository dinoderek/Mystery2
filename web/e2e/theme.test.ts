import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  BASE_GAME_STATE as baseState,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createNarrationEvent,
} from '../../tests/testkit/src/fixtures';

async function bootstrapSession(page: Page) {
  await enableAuthBypass(page);

  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({ json: EMPTY_CATALOG });
  });

  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({
      json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1', target_age: 6 })] },
    });
  });

  await page.route('**/functions/v1/game-start*', async (route) => {
    await route.fulfill({
      json: {
        game_id: '00000000-0000-0000-0000-000000000001',
        state: baseState,
        narration_events: [
          createNarrationEvent({
            narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
          }),
        ],
      },
    });
  });

  await page.goto('/');
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  await page.keyboard.press('1');
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
    await expect(page.getByText('1. Start a new game')).toBeVisible();

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

    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({ json: EMPTY_CATALOG });
    });

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1', target_age: 6 })] },
      });
    });

    await page.route('**/functions/v1/game-start*', async (route) => {
      await route.fulfill({
        json: {
          game_id: '00000000-0000-0000-0000-000000000001',
          state: { ...baseState, mode: 'talk', current_talk_character: 'Rosie' },
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
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
