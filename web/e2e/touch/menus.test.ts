import { expect, test } from '@playwright/test';
import { signInAsTestProfile } from '../test-profile';
import { listOnlyMockCase } from '../session-helpers';
import {
  NARRATOR_SPEAKER,
  createGameGetResponse,
  createGameState,
  createNarrationEvent,
  createSessionCatalog,
  createSessionSummary,
} from '../../../tests/testkit/src/fixtures';

// Runs on the phone and tablet projects. Everything here is a tap: no key is
// pressed. Leaving a game by touch belongs to the session screen's journey, so
// each list is reached from a fresh load of the menu.

const FINISHED_GAME_ID = '00000000-0000-0000-0000-000000000031';

test('a player starts, resumes and reviews a game by tapping only', async ({ page }) => {
  await signInAsTestProfile(page, 'touch');
  await listOnlyMockCase(page);

  await page.goto('/');
  await expect(page.getByTestId('menu-row-2')).toBeDisabled();
  await expect(page.getByTestId('menu-row-3')).toBeDisabled();

  // The new-game list, and back from it.
  await page.getByTestId('menu-row-1').tap();
  await expect(page.getByTestId('case-card-1')).toBeVisible();
  await page.getByTestId('back-button').tap();
  await expect(page.getByTestId('menu-row-1')).toBeVisible();

  // Start a case.
  await page.getByTestId('menu-row-1').tap();
  await page.getByTestId('case-card-1').tap();
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();

  // The game just started is in progress: resume it from the list, and back.
  await page.goto('/');
  await expect(page.getByTestId('menu-row-2')).toBeEnabled();
  await page.getByTestId('menu-row-2').tap();
  await expect(page).toHaveURL(/\/sessions\/in-progress$/);
  await page.getByTestId('back-button').tap();
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId('menu-row-2').tap();
  await page.getByTestId('session-row-1').tap();
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByTestId('begin-investigation-prompt')).toBeVisible();

  // Review a finished game.
  await page.route('**/api/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: createSessionCatalog({
        completed: [
          createSessionSummary({
            game_id: FINISHED_GAME_ID,
            mystery_title: 'The Locked Library',
            mode: 'ended',
            time_remaining: 0,
            outcome: 'win',
          }),
        ],
        counts: { in_progress: 0, completed: 1 },
      }),
    });
  });
  await page.route(`**/api/game-get?game_id=${FINISHED_GAME_ID}*`, async (route) => {
    await route.fulfill({
      json: createGameGetResponse({
        state: createGameState({ mode: 'ended', time_remaining: 0 }),
        narration_events: [
          createNarrationEvent({
            sequence: 1,
            event_type: 'accuse_judge',
            narration_parts: [{ text: 'Case closed.', speaker: NARRATOR_SPEAKER }],
          }),
        ],
      }),
    });
  });

  await page.goto('/');
  await page.getByTestId('menu-row-3').tap();
  await expect(page.getByText(/Outcome: Solved/)).toBeVisible();
  await page.getByTestId('session-row-1').tap();
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();
});
