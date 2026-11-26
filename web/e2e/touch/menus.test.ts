import { expect, test } from '@playwright/test';
import { listOnlyMockCase } from '../session-helpers';
import { openNewProfileForm } from '../test-profile';
import {
  NARRATOR_SPEAKER,
  createGameGetResponse,
  createGameState,
  createNarrationEvent,
  createSessionCatalog,
  createSessionSummary,
} from '../../../tests/testkit/src/fixtures';

// Runs on the phone and tablet projects. Everything here is a tap: no key is
// pressed, and the player signs in at the picker. Leaving a game by touch
// belongs to the session screen's journey, so each list is reached from a fresh
// load of the menu.

const FINISHED_GAME_ID = '00000000-0000-0000-0000-000000000031';

test('a player starts, resumes and reviews a game by tapping only', async ({ page }) => {
  await listOnlyMockCase(page);

  // Sign in through the picker: `fill` sends no key events.
  await page.goto('/login');
  await openNewProfileForm(page, 'tap');
  await page.locator('#profile-name').fill(`touch-${crypto.randomUUID().slice(0, 8)}`);
  await page.getByTestId('reading-age-select').selectOption('8');
  await page.getByRole('button', { name: '[ START ]' }).tap();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('menu-row-2')).toBeDisabled();
  await expect(page.getByTestId('menu-row-3')).toBeDisabled();

  // The new-game list, and back from it.
  await page.getByTestId('menu-row-1').tap();
  await expect(page.getByTestId('case-card-1')).toBeVisible();
  // The footer is one row: `[ BACK ]` on one line, and no key hint on touch.
  expect((await page.getByTestId('back-button').boundingBox())?.height).toBeLessThanOrEqual(48);
  await expect(page.getByText(/PRESS A NUMBER/)).toBeHidden();
  await expect(page.getByText('Select your adventure')).toBeVisible();
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
