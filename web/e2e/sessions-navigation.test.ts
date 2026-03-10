import { expect, test } from '@playwright/test';
import { enableAuthBypass } from './test-auth';

const narratorSpeaker = {
  kind: 'narrator',
  key: 'narrator',
  label: 'Narrator',
};

const baseGameState = {
  locations: [{ name: 'Kitchen' }, { name: 'Garden' }],
  characters: [{ first_name: 'Rosie', last_name: 'Jones', location_name: 'Kitchen' }],
  time_remaining: 8,
  location: 'Kitchen',
  mode: 'explore',
  current_talk_character: null,
  narration: 'You return to the investigation.',
  narration_speaker: narratorSpeaker,
  history: [
    {
      sequence: 1,
      event_type: 'start',
      narration: 'You return to the investigation.',
      speaker: narratorSpeaker,
    },
  ],
};

test.describe('Sessions navigation', () => {
  test.beforeEach(async ({ page }) => {
    await enableAuthBypass(page);
  });

  test('renders in-progress list, supports b/back, and resumes by number', async ({ page }) => {
    await page.route('**/functions/v1/game-sessions-list*', async (route) => {
      await route.fulfill({
        json: {
          in_progress: [
            {
              game_id: 'game-in-progress',
              blueprint_id: 'bp-1',
              mystery_title: 'The Missing Honey Cakes',
              mystery_available: true,
              can_open: true,
              mode: 'explore',
              time_remaining: 8,
              outcome: null,
              last_played_at: '2026-03-10T10:00:00.000Z',
              created_at: '2026-03-09T10:00:00.000Z',
            },
          ],
          completed: [],
          counts: {
            in_progress: 1,
            completed: 0,
          },
        },
      });
    });

    await page.route('**/functions/v1/game-get?game_id=game-in-progress*', async (route) => {
      await route.fulfill({ json: { state: baseGameState } });
    });

    await page.route('**/functions/v1/game-search*', async (route) => {
      await route.fulfill({
        json: {
          narration: 'You inspect the room and spot fresh crumbs.',
          time_remaining: 7,
          mode: 'explore',
          speaker: narratorSpeaker,
        },
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
        json: {
          in_progress: [],
          completed: [
            {
              game_id: 'game-completed',
              blueprint_id: 'bp-2',
              mystery_title: 'The Locked Library',
              mystery_available: true,
              can_open: true,
              mode: 'ended',
              time_remaining: 0,
              outcome: 'win',
              last_played_at: '2026-03-11T10:00:00.000Z',
              created_at: '2026-03-09T10:00:00.000Z',
            },
          ],
          counts: {
            in_progress: 0,
            completed: 1,
          },
        },
      });
    });

    await page.route('**/functions/v1/game-get?game_id=game-completed*', async (route) => {
      await route.fulfill({
        json: {
          state: {
            ...baseGameState,
            mode: 'ended',
            time_remaining: 0,
            narration: 'Case closed. Reviewing log.',
            history: [
              ...baseGameState.history,
              {
                sequence: 2,
                event_type: 'accuse_judge',
                narration: 'Case closed. Reviewing log.',
                speaker: narratorSpeaker,
              },
            ],
          },
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
        json: {
          in_progress: [],
          completed: [
            {
              game_id: 'disabled-completed',
              blueprint_id: 'bp-missing',
              mystery_title: 'Unknown Mystery',
              mystery_available: false,
              can_open: false,
              mode: 'ended',
              time_remaining: 0,
              outcome: null,
              last_played_at: '2026-03-11T10:00:00.000Z',
              created_at: '2026-03-09T10:00:00.000Z',
            },
          ],
          counts: {
            in_progress: 0,
            completed: 1,
          },
        },
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
