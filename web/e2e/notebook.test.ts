import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createGameStartResponse,
  createNarrationEvent,
  createSearchResponse,
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
      json: createGameStartResponse({
        narration_events: [
          createNarrationEvent({
            narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
          }),
        ],
      }),
    });
  });

  await page.goto('/');
  await expect(page.getByText('1. Start a new game')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByText('B1')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/.*\/session/);
}

test.describe('Case notebook', () => {
  test('groups discovered clues by origin and never prints reasoning-path labels', async ({
    page,
  }) => {
    await page.route('**/functions/v1/game-search*', async (route) => {
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: [{ text: 'Crumbs on the floor.', speaker: narratorSpeaker }],
          revealed_clues: [
            {
              id: 'clue-crumbs',
              text: 'Crumbs lead to the pantry.',
              source: 'search',
              origin: {
                kind: 'location',
                location_id: 'loc-kitchen',
                location_name: 'Kitchen',
              },
              discovered_at: '2026-06-01T10:00:00Z',
              off_script: false,
              // A stale/legacy payload may still carry spoiler-bearing thread
              // labels. Nothing in the client may surface them.
              threads: [{ kind: 'red_herring', label: 'Red herring: the open window' }],
            },
          ],
        }),
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');
    await expect(page.getByText('Crumbs on the floor.')).toBeVisible();

    // The discovery toast echoes the clue text; tapping it opens the notebook
    // and dismisses the celebration, so the assertions below see one copy.
    await page.getByText('NEW CLUE DISCOVERED').click();

    await expect(page.getByText('CASE NOTEBOOK')).toBeVisible();
    await expect(page.getByText('Crumbs lead to the pantry.')).toBeVisible();
    // Grouped by where it was found — something the player already knows.
    await expect(page.getByText('Found at Kitchen')).toBeVisible();
    // The mystery-spoiling grouping must not appear anywhere on the page.
    await expect(page.getByText(/Red herring/i)).toHaveCount(0);
    await expect(page.getByText(/Main solution/i)).toHaveCount(0);
    await expect(page.getByText(/Ruling out/i)).toHaveCount(0);
  });
});
