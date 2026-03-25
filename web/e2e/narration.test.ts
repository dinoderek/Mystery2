import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

const narratorSpeaker = {
  kind: 'narrator',
  key: 'narrator',
  label: 'Narrator',
};

const startState = {
  locations: [{ id: 'loc-kitchen', name: 'kitchen' }, { id: 'loc-garden', name: 'garden' }],
  characters: [],
  time_remaining: 10,
  location: 'kitchen',
  mode: 'explore',
  current_talk_character: null,
};

test.describe('US2/US3 - Narration Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await enableAuthBypass(page);

    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: {
          in_progress: [],
          completed: [],
          counts: { in_progress: 0, completed: 0 },
        },
      });
    });

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
          state: startState,
          narration_events: [
            {
              sequence: 1,
              event_type: 'start',
              narration_parts: [{ text: 'Game started. The cake is gone.', speaker: narratorSpeaker }],
            },
            {
              sequence: 2,
              event_type: 'move',
              narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
            },
          ],
        },
      });
    });

    await page.route('**/functions/v1/game-move*', async (route) => {
      await route.fulfill({
        json: {
          narration_parts: [{ text: 'You move to the garden.', speaker: narratorSpeaker }],
          current_location: 'garden',
          visible_characters: [],
          time_remaining: 9,
          mode: 'explore',
        },
      });
    });
  });

  test('renders narration history and auto-scrolls down', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByText('B1')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);

    await expect(page.locator('text="Game started. The cake is gone."')).toBeVisible();
    await expect(page.locator('text="You enter the kitchen."').first()).toBeVisible();

    const scrollArea = page.locator('.overflow-y-auto');
    await expect(scrollArea).toBeAttached();

    await page.locator('input').fill('move to garden');
    await page.locator('input').press('Enter');

    await page.waitForTimeout(500);

    const scrollInfo = await scrollArea.evaluate((node) => {
      return {
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
    });

    expect(scrollInfo.scrollTop + scrollInfo.clientHeight).toBeGreaterThanOrEqual(scrollInfo.scrollHeight - 5);
  });

  test('applies speaker-kind styles across theme switches', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByText('B1')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);

    const input = page.locator('input[type="text"]');

    // Switch to amber theme via terminal command
    await input.fill('theme amber');
    await input.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber');
    await expect(page.locator('[data-speaker-kind="narrator"]').first()).toHaveClass(/amber-body/);

    // Switch to classic theme (maps to data-theme="matrix" internally)
    await input.fill('theme classic');
    await input.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'matrix');
    await expect(page.locator('[data-speaker-kind="narrator"]').first()).toHaveClass(/matrix-body/);
  });

  test('keeps narration flow active when side image fails to load', async ({ page }) => {
    await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Image unavailable' }),
      });
    });

    await page.route('**/functions/v1/game-move*', async (route) => {
      await route.fulfill({
        json: {
          narration_parts: [
            {
              text: 'You move to the garden.',
              speaker: narratorSpeaker,
              image_id: 'mock-blueprint.location-garden.png',
            },
          ],
          current_location: 'garden',
          visible_characters: [],
          time_remaining: 9,
          mode: 'explore',
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByText('B1')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);

    await page.locator('input').fill('move to garden');
    await page.locator('input').press('Enter');

    // Narration text should still render even when the image fails to load
    await expect(page.getByText('You move to the garden.')).toBeVisible();
    // No image panel should be rendered for the failed image
    await expect(page.locator('.story-image-panel')).toHaveCount(0);
  });

  test('shows resume recovery guidance when transcript reload fails', async ({ page }) => {
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: {
          in_progress: [
            {
              game_id: 'g1',
              blueprint_id: 'b1',
              mystery_title: 'B1',
              mystery_available: true,
              can_open: true,
              mode: 'explore',
              time_remaining: 4,
              outcome: null,
              last_played_at: '2026-03-16T10:00:00.000Z',
              created_at: '2026-03-16T09:00:00.000Z',
            },
          ],
          completed: [],
          counts: { in_progress: 1, completed: 0 },
        },
      });
    });

    await page.route('**/functions/v1/game-get*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Failed to load transcript',
          details: {
            recovery: 'Return to the mystery list and reopen the case.',
          },
        }),
      });
    });

    await page.goto('/sessions/in-progress');
    await page.locator('body').click();
    await page.keyboard.press('1');

    await expect(page).toHaveURL(/.*\/sessions\/in-progress/);
    await expect(
      page.getByText('Failed to load transcript. Return to the mystery list and reopen the case.'),
    ).toBeVisible();
  });
});
