import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

// Mobile-only spec. Runs under the `mobile-safari` Playwright project
// (iPhone 13 / WebKit) where `(hover: none) and (pointer: coarse)` is true.
//
// Playwright cannot render the actual iOS software keyboard, so these tests
// verify the contract that lets iOS raise it: a hidden focusable proxy input
// with the right `inputmode`, plus the floating mobile back button that
// replaces letter-key shortcuts unreachable from a numeric keyboard.

test.describe('mobile keyboard proxy', () => {
  async function mockEmptyCatalog(page: import('@playwright/test').Page) {
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: {
          in_progress: [],
          completed: [],
          counts: { in_progress: 0, completed: 0 },
        },
      });
    });
  }

  test('renders the numeric proxy on the landing menu', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();

    const proxy = page.getByTestId('mobile-keyboard-proxy');
    await expect(proxy).toHaveAttribute('inputmode', 'numeric');

    // Numeric key press should still drive the existing window handler.
    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: {
          blueprints: [
            { id: 'bp-1', title: 'The Stolen Cake', one_liner: 'Find the cake', target_age: 6 },
          ],
        },
      });
    });
    await page.keyboard.press('1');
    await expect(page.getByText('The Stolen Cake')).toBeVisible();
  });

  test('mobile back button returns from new-game view to menu', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);
    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: {
          blueprints: [
            { id: 'bp-1', title: 'The Stolen Cake', one_liner: 'Find the cake', target_age: 6 },
          ],
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByText('The Stolen Cake')).toBeVisible();

    await expect(page.getByTestId('mobile-back')).toBeVisible();
    await page.getByTestId('mobile-back').tap();
    await expect(page.getByText('1. Start a new game')).toBeVisible();
  });

  test('in-progress list shows carousel on mobile with back navigation', async ({ page }) => {
    await enableAuthBypass(page);
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: {
          in_progress: [
            {
              game_id: 'g-1',
              blueprint_id: 'bp-1',
              mystery_title: 'In Progress Mystery',
              mystery_available: true,
              can_open: true,
              mode: 'explore',
              time_remaining: 6,
              outcome: null,
              last_played_at: '2026-03-10T12:00:00.000Z',
              created_at: '2026-03-09T12:00:00.000Z',
            },
          ],
          completed: [],
          counts: { in_progress: 1, completed: 0 },
        },
      });
    });

    await page.goto('/sessions/in-progress');
    await expect(page.getByText('In Progress Mystery')).toBeVisible();

    // Mobile shows MobileTopBar with back arrow instead of keyboard proxy
    await expect(page.getByTestId('mobile-topbar-title')).toHaveText('Resume Case');
    await expect(page.getByTestId('mobile-topbar-back')).toBeVisible();

    await page.getByTestId('mobile-topbar-back').tap();
    await expect(page).toHaveURL(/\/$/);
  });
});
