import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

const narratorSpeaker = {
  kind: 'narrator',
  key: 'narrator',
  label: 'Narrator',
};

const startState = {
  locations: [],
  characters: [],
  time_remaining: 10,
  location: 'kitchen',
  mode: 'explore',
  current_talk_character: null,
  narration: 'You enter the kitchen.',
  narration_speaker: narratorSpeaker,
  history: [
    {
      sequence: 1,
      event_type: 'start',
      narration: 'Game started. The cake is gone.',
      speaker: narratorSpeaker,
    },
    {
      sequence: 2,
      event_type: 'move',
      narration: 'You enter the kitchen.',
      speaker: narratorSpeaker,
    },
  ],
};

test.describe('US2/US3 - Narration Rendering', () => {
  test.beforeEach(async ({ page }) => {
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
          state: startState,
        },
      });
    });

    await page.route('**/functions/v1/game-move*', async (route) => {
      await route.fulfill({
        json: {
          narration: 'You move to the garden.',
          current_location: 'garden',
          visible_characters: [],
          time_remaining: 9,
          mode: 'explore',
          speaker: narratorSpeaker,
        },
      });
    });
  });

  test('renders narration history and auto-scrolls down', async ({ page }) => {
    await page.goto('/');
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
    await expect(page.getByText('B1')).toBeVisible();

    await page.getByTestId('theme-amber').click();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber');
    await expect(page.locator('[data-speaker-kind="narrator"]').first()).toHaveClass(/amber-body/);

    await page.goto('/');
    await expect(page.getByText('B1')).toBeVisible();
    await page.getByTestId('theme-matrix').click();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'matrix');
    await expect(page.locator('[data-speaker-kind="narrator"]').first()).toHaveClass(/matrix-body/);
  });
});
