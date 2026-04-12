import { test, expect } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createGameState,
  createNarrationEvent,
  createMoveResponse,
  createImageLinkResponse,
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
        },
      });
    });

    await page.route('**/functions/v1/game-move*', async (route) => {
      await route.fulfill({
        json: createMoveResponse({
          narration_parts: [{ text: 'You move to the garden.', speaker: narratorSpeaker }],
          current_location: 'garden',
        }),
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

  test('auto-scrolls to bottom after image loads', async ({ page }) => {
    // Serve an SVG with explicit dimensions so it takes up space in the layout,
    // simulating a real scene image that shifts content when it loads.
    const testImage = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">' +
      '<rect fill="#333" width="400" height="300"/></svg>',
    );

    // Delay the signed-URL response so text renders before the image.
    await page.route('**/functions/v1/blueprint-image-link*', async (route) => {
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        json: createImageLinkResponse({
          image_id: 'mock-blueprint.location-garden.png',
          signed_url: 'http://127.0.0.1/storage/v1/object/sign/fake/img.png',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
      });
    });

    // Serve the test image for the signed URL
    await page.route('**/storage/v1/object/sign/**', async (route) => {
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: testImage,
      });
    });

    // Pad the narration so the scroll area overflows before the image group
    const paddingParts = Array.from({ length: 20 }, (_, i) => ({
      text: `Padding line ${i + 1} to force overflow in the scroll area.`,
      speaker: narratorSpeaker,
    }));

    await page.route('**/functions/v1/game-start*', async (route) => {
      await route.fulfill({
        json: {
          game_id: '00000000-0000-0000-0000-000000000001',
          state: startState,
          narration_events: [
            createNarrationEvent({
              narration_parts: [{ text: 'Game started.', speaker: narratorSpeaker }],
            }),
          ],
        },
      });
    }, { times: 1 });

    await page.route('**/functions/v1/game-move*', async (route) => {
      await route.fulfill({
        json: createMoveResponse({
          narration_parts: [
            ...paddingParts,
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

    // Wait for the image to actually load in the DOM
    await expect(page.locator('.story-image-asset')).toBeVisible({ timeout: 5000 });

    // Give smooth-scroll time to finish after image load
    await page.waitForTimeout(1000);

    const scrollInfo = await page.locator('.overflow-y-auto').evaluate((node) => ({
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));

    // The sentinel is at the very bottom — we should be scrolled there
    expect(scrollInfo.scrollTop + scrollInfo.clientHeight).toBeGreaterThanOrEqual(
      scrollInfo.scrollHeight - 5,
    );
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
    // No image panel should be rendered for the failed image
    await expect(page.locator('.story-image-panel')).toHaveCount(0);
  });

  test('shows resume recovery guidance when transcript reload fails', async ({ page }) => {
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
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
