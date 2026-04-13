import { expect, test } from '@playwright/test';
import { enableAuthBypass } from './test-auth';
import {
  NARRATOR_SPEAKER as narratorSpeaker,
  EMPTY_CATALOG,
  createGameState,
  createGameStartResponse,
  createBlueprintSummary,
  createSessionSummary,
  createSessionCatalog,
  createNarrationEvent,
  createSearchResponse,
  createAccuseResponse,
} from '../../tests/testkit/src/fixtures';

const baseGameState = createGameState({ time_remaining: 8 });

test.describe('Sessions navigation', () => {
  test.beforeEach(async ({ page }) => {
    await enableAuthBypass(page);
  });

  test('refreshes landing counts after quitting a newly started session', async ({ page }) => {
    let catalogRequestCount = 0;

    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      catalogRequestCount += 1;

      if (catalogRequestCount === 1) {
        await route.fulfill({ json: EMPTY_CATALOG });
        return;
      }

      await route.fulfill({
        json: createSessionCatalog({
          in_progress: [
            createSessionSummary({
              game_id: '00000000-0000-0000-0000-000000000011',
              blueprint_id: '00000000-0000-0000-0000-000000000002',
              mystery_title: 'The Missing Honey Cakes',
              time_remaining: 8,
              last_played_at: '2026-03-10T10:00:00.000Z',
              created_at: '2026-03-10T09:50:00.000Z',
            }),
          ],
          counts: { in_progress: 1, completed: 0 },
        }),
      });
    });

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: { blueprints: [createBlueprintSummary({ id: '00000000-0000-0000-0000-000000000002', title: 'The Missing Honey Cakes', one_liner: 'Track the crumbs', target_age: 8 })] },
      });
    });

    await page.route('**/functions/v1/game-start*', async (route) => {
      await route.fulfill({
        json: createGameStartResponse({
          game_id: '00000000-0000-0000-0000-000000000011',
          state: baseGameState,
          narration_events: [
            createNarrationEvent({
              narration_parts: [{ text: 'You return to the investigation.', speaker: narratorSpeaker }],
            }),
          ],
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await expect(page.getByText('2. View in-progress games (0)')).toBeVisible();

    await page.keyboard.press('1');
    await expect(page.getByText('The Missing Honey Cakes')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/\/session$/);

    const input = page.locator('input[type="text"]');
    await input.fill('quit');
    await input.press('Enter');
    await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();

    await page.keyboard.press('x');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('2. View in-progress games (1)')).toBeVisible();

    await page.keyboard.press('2');
    await expect(page).toHaveURL(/\/sessions\/in-progress$/);
    await expect(page.getByText('The Missing Honey Cakes')).toBeVisible();
  });

  test('refreshes landing completed counts after finishing a newly started session', async ({ page }) => {
    let catalogRequestCount = 0;

    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      catalogRequestCount += 1;

      if (catalogRequestCount === 1) {
        await route.fulfill({ json: EMPTY_CATALOG });
        return;
      }

      await route.fulfill({
        json: createSessionCatalog({
          completed: [
            createSessionSummary({
              game_id: '00000000-0000-0000-0000-000000000012',
              blueprint_id: '00000000-0000-0000-0000-000000000003',
              mystery_title: 'The Locked Library',
              mode: 'ended',
              time_remaining: 0,
              outcome: 'win',
              last_played_at: '2026-03-10T10:00:00.000Z',
              created_at: '2026-03-10T09:40:00.000Z',
            }),
          ],
          counts: { in_progress: 0, completed: 1 },
        }),
      });
    });

    await page.route('**/functions/v1/blueprints-list*', async (route) => {
      await route.fulfill({
        json: { blueprints: [createBlueprintSummary({ id: '00000000-0000-0000-0000-000000000003', title: 'The Locked Library', one_liner: 'Solve the archive mystery', target_age: 9 })] },
      });
    });

    await page.route('**/functions/v1/game-start*', async (route) => {
      await route.fulfill({
        json: createGameStartResponse({
          game_id: '00000000-0000-0000-0000-000000000012',
          state: baseGameState,
          narration_events: [
            createNarrationEvent({
              narration_parts: [{ text: 'You return to the investigation.', speaker: narratorSpeaker }],
            }),
          ],
        }),
      });
    });

    await page.route('**/functions/v1/game-accuse*', async (route) => {
      await route.fulfill({
        json: createAccuseResponse({
          narration_parts: [{ text: 'Case closed. Excellent reasoning.', speaker: narratorSpeaker }],
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await expect(page.getByText('3. View completed games (0)')).toBeVisible();

    await page.keyboard.press('1');
    await expect(page.getByText('The Locked Library')).toBeVisible();
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/\/session$/);

    const input = page.locator('input[type="text"]');
    await input.fill('accuse Rosie did it because of the timeline.');
    await input.press('Enter');
    await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();

    await page.keyboard.press('x');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('3. View completed games (1)')).toBeVisible();

    await page.keyboard.press('3');
    await expect(page).toHaveURL(/\/sessions\/completed$/);
    await expect(page.getByText('The Locked Library')).toBeVisible();
  });

  test('refreshes catalog when entering in-progress list route', async ({ page }) => {
    let catalogRequestCount = 0;

    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      catalogRequestCount += 1;

      if (catalogRequestCount === 1) {
        await route.fulfill({ json: EMPTY_CATALOG });
        return;
      }

      await route.fulfill({
        json: createSessionCatalog({
          in_progress: [
            createSessionSummary({
              game_id: '00000000-0000-0000-0000-000000000013',
              blueprint_id: '00000000-0000-0000-0000-000000000002',
              mystery_title: 'The Missing Honey Cakes',
              time_remaining: 8,
              last_played_at: '2026-03-10T10:00:00.000Z',
              created_at: '2026-03-10T09:50:00.000Z',
            }),
          ],
          counts: { in_progress: 1, completed: 0 },
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('2. View in-progress games (0)')).toBeVisible();

    await page.goto('/sessions/in-progress');
    await expect(page).toHaveURL(/\/sessions\/in-progress$/);
    await expect(page.getByText('The Missing Honey Cakes')).toBeVisible();
  });

  test('renders in-progress list, supports b/back, and resumes by number', async ({ page }) => {
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: createSessionCatalog({
          in_progress: [
            createSessionSummary({
              game_id: '00000000-0000-0000-0000-000000000014',
              blueprint_id: '00000000-0000-0000-0000-000000000002',
              mystery_title: 'The Missing Honey Cakes',
              time_remaining: 8,
              last_played_at: '2026-03-10T10:00:00.000Z',
              created_at: '2026-03-09T10:00:00.000Z',
            }),
          ],
          counts: { in_progress: 1, completed: 0 },
        }),
      });
    });

    await page.route('**/functions/v1/game-get?game_id=00000000-0000-0000-0000-000000000014*', async (route) => {
      await route.fulfill({
        json: {
          blueprint_id: '00000000-0000-0000-0000-000000000002',
          state: baseGameState,
          narration_events: [
            createNarrationEvent({
              narration_parts: [{ text: 'You return to the investigation.', speaker: narratorSpeaker }],
            }),
          ],
        },
      });
    });

    await page.route('**/functions/v1/game-search*', async (route) => {
      await route.fulfill({
        json: createSearchResponse({
          narration_parts: [{ text: 'You inspect the room and spot fresh crumbs.', speaker: narratorSpeaker }],
          time_remaining: 7,
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await expect(page.getByText('2. View in-progress games (1)')).toBeVisible();
    await page.keyboard.press('2');
    await expect(page).toHaveURL(/\/sessions\/in-progress$/);

    await expect(page.getByText('The Missing Honey Cakes')).toBeVisible();
    await expect(page.getByText(/Turns left: 8/)).toBeVisible();

    await page.keyboard.press('b');
    await expect(page).toHaveURL(/\/$/);

    await page.keyboard.press('2');
    await expect(page).toHaveURL(/\/sessions\/in-progress$/);
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/\/session$/);

    const input = page.locator('input[type="text"]');
    await input.fill('search');
    await input.press('Enter');
    await expect(page.getByText('You inspect the room and spot fresh crumbs.')).toBeVisible();
  });

  test('renders completed list and opens ended sessions in read-only mode', async ({ page }) => {
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: createSessionCatalog({
          completed: [
            createSessionSummary({
              game_id: '00000000-0000-0000-0000-000000000015',
              blueprint_id: '00000000-0000-0000-0000-000000000003',
              mystery_title: 'The Locked Library',
              mode: 'ended',
              time_remaining: 0,
              outcome: 'win',
              last_played_at: '2026-03-11T10:00:00.000Z',
              created_at: '2026-03-09T10:00:00.000Z',
            }),
          ],
          counts: { in_progress: 0, completed: 1 },
        }),
      });
    });

    await page.route('**/functions/v1/game-get?game_id=00000000-0000-0000-0000-000000000015*', async (route) => {
      await route.fulfill({
        json: {
          blueprint_id: '00000000-0000-0000-0000-000000000003',
          state: {
            ...baseGameState,
            mode: 'ended',
            time_remaining: 0,
          },
          narration_events: [
            createNarrationEvent({
              sequence: 1,
              event_type: 'start',
              narration_parts: [{ text: 'You return to the investigation.', speaker: narratorSpeaker }],
            }),
            createNarrationEvent({
              sequence: 2,
              event_type: 'accuse_judge',
              narration_parts: [{ text: 'Case closed. Reviewing log.', speaker: narratorSpeaker }],
            }),
          ],
        },
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await expect(page.getByText('3. View completed games (1)')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page).toHaveURL(/\/sessions\/completed$/);

    await expect(page.getByText('The Locked Library')).toBeVisible();
    await expect(page.getByText(/Outcome: Solved/)).toBeVisible();

    await page.keyboard.press('1');
    await expect(page).toHaveURL(/\/session$/);

    await expect(page.getByTestId('return-to-list-prompt')).toBeVisible();
    await expect(page.locator('input[type="text"]')).toHaveCount(0);

    await page.keyboard.press('x');
    await expect(page).toHaveURL(/\/$/);
  });

  test('blocks opening rows when can_open is false', async ({ page }) => {
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: createSessionCatalog({
          completed: [
            createSessionSummary({
              game_id: '00000000-0000-0000-0000-000000000016',
              blueprint_id: '00000000-0000-0000-0000-000000000099',
              mystery_title: 'Unknown Mystery',
              mystery_available: false,
              can_open: false,
              mode: 'ended',
              time_remaining: 0,
              outcome: null,
              last_played_at: '2026-03-11T10:00:00.000Z',
              created_at: '2026-03-09T10:00:00.000Z',
            }),
          ],
          counts: { in_progress: 0, completed: 1 },
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByText('1. Start a new game')).toBeVisible();
    await expect(page.getByText('3. View completed games (1)')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page).toHaveURL(/\/sessions\/completed$/);

    await page.keyboard.press('1');
    await expect(page).toHaveURL(/\/sessions\/completed$/);
    await expect(page.getByText('Cannot open: mystery file is unavailable.').first()).toBeVisible();
  });
});
