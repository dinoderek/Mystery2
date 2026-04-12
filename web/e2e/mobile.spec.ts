import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

// Mobile-only spec. Runs under the `mobile-safari` Playwright project
// (iPhone 13 / WebKit) where `(hover: none) and (pointer: coarse)` is true.

test.describe('mobile home screen', () => {
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

  async function mockCatalogWithSessions(page: import('@playwright/test').Page) {
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
          completed: [
            {
              game_id: 'g-2',
              blueprint_id: 'bp-2',
              mystery_title: 'Completed Mystery',
              mystery_available: true,
              can_open: true,
              mode: 'ended',
              time_remaining: 0,
              outcome: 'win',
              last_played_at: '2026-03-11T12:00:00.000Z',
              created_at: '2026-03-08T12:00:00.000Z',
            },
          ],
          counts: { in_progress: 1, completed: 1 },
        },
      });
    });
  }

  async function mockBlueprints(page: import('@playwright/test').Page) {
    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: {
          blueprints: [
            { id: 'bp-1', title: 'The Stolen Cake', one_liner: 'Find the cake', target_age: 6 },
          ],
        },
      });
    });
  }

  test('renders three menu buttons on mobile', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/');
    await expect(page.getByTestId('mobile-home-new-game')).toBeVisible();
    await expect(page.getByTestId('mobile-home-resume')).toBeVisible();
    await expect(page.getByTestId('mobile-home-history')).toBeVisible();
    await expect(page.getByTestId('mobile-home-logout')).toBeVisible();
  });

  test('resume and history buttons are disabled when counts are 0', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/');
    await expect(page.getByTestId('mobile-home-new-game')).toBeEnabled();
    await expect(page.getByTestId('mobile-home-resume')).toBeDisabled();
    await expect(page.getByTestId('mobile-home-history')).toBeDisabled();
  });

  test('resume and history buttons are enabled with session counts', async ({ page }) => {
    await enableAuthBypass(page);
    await mockCatalogWithSessions(page);

    await page.goto('/');
    await expect(page.getByTestId('mobile-home-resume')).toBeEnabled();
    await expect(page.getByTestId('mobile-home-history')).toBeEnabled();
    // Verify count text
    await expect(page.getByTestId('mobile-home-resume')).toContainText('(1)');
    await expect(page.getByTestId('mobile-home-history')).toContainText('(1)');
  });

  test('start new case opens blueprint carousel', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);
    await mockBlueprints(page);

    await page.goto('/');
    await page.getByTestId('mobile-home-new-game').tap();
    await expect(page.getByText('The Stolen Cake')).toBeVisible();
    await expect(page.getByTestId('mobile-topbar-title')).toHaveText('Choose a Mystery');
  });

  test('back arrow returns from blueprint carousel to menu', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);
    await mockBlueprints(page);

    await page.goto('/');
    await page.getByTestId('mobile-home-new-game').tap();
    await expect(page.getByText('The Stolen Cake')).toBeVisible();

    await page.getByTestId('mobile-topbar-back').tap();
    await expect(page.getByTestId('mobile-home-new-game')).toBeVisible();
  });

  test('no desktop text visible on mobile home', async ({ page }) => {
    await enableAuthBypass(page);
    await mockEmptyCatalog(page);

    await page.goto('/');
    // Desktop-only text should not appear
    await expect(page.getByText('1. Start a new game')).not.toBeVisible();
    await expect(page.getByText('MYSTERY GAME TERMINAL')).not.toBeVisible();
    // Mobile title should appear
    await expect(page.getByText('MYSTERY TERMINAL')).toBeVisible();
  });
});

test.describe('mobile session lists', () => {
  test('in-progress list exposes numeric proxy and back button', async ({ page }) => {
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

    await expect(page.getByTestId('mobile-keyboard-proxy')).toHaveAttribute('inputmode', 'numeric');

    await page.getByTestId('mobile-back').tap();
    await expect(page).toHaveURL(/\/$/);
  });
});
