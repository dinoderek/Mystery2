import { expect, test, type Page } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  characterSpeaker,
  BASE_GAME_STATE as baseState,
} from '../../tests/testkit/src/fixtures';

async function bootstrapSession(page: Page) {
  await enableAuthBypass(page);

  await page.route('**/functions/v1/game-sessions-list*', async (route) => {
    await route.fulfill({
      json: {
        in_progress: [],
        completed: [],
        counts: { in_progress: 0, completed: 0 },
      },
    });
  });

  await page.route('**/functions/v1/blueprints-list*', async (route) => {
    await route.fulfill({
      json: {
        blueprints: [{ id: 'b1', title: 'Missing Honey Cakes', one_liner: 'A sticky mystery', target_age: 6 }],
      },
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
  await expect(page.getByText('Missing Honey Cakes')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page).toHaveURL(/.*\/session/);
}

test.describe('Full stack browser flow', () => {
  test('covers parser + store + backend state machine for talk/ask', async ({ page }) => {
    await page.route('**/functions/v1/game-talk*', async (route) => {
      await route.fulfill({
        json: {
          narration_parts: [
            { text: '[Mock] You approach Mayor in Town Hall.', speaker: narratorSpeaker },
          ],
          mode: 'talk',
          time_remaining: 9,
          current_talk_character: 'Mayor',
        },
      });
    });

    await page.route('**/functions/v1/game-ask*', async (route) => {
      await route.fulfill({
        json: {
          narration_parts: [
            {
              text: '[Mock] Mayor responds thoughtfully to: Where were you when the cakes disappeared?',
              speaker: characterSpeaker('Mayor'),
            },
          ],
          mode: 'talk',
          time_remaining: 8,
          current_talk_character: 'Mayor',
        },
      });
    });

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
