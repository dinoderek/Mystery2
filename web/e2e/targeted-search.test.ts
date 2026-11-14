import { expect, test, type Page } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import { confirmOpening, playedTurn, stubTurns } from './session-helpers';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createBlueprintSummary,
  createGameStartResponse,
  createNarrationEvent,
} from '../../tests/testkit/src/fixtures';

async function bootstrapSession(page: Page) {
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
  await confirmOpening(page);
}

test.describe('Targeted Search', () => {
  // What a search means is the engine's to decide; the page sends the words.
  test('bare search sends just the line', async ({ page }) => {
    const requests = await stubTurns(page, () => playedTurn('search', 'You look around but find nothing special.', { state: { time_remaining: 9 } }));

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');

    await expect(page.getByText('You look around but find nothing special.')).toBeVisible();
    expect(requests.map((request) => request.input)).toEqual(['search']);
  });

  test('targeted search sends the whole line', async ({ page }) => {
    const requests = await stubTurns(page, () => playedTurn('search', 'You find a clue under the desk!'));

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search under the desk');
    await input.press('Enter');

    await expect(page.getByText('You find a clue under the desk!')).toBeVisible();
    expect(requests.map((request) => request.input)).toEqual(['search under the desk']);
  });

  test('inspect alias sends the freeform text as typed', async ({ page }) => {
    const requests = await stubTurns(page, () => playedTurn('search', 'Nothing on the old bookshelf.'));

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('inspect the old bookshelf');
    await input.press('Enter');

    await expect(page.getByText('Nothing on the old bookshelf.')).toBeVisible();
    expect(requests.map((request) => request.input)).toEqual(['inspect the old bookshelf']);
  });

  test('shows investigator message for targeted search', async ({ page }) => {
    await stubTurns(page, () => playedTurn('search', 'You peek behind the curtains.'));

    await bootstrapSession(page);

    const input = page.locator('input[type="text"]');
    await input.fill('search behind the curtains');
    await input.press('Enter');

    await expect(page.locator('[data-speaker-kind="investigator"]').last()).toContainText('You:');
    await expect(page.getByText('You peek behind the curtains.')).toBeVisible();
    await expect(page.locator('[data-speaker-kind="narrator"]').last()).toContainText('Narrator:');
  });
});
