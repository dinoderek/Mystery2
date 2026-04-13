import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  INVESTIGATOR_SPEAKER as investigatorSpeaker,
  createGameState,
  createBlueprintSummary,
  createSessionSummary,
  createSessionCatalog,
  createNarrationEvent,
} from '../../tests/testkit/src/fixtures';

const baseState = createGameState({ time_remaining: 7 });

async function setupResumeSession(page: Page, narrationEvents: unknown[]) {
  await enableAuthBypass(page);

  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({
      json: { blueprints: [createBlueprintSummary({ title: 'B1', one_liner: '1', target_age: 6 })] },
    });
  });

  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: createSessionCatalog({
        in_progress: [
          createSessionSummary({
            game_id: '00000000-0000-0000-0000-000000000001',
            blueprint_id: '00000000-0000-0000-0000-000000000002',
            mystery_title: 'Cookie Mystery',
            time_remaining: 7,
            last_played_at: '2026-01-01T00:00:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z',
          }),
        ],
        counts: { in_progress: 1, completed: 0 },
      }),
    });
  });

  await page.route('**/functions/v1/game-get*', async (route) => {
    await route.fulfill({
      json: {
        state: baseState,
        narration_events: narrationEvents,
      },
    });
  });

  await page.goto('/');
  await expect(page.getByText('2. View in-progress games')).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.getByText('Cookie Mystery')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/.*\/session/);
}

test.describe('Search Resume - Player Message Restoration', () => {
  test('restores targeted search as investigator message with query text', async ({ page }) => {
    await setupResumeSession(page, [
      createNarrationEvent({
        sequence: 1,
        event_type: 'start',
        narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
      }),
      createNarrationEvent({
        sequence: 2,
        event_type: 'search',
        narration_parts: [
          { text: 'search under the desk', speaker: investigatorSpeaker },
          { text: 'You find crumbs under the desk!', speaker: narratorSpeaker },
        ],
        payload: { search_query: 'under the desk' },
      }),
    ]);

    await expect(page.getByText('search under the desk')).toBeVisible();
    await expect(page.getByText('You find crumbs under the desk!')).toBeVisible();
  });

  test('restores bare search as investigator message with just "search"', async ({ page }) => {
    await setupResumeSession(page, [
      createNarrationEvent({
        sequence: 1,
        event_type: 'start',
        narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
      }),
      createNarrationEvent({
        sequence: 2,
        event_type: 'search',
        narration_parts: [
          { text: 'search', speaker: investigatorSpeaker },
          { text: 'You look around and notice a crumb.', speaker: narratorSpeaker },
        ],
        payload: { search_query: null },
      }),
    ]);

    const investigatorLines = page.locator('[data-speaker-kind="investigator"]');
    await expect(investigatorLines.last()).toContainText('search');
    await expect(page.getByText('You look around and notice a crumb.')).toBeVisible();
  });

  test('restores mixed history with move, bare search, and targeted search', async ({ page }) => {
    await setupResumeSession(page, [
      createNarrationEvent({
        sequence: 1,
        event_type: 'start',
        narration_parts: [{ text: 'You enter the kitchen.', speaker: narratorSpeaker }],
      }),
      createNarrationEvent({
        sequence: 2,
        event_type: 'search',
        narration_parts: [
          { text: 'search', speaker: investigatorSpeaker },
          { text: 'A crumb on the floor.', speaker: narratorSpeaker },
        ],
        payload: { search_query: null },
      }),
      createNarrationEvent({
        sequence: 3,
        event_type: 'search',
        narration_parts: [
          { text: 'search behind the curtains', speaker: investigatorSpeaker },
          { text: 'Nothing behind the curtains.', speaker: narratorSpeaker },
        ],
        payload: { search_query: 'behind the curtains' },
      }),
      createNarrationEvent({
        sequence: 4,
        event_type: 'search',
        narration_parts: [
          { text: 'search in the pantry', speaker: investigatorSpeaker },
          { text: 'You find a hidden cookie jar!', speaker: narratorSpeaker },
        ],
        payload: { search_query: 'in the pantry' },
      }),
    ]);

    await expect(page.getByText('A crumb on the floor.')).toBeVisible();
    await expect(page.getByText('Nothing behind the curtains.')).toBeVisible();
    await expect(page.getByText('You find a hidden cookie jar!')).toBeVisible();

    // Verify all investigator messages appear
    const investigatorLines = page.locator('[data-speaker-kind="investigator"]');
    await expect(investigatorLines).toHaveCount(3);
  });
});
