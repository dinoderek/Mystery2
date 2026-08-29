import { test, expect } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createGameState,
  createGameStartResponse,
  createNarrationEvent,
  createMoveResponse,
  createSessionSummary,
  createSessionCatalog,
} from '../../tests/testkit/src/fixtures';

const startState = createGameState({
  locations: [{ id: 'loc-kitchen', name: 'kitchen' }, { id: 'loc-garden', name: 'garden' }],
  characters: [],
  location: 'kitchen',
});

test.describe('US2/US3 - Narration Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsTestProfile(page);

    await page.route('**/api/game-sessions-list*', async (route) => {
      await route.fulfill({ json: EMPTY_CATALOG });
    });

    await page.route('**/api/blueprints-list*', async (route) => {
      await route.fulfill({
        json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1', target_age: 6 })] },
      });
    });

    await page.route('**/api/game-start*', async (route) => {
      await route.fulfill({
        json: createGameStartResponse({
          state: startState,
          narration_events: [
            createNarrationEvent({
              sequence: 1,
              event_type: 'start',
              narration_parts: [{ text: 'Game started. The cake is gone.', speaker: narratorSpeaker }],
            }),
            createNarrationEvent({
              sequence: 2,
              event_type: 'move',
              narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
            }),
          ],
        }),
      });
    });

    await page.route('**/api/game-move*', async (route) => {
      await route.fulfill({
        json: createMoveResponse({
          narration_parts: [{ text: 'You move to the garden.', speaker: narratorSpeaker }],
          current_location: 'garden',
        }),
      });
    });
  });

  test('pages with the keyboard, leaving plain arrows to the command line', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByText('B1')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);

    const opening = page.locator('text="Game started. The cake is gone."');
    const arrival = page.locator('text="You enter the kitchen."').first();
    await expect(arrival).toBeVisible();

    await page.keyboard.press('PageUp');
    await expect(opening).toBeVisible();
    await page.keyboard.press('PageDown');
    await expect(arrival).toBeVisible();

    // Alt+arrows are the alternate binding.
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(opening).toBeVisible();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(arrival).toBeVisible();

    // A plain arrow must stay with the caret, not turn the page.
    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('ArrowLeft');
    await expect(arrival).toBeVisible();
    await expect(input).toHaveValue('search');
  });

  test('renders narration history and auto-scrolls down', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByText('B1')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/.*\/session/);

    // The opening and the arrival are separate pages: the newest one is live.
    await expect(page.locator('text="You enter the kitchen."').first()).toBeVisible();
    await expect(page.locator('text="Game started. The cake is gone."')).toBeHidden();

    // Paging back reaches the opening, and forward returns to the live page.
    await page.getByTestId('page-prev').click();
    await expect(page.locator('text="Game started. The cake is gone."')).toBeVisible();
    await page.getByTestId('page-next').click();
    await expect(page.locator('text="You enter the kitchen."').first()).toBeVisible();

    const scrollArea = page.getByTestId('page-narration');
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

  test('shows the active page image in the scene pane and swaps it when paging', async ({ page }) => {
    const testImage = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
      '<rect fill="#333" width="400" height="300"/></svg>',
    );

    await page.route('**/api/images/**', async (route) => {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: testImage,
      });
    });

    await page.route('**/api/game-move*', async (route) => {
      await route.fulfill({
        json: createMoveResponse({
          narration_parts: [
            {
              text: 'You move to the garden.',
              speaker: narratorSpeaker,
              image_id: 'mock-blueprint.location-garden.png',
            },
          ],
          current_location: 'garden',
        }),
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

    // The garden page carries an image, so the pane renders it.
    const sceneImage = page.getByTestId('scene-pane').locator('.story-image-asset');
    await expect(sceneImage).toBeVisible({ timeout: 5000 });

    // Paging back to a page with no image of its own keeps the last one shown
    // rather than leaving two thirds of the screen empty.
    await page.getByTestId('page-prev').click();
    await expect(page.getByTestId('scene-pane')).toBeVisible();
  });

  test('keeps narration flow active when side image fails to load', async ({ page }) => {
    await page.route('**/api/images/**', async (route) => {
      await route.fulfill({ status: 404, body: '' });
    });

    await page.route('**/api/game-move*', async (route) => {
      await route.fulfill({
        json: createMoveResponse({
          narration_parts: [
            {
              text: 'You move to the garden.',
              speaker: narratorSpeaker,
              image_id: 'mock-blueprint.location-garden.png',
            },
          ],
          current_location: 'garden',
        }),
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
    // The scene pane is part of the layout, so it stays and shows its
    // placeholder rather than collapsing and reflowing the page.
    await expect(page.getByTestId('scene-pane')).toBeVisible();
    await expect(page.locator('.story-image-asset')).toHaveCount(0);
    await expect(page.locator('.story-image-placeholder')).toBeVisible();
  });

  test('shows resume recovery guidance when transcript reload fails', async ({ page }) => {
    await page.route('**/api/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: createSessionCatalog({
          in_progress: [
            createSessionSummary({
              game_id: '00000000-0000-0000-0000-000000000001',
              blueprint_id: '00000000-0000-0000-0000-000000000002',
              mystery_title: 'B1',
              time_remaining: 4,
              last_played_at: '2026-03-16T10:00:00.000Z',
              created_at: '2026-03-16T09:00:00.000Z',
            }),
          ],
          counts: { in_progress: 1, completed: 0 },
        }),
      });
    });

    await page.route('**/api/game-get*', async (route) => {
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
