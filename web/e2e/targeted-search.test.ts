import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

const narratorSpeaker = { kind: 'narrator', key: 'narrator', label: 'Narrator' } as const;

function narrationResponse(
  text: string,
  speaker: { kind: string; key: string; label: string },
) {
  return {
    narration_parts: [{ text, speaker }],
  };
}

const baseState = {
  locations: [{ name: 'Kitchen' }, { name: 'Garden' }],
  characters: [
    { first_name: 'Alice', last_name: 'Smith', location_name: 'Kitchen', sex: 'female' },
  ],
  time_remaining: 10,
  location: 'Kitchen',
  mode: 'explore',
  current_talk_character: null,
};

async function bootstrapSession(page: Page) {
  await enableAuthBypass(page);

  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: { in_progress: [], completed: [], counts: { in_progress: 0, completed: 0 } },
    });
  });

  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({
      json: { blueprints: [{ id: 'b1', title: 'B1', one_liner: '1', target_age: 6 }] },
    });
  });

  await page.route('**/functions/v1/game-start*', async (route) => {
    await route.fulfill({
      json: {
        game_id: 'g1',
        state: baseState,
        narration_events: [
          {
            sequence: 1,
            event_type: 'start',
            narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
          },
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
        json: {
          ...narrationResponse('You look around but find nothing special.', narratorSpeaker),
          time_remaining: 9,
          mode: 'explore',
        },
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
        json: {
          ...narrationResponse('You find a clue under the desk!', narratorSpeaker),
          time_remaining: 9,
          mode: 'explore',
        },
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
        json: {
          ...narrationResponse('Nothing on the old bookshelf.', narratorSpeaker),
          time_remaining: 9,
          mode: 'explore',
        },
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
        json: {
          ...narrationResponse('You peek behind the curtains.', narratorSpeaker),
          time_remaining: 9,
          mode: 'explore',
        },
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
