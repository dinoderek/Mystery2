import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  BASE_GAME_STATE as baseState,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createNarrationEvent,
  createSearchResponse,
  narrationResponse,
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

test.describe('Targeted Search', () => {
  test('bare search sends null search_query and decrements time', async ({ page }) => {
    let searchPayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-search*', async (route) => {
      searchPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: narrationResponse('You look around but find nothing special.', narratorSpeaker).narration_parts,
        }),
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText('You look around but find nothing special.')).toBeVisible();
    expect(searchPayload?.search_query).toBeNull();
  });

  test('targeted search sends search_query in request body', async ({ page }) => {
    let searchPayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-search*', async (route) => {
      searchPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: narrationResponse('You find a clue under the desk!', narratorSpeaker).narration_parts,
        }),
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search under the desk');
    await input.press('Enter');

    await expect(page.getByText('You find a clue under the desk!')).toBeVisible();
    expect(searchPayload?.search_query).toBe('under the desk');
  });

  test('inspect alias preserves freeform text in search_query', async ({ page }) => {
    let searchPayload: Record<string, unknown> | null = null;

    await page.route('**/functions/v1/game-search*', async (route) => {
      searchPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: narrationResponse('Nothing on the old bookshelf.', narratorSpeaker).narration_parts,
        }),
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('inspect the old bookshelf');
    await input.press('Enter');

    await expect(page.getByText('Nothing on the old bookshelf.')).toBeVisible();
    expect(searchPayload?.search_query).toBe('the old bookshelf');
  });

  test('shows investigator message for targeted search', async ({ page }) => {
    await page.route('**/functions/v1/game-search*', async (route) => {
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: narrationResponse('You peek behind the curtains.', narratorSpeaker).narration_parts,
        }),
      });
    });

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search behind the curtains');
    await input.press('Enter');

    await expect(page.locator('[data-speaker-kind="investigator"]').last()).toContainText('You:');
    await expect(page.getByText('You peek behind the curtains.')).toBeVisible();
    await expect(page.locator('[data-speaker-kind="narrator"]').last()).toContainText('Narrator:');
  });
});
