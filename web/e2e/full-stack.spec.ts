import { expect, test, type Page } from '@playwright/test';
import { signInAsTestProfile } from './test-profile';
import { confirmOpening, playedTurn, stubTurns } from './session-helpers';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  characterSpeaker,
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
      json: {
        blueprints: [
          createBlueprintSummary({ title: 'Missing Honey Cakes', one_liner: 'A sticky mystery', target_age: 6 }),
        ],
      },
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
  await expect(page.getByText('Missing Honey Cakes')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/.*\/session/);
  await confirmOpening(page);
}

test.describe('Full stack browser flow', () => {
  test('covers store + engine answers for talk/ask', async ({ page }) => {
    await stubTurns(page, ({ input }) =>
      input === 'talk to mayor'
        ? playedTurn('talk', '[Mock] You approach Mayor in Town Hall.', {
            payload: { character_name: 'Mayor' },
            state: { mode: 'talk', time_remaining: 9, current_talk_character: 'char-mayor' },
          })
        : playedTurn(
            'ask',
            '[Mock] Mayor responds thoughtfully to: Where were you when the cakes disappeared?',
            {
              speaker: characterSpeaker('Mayor'),
              state: { mode: 'talk', time_remaining: 9, current_talk_character: 'char-mayor' },
            },
          ),
    );

    await bootstrapSession(page);

    const input = page.locator("input[type='text']");

    await input.fill('talk to mayor');
    await input.press('Enter');
    await expect(page.getByText(/\[Mock\] You approach Mayor in/i)).toBeVisible();

    await input.fill('Where were you when the cakes disappeared?');
    await input.press('Enter');

    await expect(page.getByText(/\[Mock\] Mayor responds thoughtfully to:/i)).toBeVisible();
    await expect(page.getByText(/Request failed:/i)).toHaveCount(0);
  });
});
